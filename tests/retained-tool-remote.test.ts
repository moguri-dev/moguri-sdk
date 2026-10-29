import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { waitFor } from "./fixture.ts";

test("a late original SSH result gains its real raw grant without replay, survives restart and never completes the partial turn", { skip: process.platform !== "darwin", timeout: 30000 }, async (t) => {
  const f = await remoteFixture({ toolCall: { name: "read_file", args: { path: "fixture.txt" } } });
  let sdk = await new MoguriSdk(f.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const original = "Generated original late SSH result \u{1f9ea}.\n".repeat(1500), commit = f.service.store.commit.bind(f.service.store);
  let failed = false;
  const mock = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
    if (!failed && args[0].some((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_file")) {
      failed = true; throw new Error("Generated exact SSH result acknowledgement failure.");
    }
    return commit(...args);
  });
  try {
    await writeFile(join(f.workspace, "fixture.txt"), original);
    await f.probe(); await f.select(); await f.send("Generated original SSH read with a lost result acknowledgement.");
    await f.terminal(); assert.equal(failed, true); mock.mock.restore();
    const execution = f.controller.snapshot().executions[0]!;
    await waitFor(() => !f.controller.remote.owns(execution.id));
    await sdk.remote.reconcile(execution.id);
    const source = (await sdk.tools.results(f.sessionId)).sources.find((source) => source.name === "read_file")!;
    assert.ok(source); assert.equal(source.rawComplete, true);
    const page = await sdk.tools.resultById(f.sessionId, source.operationId, { expectedDigest: source.digest, expectedRevision: source.revision });
    assert.equal(page.text, original.slice(0, page.text.length)); assert.ok(page.nextOffset);
    assert.equal(f.session().status, "partial"); assert.equal(f.requests.length, 1);
    await sdk.remote.reconcile(execution.id);
    assert.equal((await sdk.tools.results(f.sessionId)).sources.find((value) => value.operationId === source.operationId)?.revision, source.revision);
    sdk.disconnect(); await f.service.close();
    const vault = { read: async (id: string) => f.secrets.get(id) ?? null,
      write: async (id: string, value: string) => { f.secrets.set(id, value); }, remove: async (id: string) => { f.secrets.delete(id); } };
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey,
      platform: { remote: { vault, modelsVault: vault } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    let text = "", offset: number | null = 0;
    do {
      const result = await sdk.tools.resultById(f.sessionId, source.operationId, { offset, expectedDigest: source.digest, expectedRevision: source.revision });
      text += result.text; offset = result.nextOffset;
    } while (offset !== null);
    assert.equal(text, original); assert.equal(f.requests.length, 1);
    assert.equal(restarted.controller.snapshot().sessions.find((session) => session.id === f.sessionId)?.status, "partial");
  } finally { mock.mock.restore(); sdk.disconnect(); await restarted?.close(); await f.close(); }
});
