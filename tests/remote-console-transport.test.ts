import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { parse } from "../packages/protocol/src/core.ts";
import { PreparedRemoteTerminalOwnerSchema } from "../packages/protocol/src/terminals.ts";
import { RemoteConsoles } from "../apps/service/src/remote-terminals.ts";
import { RemoteRuntime } from "../apps/service/src/remote.ts";
import { TerminalInspectSchema } from "../apps/service/src/terminal-protocol.ts";
import { remoteConsoleServiceFixture } from "./fixtures/remote-console-service.ts";

const native = { skip: process.platform !== "darwin", timeout: 25_000 };
async function output(f: Awaited<ReturnType<typeof remoteConsoleServiceFixture>>, terminal: Awaited<ReturnType<typeof f.open>>["terminal"], marker: string) {
  for (let index = 0; index < 100; index++) { const result = await f.read(terminal); if (result.data.includes(marker)) return result; await new Promise((resolve) => setTimeout(resolve, 15)); }
  throw new Error("Actual production Remote console did not produce its generated marker.");
}

test("the production SSH console carrier uses event-first exact Remote owner/PTY identities and survives controller detach without replay", native, async () => {
  const f = await remoteConsoleServiceFixture();
  try {
    const first = await f.open(); await output(f, first.terminal, "GENERATED_PRODUCTION_REMOTE_CONSOLE");
    await f.channel.request({ action: "input", terminalId: first.terminal.id, bindingDigest: f.binding.digest, data: "GENERATED_PRODUCTION_INPUT\n" });
    await output(f, first.terminal, "GENERATED_PRODUCTION_INPUT");
    const duplicate = parse(TerminalInspectSchema,
      await f.channel.request({ action: "open", intent: first.intent, launch: f.launch }));
    assert.equal(duplicate.terminal.pid, first.terminal.pid);
    const info = await f.reconnect(), after = await f.read(first.terminal);
    assert.equal(info.owner.pid, f.owner.pid); assert.equal(after.terminal.pid, first.terminal.pid); assert.equal(after.terminal.env, "Remote");
    assert.match(after.data, /GENERATED_PRODUCTION_INPUT/); assert.equal(after.data.split("GENERATED_PRODUCTION_REMOTE_CONSOLE").length - 1, 1);
    assert.deepEqual((await readdir(f.owner.directory)).sort(), ["admitted.json", "control.sock", "owner.json"]);
    assert.equal((await readFile(join(f.owner.directory, "owner.json"), "utf8")).includes(f.key), false);
    assert.equal(JSON.stringify(f.controller.events(0)).includes("GENERATED_PRODUCTION_INPUT"), false);
    await assert.rejects(() => f.sdk.terminal.open(f.sessionId), { code: "terminal_env" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("wrong production console scope/build/key cannot dispatch another SSH credential or owner", native, async (t) => {
  const f = await remoteConsoleServiceFixture(), transport = new RemoteConsoles(f.controller.remote);
  try {
    const connect = t.mock.method(f.controller.remote, "connect", f.controller.remote.connect.bind(f.controller.remote));
    await assert.rejects(() => transport.connect(f.owner, "", randomUUID(), () => {}, AbortSignal.timeout(5000)), { code: "terminal_key" });
    const wrong = parse(PreparedRemoteTerminalOwnerSchema, { ...f.owner, remote: { ...f.owner.remote, bridgeDigest: "0".repeat(64) } });
    await assert.rejects(() => transport.connect(wrong, f.key, randomUUID(), () => {}, AbortSignal.timeout(5000)), { code: "terminal_remote_build" });
    assert.equal(connect.mock.calls.length, 0);
    assert.equal((await f.channel.inspectOwner()).owner.pid, f.owner.pid);
  } finally { await f.close(); }
});

test("runtime shutdown detaches every owned console SSH stream but a fresh transport can inspect and stop the original independent broker", native, async () => {
  const f = await remoteConsoleServiceFixture();
  let replacement: RemoteRuntime | undefined;
  try {
    const opened = await f.open(); await output(f, opened.terminal, "GENERATED_PRODUCTION_REMOTE_CONSOLE");
    await f.controller.remote.close();
    replacement = new RemoteRuntime(join(f.directory, "state"), () => f.ssh.target, "unused-qualification-worker", { vault: { read: async () => null, write: async () => {}, remove: async () => {} } });
    f.useTransport(new RemoteConsoles(replacement));
    const info = await f.reconnect();
    assert.equal(info.owner.pid, f.owner.pid); assert.equal((await f.read(opened.terminal)).terminal.pid, opened.terminal.pid);
  } finally { await f.close(); await replacement?.close(); }
});
