import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { executeTool } from "../apps/service/src/tools.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";

async function send(sdk: MoguriSdk, sessionId: string, text: string) {
  const draft = sdk.getState().snapshot!.sessions.find((session) => session.id === sessionId)!.draft;
  await sdk.command({ type: "draft.save", sessionId, expectedRevision: draft.revision, text, attachments: [] });
  await sdk.command({ type: "message.send", sessionId, expectedRevision: draft.revision + 1, delivery: "queue" });
}

test("an ordinary Local chat binds configured Home and runs pwd through its actual approved Agent terminal without creating a project", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-chat-home-")), home = join(directory, "home");
  await mkdir(home); await writeFile(join(home, "generated-home.txt"), "Generated Home file.\n");
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "pwd", timeoutMs: 2000 } }, platform: { terminal: { defaultRoot: home } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated Home-backed chat", { modelId: fixture.modelId });
    const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    assert.equal(session().projectId, null);
    assert.equal(session().homeRoot?.root, await realpath(home));
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated project-free pwd request.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const approval = await waitFor(() => session().pendingApproval);
    assert.equal(approval.call.name, "run_command");
    await sdk.approvals.respond(created.id!, approval.id, true);
    await waitFor(() => session().status === "completed");
    const result = fixture.service.controller.events(0).find((event) => event.session_id === created.id && event.event_type === "tool.completed");
    assert.ok(result?.event_type === "tool.completed"); assert.match(result.payload.text, new RegExp((await realpath(home)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(result.payload.outcome, "completed");
    assert.equal(fixture.service.controller.snapshot().projects.length, 1);
    assert.equal(session().projectId, null);
    const files = await sdk.workspaces.files(created.id!);
    assert.ok(files.entries.includes("generated-home.txt"));
    const commands = await sdk.agentTerminals.list(created.id!);
    assert.equal(commands.activity.entries.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});

test("the public SDK's exact approved standalone command retains its own Home writer and settled original output", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated standalone Home command");
    const catalogue = await sdk.tools.catalog(created.id!, "run_command"), tool = catalogue.tools.find((tool) => tool.name === "run_command");
    assert.ok(tool);
    const started = await sdk.tools.execute(created.id!, tool.name, { command: "pwd", timeoutMs: 2000 }, tool.schemaDigest);
    const approval = await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.pendingApproval);
    await sdk.approvals.respond(created.id!, approval.id, true);
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === started.id && job.status === "completed"));
    const writers = fixture.service.controller.snapshot().chatWriters.filter((writer) => writer.sessionId === created.id);
    assert.equal(writers.length, 1); assert.equal(writers[0]!.status, "settled");
    assert.equal(writers[0]!.root.root, await realpath(fixture.home));
    const commands = await sdk.agentTerminals.list(created.id!);
    assert.equal(commands.activity.entries.length, 1);
    const output = await sdk.agentTerminals.read(created.id!, commands.activity.entries[0]!.id);
    assert.ok(output.content?.text.includes(await realpath(fixture.home)));
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a replaced Home never receives the original approval, but the user can still deny the unexecuted command", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf GENERATED_MUST_NOT_EXECUTE", timeoutMs: 2000 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated original Home", { modelId: fixture.modelId });
    const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    const original = session().homeRoot!;
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated original Home command.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const approval = await waitFor(() => session().pendingApproval);
    await rename(fixture.home, join(fixture.directory, "original-home"));
    await mkdir(fixture.home);
    await assert.rejects(() => sdk.approvals.respond(created.id!, approval.id, true), /Home directory identity changed/);
    await assert.rejects(() => sdk.workspaces.files(created.id!), /Home directory identity changed/);
    await sdk.approvals.respond(created.id!, approval.id, false);
    await waitFor(() => session().turnId === null);
    assert.ok(fixture.service.controller.events(0).some((event) => event.session_id === created.id && event.event_type === "tool.completed" && event.payload.outcome === "denied"));
    assert.deepEqual(session().homeRoot, original);
    assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === created.id && event.event_type === "tool.started"), false);
    assert.deepEqual(fixture.service.controller.snapshot().chatWriters, []);
    const replacement = await sdk.sessions.create(null, "Generated explicitly new Home chat");
    assert.notEqual(fixture.service.controller.snapshot().sessions.find((session) => session.id === replacement.id)!.homeRoot!.inode, original.inode);
    assert.equal(session().projectId, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("explicit project-free Autopilot writes and reads generated Home files without persistent grants or another project's context", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCalls: [
    { name: "write_file", args: { path: "generated-output.txt", text: "GENERATED_HOME_WRITE\n", expectedDigest: "absent" } },
    { name: "read_file", args: { path: "generated-output.txt" } },
  ] }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await mkdir(join(fixture.home, ".ssh")); await writeFile(join(fixture.home, ".ssh", "generated.txt"), "GENERATED_PROTECTED_CONTENT");
    const created = await sdk.sessions.create(null, "Generated automatic Home file work", { modelId: fixture.modelId });
    await sdk.sessions.autonomy(created.id!, "Autopilot");
    await send(sdk, created.id!, "Generated Home file work.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.status === "completed");
    assert.equal(await readFile(join(fixture.home, "generated-output.txt"), "utf8"), "GENERATED_HOME_WRITE\n");
    const events = fixture.service.controller.events(0).filter((event) => event.session_id === created.id);
    assert.equal(events.filter((event) => event.event_type === "tool.decided" && event.payload.actor === "autonomy").length, 2);
    assert.ok(events.some((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_file" && event.payload.text.includes("GENERATED_HOME_WRITE")));
    assert.equal(events.some((event) => event.event_type === "tool.completed" && event.payload.isError), false);
    assert.equal(JSON.stringify(fixture.requests).includes(fixture.project), false);
    assert.deepEqual(sdk.settings.get()!.values.permissions, { defaultDecision: "ask", tools: [], commands: [] });
    assert.equal(fixture.service.controller.snapshot().chatWriters.find((writer) => writer.sessionId === created.id)?.status, "settled");
    assert.equal((await sdk.workspaces.files(created.id!)).entries.some((entry) => entry.includes(".ssh")), false);
    await assert.rejects(() => sdk.workspaces.file(created.id!, ".ssh/generated.txt"), /protected|excluded/i);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an ordinary Home chat's model can reread its actual Agent command but never the private User console", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "pwd", timeoutMs: 2000 } }, agentTerminalRead: true });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated Home Agent reread", { modelId: fixture.modelId });
    const home = await realpath(fixture.home);
    await sdk.terminal.open(created.id!);
    await sdk.sessions.autonomy(created.id!, "Autopilot");
    await send(sdk, created.id!, "Generated Home command and original Agent output.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.status === "completed");
    const results = fixture.service.controller.events(0).filter((event) => event.session_id === created.id && event.event_type === "tool.completed");
    assert.equal(results.length, 3);
    assert.ok(results.some((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_agent_terminal" &&
      event.payload.call.arguments.action === "read" && event.payload.text.includes(home)));
    assert.equal(JSON.stringify(fixture.requests).includes("GENERATED_TERMINAL_READY"), false);
    assert.equal(fixture.service.controller.snapshot().chatWriters.filter((writer) => writer.sessionId === created.id).length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a project-free Home command can create a generated PR through one explicitly targeted GitHub CLI without selecting or inferring a project", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-chat-github-")), script = join(directory, "generated-gh-cli");
  await writeFile(script, `#!${process.execPath}
const args = process.argv.slice(2);
if (JSON.stringify(args) !== JSON.stringify(["pr","create","--repo","generated-owner/generated-repo","--title","Generated PR"])) process.exit(9);
process.stdout.write(JSON.stringify({repository: args[3], cwd: process.cwd(), url: "https://github.com/generated-owner/generated-repo/pull/42"}) + "\\n");\n`, { mode: 0o700 });
  const fixture = await setupFixture({ toolCall: { name: "run_command", args: {
    command: `${JSON.stringify(script)} pr create --repo generated-owner/generated-repo --title 'Generated PR'`, timeoutMs: 2000,
  } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated explicit repository PR", { modelId: fixture.modelId });
    await sdk.sessions.autonomy(created.id!, "Autopilot");
    await send(sdk, created.id!, "Create the generated PR only in generated-owner/generated-repo.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.status === "completed");
    const command = fixture.service.controller.events(0).find((event) => event.session_id === created.id && event.event_type === "tool.completed");
    assert.ok(command?.event_type === "tool.completed"); assert.equal(command.payload.outcome, "completed");
    const output = JSON.parse(command.payload.text).output;
    assert.equal(typeof output, "string");
    assert.ok(output.includes('"repository":"generated-owner/generated-repo"'));
    assert.ok(output.includes(await realpath(fixture.home)));
    assert.ok(output.includes("https://github.com/generated-owner/generated-repo/pull/42"));
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.projectId, null);
    assert.equal(fixture.service.controller.snapshot().projects.length, 1);
    assert.equal(JSON.stringify(fixture.requests).includes(fixture.project), false);
  } finally { sdk.disconnect(); await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a project-free native browser retains explicit user control and needs neither a usable Home directory nor a Home writer", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const created = await sdk.sessions.create(null, "Generated project-free browser");
  const owner = { sessionId: created.id!, hostId: "generated-project-free-browser", lease: "cd".repeat(32) };
  try {
    await sdk.browser.host.attach(owner);
    assert.equal((await sdk.browser.state(created.id!)).browser.controlId, null);
    await sdk.browser.host.control(owner, 1, true);
    const controlId = (await sdk.browser.state(created.id!)).browser.controlId!;
    await rename(fixture.home, join(fixture.directory, "original-home"));
    await mkdir(fixture.home);
    const catalogue = await sdk.mcp.tools("builtin", "navigate", 0, created.id!), navigate = catalogue.tools.find((tool) => tool.name === "browser_navigate");
    assert.ok(navigate);
    const args = { controlId, url: "https://example.invalid/generated-home-chat" };
    const started = await sdk.command({ type: "mcp.call", sessionId: created.id!, serverId: "builtin", tool: navigate.name, arguments: args, schemaDigest: navigate.digest });
    const approval = await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.pendingApproval);
    assert.equal((await sdk.browser.host.poll(owner, "", "")).request, null);
    await sdk.approvals.respond(created.id!, approval.id, true);
    let request = (await sdk.browser.host.poll(owner, "", "")).request;
    for (let attempt = 0; !request && attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 15)); request = (await sdk.browser.host.poll(owner, "", "")).request;
    }
    assert.ok(request); assert.deepEqual(request.arguments, args);
    await sdk.browser.host.reply(owner, request.id, { text: '{"source":"untrusted-browser-result","generated":true}', outcome: "completed" });
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === started.id && job.status === "completed"));
    assert.deepEqual(fixture.service.controller.snapshot().chatWriters, []);
    assert.equal(fixture.requests.length, 0);
    await sdk.browser.host.control(owner, 2, false);
    assert.equal((await sdk.browser.state(created.id!)).browser.controlId, null);
    await assert.rejects(() => sdk.workspaces.files(created.id!), /Home directory identity changed/);
  } finally { await sdk.browser.host.detach(owner); sdk.disconnect(); await fixture.close(); }
});

test("project-free automatic approval never overrides a command denial, read-only/side mode or allowed-env policy", { skip: process.platform !== "darwin" }, async (t) => {
  for (const mode of ["denied", "read-only", "side", "env-policy"] as const) await t.test(mode, async () => {
    const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf GENERATED_FORBIDDEN_HOME_COMMAND", timeoutMs: 2000 } } });
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      const created = await sdk.sessions.create(null, `Generated Home ${mode}`, { modelId: fixture.modelId });
      await sdk.sessions.autonomy(created.id!, "Autopilot");
      let sessionId = created.id!;
      if (mode === "read-only") await sdk.sessions.mode(sessionId, "read-only");
      if (mode === "side") sessionId = (await sdk.sessions.side(sessionId)).id!;
      if (mode === "denied") {
        const settings = sdk.settings.get()!;
        await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [
          { id: "generated-home-command-denial", tool: "run_command", pathPrefix: "", decision: "deny" },
        ] } }, settings.revision);
      }
      if (mode === "env-policy") {
        await sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] });
        await assert.rejects(() => send(sdk, sessionId, "Generated excluded Local Home command."), /Local|policy|environment/i);
        assert.equal(fixture.requests.length, 0);
      } else {
        await send(sdk, sessionId, "Generated forbidden Home command.");
        await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === sessionId)?.status === "completed");
        const result = fixture.service.controller.events(0).find((event) => event.session_id === sessionId && event.event_type === "tool.completed");
        assert.ok(result?.event_type === "tool.completed"); assert.equal(result.payload.outcome, "denied");
      }
      assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === sessionId && event.event_type === "process.started"), false);
      assert.deepEqual(fixture.service.controller.snapshot().chatWriters, []);
      assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === sessionId)?.projectId, null);
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});

test("remembered Home command approvals stay session/profile-owned without manufacturing a project grant", { skip: process.platform !== "darwin" }, async (t) => {
  for (const scope of ["session", "global"] as const) await t.test(scope, async () => {
    const fixture = await setupFixture({ toolCall: { name: "run_command", args: { command: "pwd", timeoutMs: 2000 } } });
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      const created = await sdk.sessions.create(null, "Generated remembered Home", { modelId: fixture.modelId });
      const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
      await send(sdk, created.id!, "Generated remembered Home command.");
      const approval = await waitFor(() => session().pendingApproval);
      await assert.rejects(() => sdk.approvals.respond(created.id!, approval.id, true, { scope: "project", match: "exact" }), /project/i);
      await sdk.approvals.respond(created.id!, approval.id, true, { scope, match: "exact" });
      await waitFor(() => session().status === "completed");
      await send(sdk, created.id!, "Generated same Home command with the actual retained grant.");
      await waitFor(() => session().usage.length === 4 && session().status === "completed");
      assert.equal(fixture.service.controller.events(0).filter((event) => event.session_id === created.id && event.event_type === "tool.decided" && event.payload.actor === "delegation").length, 1);
      const sibling = await sdk.sessions.create(null, "Generated separate Home owner", { modelId: fixture.modelId });
      await send(sdk, sibling.id!, "Generated separate Home command.");
      if (scope === "session") {
        const pending = await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === sibling.id)?.pendingApproval);
        await sdk.approvals.respond(sibling.id!, pending.id, false);
      }
      await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === sibling.id)?.status === "completed");
      const grant = sdk.approvals.list()[0]!;
      assert.equal(grant.scope.kind, scope);
      assert.equal(fixture.service.controller.snapshot().projects.length, 1);
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});

test("the executor rechecks the exact approved Home identity instead of writing into a directory replaced after authorization", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated exact executor binding"), homeRoot = (await sdk.workspaces.home(created.id!)).root;
    await rename(fixture.home, join(fixture.directory, "original-home"));
    await mkdir(fixture.home);
    await assert.rejects(() => executeTool(homeRoot.root, { id: "generated-late-home-write", name: "write_file",
      arguments: { path: "generated-must-not-publish.txt", text: "Generated forbidden replacement write.", expectedDigest: "absent" } },
      new AbortController().signal, () => {}, () => {}, undefined,
      { mode: "agent", env: "Local", folders: { denied: [], readOnly: [] }, homeRoot }), /Home directory identity changed/);
    assert.equal((await sdk.sessions.create(null, "Generated replacement directory review")).id !== created.id, true);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a real global stdio MCP uses captured Home and an older null-root grant cannot silently approve its changed directory resource", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.home, "fixture.txt"), "GENERATED_HOME_MCP_WITNESS\n");
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-home-mcp", name: "Generated Home MCP", enabled: true,
      transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-root-echo.mjs")] } }] }, settings.revision);
    const created = await sdk.sessions.create(null, "Generated scoped Home MCP");
    const tools = await sdk.mcp.tools("generated-home-mcp", "", 0, created.id!), tool = tools.tools.find((tool) => tool.name === "root_echo");
    assert.ok(tool);
    const legacyBinding = frameDigest([fixture.service.controller.platform.server("generated-home-mcp", null), null, null]), current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, permissions: { ...current.values.permissions, remembered: [{
      id: "generated-original-rootless-mcp-grant", scope: { kind: "global" }, env: "Local",
      target: { kind: "mcp", serverId: "generated-home-mcp", tool: tool.name, schemaDigest: tool.digest, bindingDigest: legacyBinding },
    }] } }, current.revision);
    const started = await sdk.mcp.call(created.id!, "generated-home-mcp", tool.name, { text: "Generated explicitly reviewed Home MCP call." }, tool.digest);
    const approval = await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.pendingApproval);
    await sdk.approvals.respond(created.id!, approval.id, true, { scope: "global", match: "tool" });
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === started.id && job.status === "completed"));
    const result = JSON.parse((await sdk.mcp.readResult(started.id!)).text), witness = JSON.parse(result.content[0].text);
    assert.equal(witness.root, await realpath(fixture.home)); assert.equal(witness.marker, "GENERATED_HOME_MCP_WITNESS\n");
    const approved = sdk.approvals.list().find((grant) => grant.id !== "generated-original-rootless-mcp-grant")!;
    assert.equal(approved.target.kind, "mcp");
    if (approved.target.kind === "mcp") assert.notEqual(approved.target.bindingDigest, legacyBinding);
    assert.equal(fixture.service.controller.snapshot().chatWriters.find((writer) => writer.sessionId === created.id)?.status, "settled");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.projectId, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});
