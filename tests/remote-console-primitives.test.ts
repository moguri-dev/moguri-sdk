import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TerminalState } from "../packages/protocol/src/terminals.ts";
import { remoteConsoleFixture, type RemoteConsolePeer } from "./fixtures/remote-terminal-client.ts";
import { waitFor } from "./fixture.ts";

const native = { skip: process.platform !== "darwin", timeout: 25_000 };
async function output(f: Awaited<ReturnType<typeof remoteConsoleFixture>>, peer: RemoteConsolePeer, terminal: TerminalState, text: string) {
  for (let index = 0; index < 100; index++) {
    const result = await f.read(peer, terminal); if (result.data.includes(text)) return result;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Actual Remote broker did not produce its generated PTY witness.");
}
const absent = (pid: number) => { try { process.kill(pid, 0); return false; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return true; throw error; } };

test("private SSH console uses the real Remote root and independent authenticated broker without a model or transcript/key file", native, async () => {
  const f = await remoteConsoleFixture();
  try {
    assert.notEqual(f.owner.pid, f.frontPid); assert.notEqual(f.frontPid, process.pid);
    const first = await f.openTerminal(f.peer);
    const read = await output(f, f.peer, first.terminal, "GENERATED_REMOTE_CONSOLE_READY");
    assert.match(read.data, new RegExp(f.workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(read.terminal.binding?.root, f.workspace); assert.equal(read.terminal.ownerId, f.owner.id);
    assert.notEqual(read.terminal.pid, f.owner.pid); assert.notEqual(read.terminal.pid, f.frontPid);
    await f.peer.request({ action: "input", terminalId: first.terminal.id, bindingDigest: f.intent.binding.digest, data: "GENERATED_REMOTE_INPUT\n" });
    await output(f, f.peer, first.terminal, "GENERATED_REMOTE_INPUT");
    assert.deepEqual((await readdir(f.owner.directory)).sort(), ["admitted.json", "control.sock"]);
    const retained = await readFile(join(f.owner.directory, "admitted.json"), "utf8");
    assert.equal(retained.includes(f.key), false); assert.equal(retained.includes("GENERATED_REMOTE_INPUT"), false);
    const duplicate = await f.openTerminal(f.peer, first.intent);
    assert.equal(duplicate.terminal.pid, first.terminal.pid);
    assert.equal((await f.read(f.peer, first.terminal)).data.split("GENERATED_REMOTE_CONSOLE_READY").length - 1, 1);
  } finally { await f.close(); }
});

test("SIGKILL of the owned OpenSSH client preserves two original Remote PTYs and a fresh authenticated connection never replays input", native, async () => {
  const f = await remoteConsoleFixture();
  try {
    await assert.rejects(() => f.attach({ key: "" }), { code: "invalid_request" });
    const first = await f.openTerminal(f.peer), second = await f.openTerminal(f.peer);
    await output(f, f.peer, first.terminal, "GENERATED_REMOTE_CONSOLE_READY"); await output(f, f.peer, second.terminal, "GENERATED_REMOTE_CONSOLE_READY");
    await f.peer.request({ action: "input", terminalId: first.terminal.id, bindingDigest: f.intent.binding.digest, data: "GENERATED_BEFORE_SSH_LOSS\n" });
    await output(f, f.peer, first.terminal, "GENERATED_BEFORE_SSH_LOSS");
    await f.peer.close("SIGKILL"); await waitFor(() => absent(f.frontPid), 5000);
    const reattached = await f.attach();
    assert.equal(reattached.info.owner.pid, f.owner.pid); assert.notEqual(reattached.frontPid, f.frontPid);
    const after = await f.read(reattached.peer, first.terminal);
    assert.equal(after.terminal.pid, first.terminal.pid); assert.match(after.data, /GENERATED_BEFORE_SSH_LOSS/);
    assert.equal(after.data.split("GENERATED_REMOTE_CONSOLE_READY").length - 1, 1);
    assert.equal((await f.read(reattached.peer, second.terminal)).terminal.pid, second.terminal.pid);
    await assert.rejects(() => f.peer.request({ action: "input", terminalId: first.terminal.id, bindingDigest: f.intent.binding.digest, data: "GENERATED_UNSENT_AFTER_LOSS\n" }), { code: "remote_console_closed" });
    assert.equal((await f.read(reattached.peer, first.terminal)).data.includes("GENERATED_UNSENT_AFTER_LOSS"), false);
  } finally { await f.close(); }
});

test("wrong keys/builds/host pins, another controller and duplicate owner bootstrap cannot adopt or replace a live Remote broker", native, async () => {
  const f = await remoteConsoleFixture();
  try {
    await assert.rejects(() => f.attach({ key: randomBytes(32).toString("base64") }), { code: "terminal_authentication" });
    await assert.rejects(() => f.attach(), { code: "terminal_owner_busy" });
    await assert.rejects(() => f.attach({ owner: { ...f.owner, buildDigest: "0".repeat(64) } }), { code: "remote_console_build" });
    await assert.rejects(() => f.attach({ target: { ...f.target, hostKey: f.ssh.incorrectHostKey } }), { code: "remote_console_lost" });
    await assert.rejects(() => f.open({ format: "moguri-private-remote-console", version: 1, action: "start", owner: f.intent.owner, key: f.key, clientId: randomUUID() }), { code: "remote_console_admitted" });
    await assert.rejects(() => f.runtime.connect(f.target, AbortSignal.abort()), /abort/i);
    await assert.rejects(() => f.runtime.connect(f.target, new AbortController().signal, 0), { code: "remote_frame_limit" });
    const info = await f.peer.request({ action: "info" });
    assert.ok(JSON.stringify(info).includes(String(f.owner.pid)));
    assert.equal((await readdir(f.owner.directory)).filter((entry) => entry === "control.sock").length, 1);
  } finally { await f.close(); }
});

test("a replaced actual Remote directory cannot receive new PTY input and still permits exact owned-group close", native, async () => {
  const f = await remoteConsoleFixture();
  try {
    const opened = await f.openTerminal(f.peer); await output(f, f.peer, opened.terminal, "GENERATED_REMOTE_CONSOLE_READY");
    await rename(f.workspace, join(f.directory, "generated-moved-root")); await mkdir(f.workspace);
    await assert.rejects(() => f.peer.request({ action: "input", terminalId: opened.terminal.id, bindingDigest: f.intent.binding.digest, data: "GENERATED_FORBIDDEN_CHANGED_ROOT\n" }), { code: "terminal_root_changed" });
    assert.equal((await f.read(f.peer, opened.terminal)).data.includes("GENERATED_FORBIDDEN_CHANGED_ROOT"), false);
    const stopped = await f.peer.request({ action: "close", terminalId: opened.terminal.id, bindingDigest: f.intent.binding.digest });
    assert.ok(JSON.stringify(stopped).includes('"status":"closed"'));
    await waitFor(() => absent(opened.terminal.pid!), 5000);
  } finally { await f.close(); }
});

test("private Remote cleanup retains unexpected files and original admission until an explicit exact retry", native, async () => {
  const f = await remoteConsoleFixture(), unexpected = join(f.owner.directory, "generated-unexpected");
  try {
    await f.dispose(f.peer); await writeFile(unexpected, "Generated runtime file must survive cleanup.\n", { mode: 0o600 });
    await assert.rejects(() => f.cleanup(), { code: "remote_console_cleanup" });
    assert.equal(await readFile(unexpected, "utf8"), "Generated runtime file must survive cleanup.\n");
    assert.match(await readFile(join(f.owner.directory, "admitted.json"), "utf8"), /moguri-private-remote-console-admission/);
    await unlink(unexpected); await f.cleanup();
  } finally { await f.close(); }
});
