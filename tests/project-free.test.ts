import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DraftEditor, MoguriSdk, type Session } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { executeTool } from "../apps/service/src/tools.ts";

const mac = { skip: process.platform !== "darwin", timeout: 20_000 };
async function send(sdk: MoguriSdk, session: Session, text: string) {
  const editor = new DraftEditor(sdk, session.id, session.draft);
  try { editor.edit(text); await editor.send("queue"); } finally { editor.dispose(); }
}
test("a genuinely project-free chat has model context but no inherited root, attachments, workspace tools or internal workspace catalog", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.project, "AGENTS.md"), "Generated bound-project-only instructions.");
    const result = await sdk.sessions.create();
    let session = sdk.getState().snapshot!.sessions.find((session) => session.id === result.id)!;
    assert.equal(session.projectId, null);
    assert.equal(sdk.getState().snapshot!.projects.length, 1);
    await sdk.command({ type: "session.configure", sessionId: session.id, expectedRevision: session.revision, controls: { ...session.controls, modelId: fixture.modelId } });
    await assert.rejects(() => sdk.command({ type: "attachment.add", sessionId: session.id, path: "fixture.txt", expectedRevision: 0 }), /Select a project/);
    await assert.rejects(() => sdk.terminal.open(session.id), /Select a project/);
    await assert.rejects(() => sdk.plans.read(session.id), /Select a project/);
    await assert.rejects(() => sdk.slash(session.id, "/diff", "tui"), /Select a project/);
    await assert.rejects(() => executeTool(null, { id: "generated-no-root", name: "run_command", arguments: { command: "pwd", timeoutMs: 1000 } }, new AbortController().signal, () => {}, () => {}), /no workspace/);
    const catalog = await sdk.mcp.tools("builtin", "", 0, session.id);
    assert.deepEqual(catalog.tools.map((tool) => tool.name), ["fetch_page"]);
    session = sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)!;
    await send(sdk, session, "Generated project-free question without workspace operations.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === session.id)?.status === "completed");
    const request = fixture.requests[0]!;
    assert.equal(JSON.stringify(request.messages).includes(fixture.project), false);
    assert.equal(JSON.stringify(request.messages).includes("Generated bound-project-only instructions."), false);
    assert.equal(/read_file|write_file|run_command|memory_search|propose_skill/.test(JSON.stringify(request.tools)), false);
    assert.equal(fixture.service.controller.snapshot().sessions.find((value) => value.id === session.id)?.usage.length, 1);
    await assert.rejects(() => sdk.sessions.organize(session.id, { parentSessionId: fixture.sessionId }), /scope|project/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("project-free sessions run independently and a failed one quarantines neither other chats nor a real project", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const ids: string[] = [];
    for (let index = 0; index < 2; index++) {
      const created = await sdk.sessions.create(null);
      const session = sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)!;
      await sdk.command({ type: "session.configure", sessionId: session.id, expectedRevision: session.revision, controls: { ...session.controls, modelId: fixture.modelId } }); ids.push(session.id);
    }
    const current = (id: string) => sdk.getState().snapshot!.sessions.find((value) => value.id === id)!;
    await send(sdk, current(ids[0]!), "generated slow independent work");
    await waitFor(() => fixture.requests.length === 1);
    await send(sdk, current(ids[1]!), "Generated independently completed chat.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === ids[1])?.status === "completed");
    assert.equal(fixture.service.controller.snapshot().sessions.find((value) => value.id === ids[0])?.status, "running");
    await sdk.command({ type: "session.stop", sessionId: ids[0]! });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === ids[0])?.status === "stopped");
    await sdk.refresh();
    await send(sdk, current(ids[0]!), "generated provider failure");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === ids[0])?.status === "failed");
    const snapshot = fixture.service.controller.snapshot();
    assert.deepEqual(snapshot.blockedProjects, []);
    assert.deepEqual(snapshot.blockedSessions, [ids[0]]);
    await sdk.refresh();
    await send(sdk, current(ids[1]!), "Generated second healthy general turn.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === ids[1])?.messages.filter((message) => message.role === "user").length === 2 && !fixture.service.controller.snapshot().sessions.find((value) => value.id === ids[1])?.turnId);
    await sdk.command({ type: "session.resume", sessionId: ids[0]! });
    assert.deepEqual(fixture.service.controller.snapshot().blockedSessions, []);
  } finally { sdk.disconnect(); await fixture.close(); }
});
