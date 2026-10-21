import { randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { chmod } from "node:fs/promises";
import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import type { PreparedTerminalOwner, TerminalState } from "../../../packages/protocol/src/terminals.ts";
import { TerminalEngine } from "./terminal-engine.ts";
import { assertTerminalBinding, assertTerminalEndpoint, terminalKey, terminalProof, validTerminalProof } from "./terminal-identity.ts";
import { JsonLineChannel, frameDigest } from "./worker-wire.ts";
import {
  TERMINAL_FRAME_BYTES, TerminalBootstrapSchema, TerminalOwnerInfoSchema, TerminalRequestSchema,
  type TerminalBootstrap, type TerminalOwnerInfo,
} from "./terminal-protocol.ts";

export async function runTerminalOwner(boot: TerminalBootstrap): Promise<void> {
  terminalKey(boot.key);
  await assertTerminalEndpoint(boot.owner, false);
  if (boot.owner.pid !== process.pid) throw new MoguriError("terminal_owner_pid", "Terminal owner bootstrap does not match its actual process.", 409);
  let owner: PreparedTerminalOwner = { ...boot.owner, status: "running", updatedAt: new Date().toISOString(), diagnostic: null };
  const states = new Map<string, TerminalState>(), seen = new Map<string, string>();
  const engine = new TerminalEngine((state) => { const previous = states.get(state.id); states.set(state.id, { ...previous, ...state, title: previous?.title ?? state.title }); });
  const peers = new Set<Socket>();
  let lease: Socket | null = null;
  const info = (): TerminalOwnerInfo => parse(TerminalOwnerInfoSchema, { owner, terminalIds: [...states.keys()], nodeVersion: process.versions.node });
  const state = (id: string): TerminalState => {
    const result = states.get(id);
    if (!result) throw new MoguriError("terminal_missing", "The terminal does not exist in this exact owner or its volatile metadata/buffer expired. No replacement was started.", 404);
    return result;
  };
  const prune = () => {
    const expired = [...states.values()].filter((entry) => ["closed", "failed", "acknowledged"].includes(entry.status)).slice(0, -32);
    for (const entry of expired) { if (entry.pid !== null) engine.forget(entry.id); states.delete(entry.id); }
  };
  const closeAll = async () => {
    owner = { ...owner, status: "stopping", updatedAt: new Date().toISOString() };
    await Promise.all([...states.values()].filter((terminal) => terminal.pid !== null && !["failed", "acknowledged"].includes(terminal.status)).map((terminal) => engine.close(terminal.id)));
    const unconfirmed = [...states.values()].some((state) => state.status === "unconfirmed");
    owner = { ...owner, status: unconfirmed ? "unconfirmed" : "stopped", updatedAt: new Date().toISOString(),
      diagnostic: unconfirmed ? "One or more owned PTY groups have unconfirmed cleanup. No endpoint or capability was discarded." : "Known owned PTY groups stopped. Detached/reparented descendants are not proven contained." };
    return info();
  };
  const server = createServer((socket) => {
    if (peers.size >= 8) { socket.destroy(); return; }
    peers.add(socket);
    const wire = new JsonLineChannel(socket, socket, false, TERMINAL_FRAME_BYTES), nonce = randomBytes(32).toString("hex");
    let authenticated = false, chain = Promise.resolve();
    const timer = setTimeout(() => socket.destroy(), 2000);
    const detach = () => { clearTimeout(timer); peers.delete(socket); if (lease === socket) lease = null; };
    socket.on("close", detach); socket.on("error", () => socket.destroy());
    wire.on("error", (error) => { console.error("Terminal owner rejected a control frame:", error.message); socket.destroy(); });
    wire.send({ type: "challenge", protocol: owner.protocol, ownerId: owner.id, profileId: owner.profileId, scopeDigest: owner.scopeDigest,
      buildDigest: owner.buildDigest, pid: process.pid, nonce });
    wire.on("message", (raw) => {
      if (!authenticated) {
        if (!isRecord(raw) || raw.type !== "authenticate" || typeof raw.clientId !== "string" || raw.clientId.length > 128 ||
          typeof raw.clientNonce !== "string" || !/^[a-f0-9]{64}$/.test(raw.clientNonce) || raw.scopeDigest !== owner.scopeDigest ||
          !validTerminalProof(raw.proof, terminalProof(boot.key, "client", nonce, owner.scopeDigest, raw.clientId))) {
          wire.send({ type: "rejected", code: "authentication" }); wire.end(); return;
        }
        if (lease && lease !== socket && !lease.destroyed) { wire.send({ type: "rejected", code: "owner_busy" }); wire.end(); return; }
        lease = socket; authenticated = true; clearTimeout(timer);
        wire.send({ type: "ready", info: info(), proof: terminalProof(boot.key, "server", `${nonce}:${raw.clientNonce}`, owner.scopeDigest, raw.clientId) }); return;
      }
      chain = chain.then(async () => {
        if (lease !== socket) throw new MoguriError("terminal_owner_lost", "This connection no longer owns the terminal controller lease.", 409);
        const request = parse(TerminalRequestSchema, raw);
        let value: unknown;
        if (request.action === "info") value = info();
        else if (request.action === "close-all" || request.action === "dispose") {
          value = await closeAll();
          if (request.action === "dispose" && owner.status !== "stopped") throw new MoguriError("terminal_unconfirmed", "Terminal owner cleanup is unconfirmed. Its endpoint/capability was retained.", 409);
        } else if (request.action === "open") {
          const intent = request.intent, binding = intent.binding;
          const env = owner.remote ? "Remote" : "Local";
          if (owner.status !== "running" || !binding || binding.profileId !== owner.profileId || intent.ownerId !== owner.id || intent.env !== env || binding.env !== env ||
            owner.remote && (binding.env !== "Remote" || binding.peerDigest !== owner.remote.peerDigest) ||
            intent.status !== "starting" || intent.pid !== null || !intent.commandId || !intent.commandDigest || !intent.launchDigest ||
            binding.sessionId !== intent.sessionId || binding.projectId !== intent.projectId || binding.workspaceId !== (intent.workspaceId ?? null)) {
            throw new MoguriError("terminal_intent", "The user terminal launch has no exact admitted owner/root/command binding. Nothing was started.", 409);
          }
          const launchDigest = frameDigest([intent.id, binding, request.launch, intent.cols, intent.rows, intent.title]);
          if (launchDigest !== intent.launchDigest) throw new MoguriError("terminal_intent", "The launch arguments do not match their admitted digest.", 409);
          const previous = seen.get(intent.id);
          if (previous) {
            if (previous !== launchDigest) throw new MoguriError("terminal_idempotency", "This terminal ID owns a different launch. No process was replayed.", 409);
            value = { terminal: state(intent.id), launchDigest };
          } else {
            if (seen.size >= 4096) throw new MoguriError("terminal_owner_capacity", "This owner reached its bounded terminal-history capacity. Close its terminals and restart ownership explicitly.", 409);
            assertTerminalBinding(binding);
            seen.set(intent.id, launchDigest);
            try {
              const started = engine.open({ id: intent.id, sessionId: intent.sessionId, projectId: intent.projectId, workspaceId: intent.workspaceId, root: binding.root },
                intent.cols, intent.rows, undefined, request.launch);
              const terminal: TerminalState = { ...intent, ...started, title: intent.title, env, ownerId: owner.id, binding };
              states.set(intent.id, terminal);
              prune();
              value = { terminal, launchDigest };
            } catch (error) {
              if (!states.has(intent.id)) states.set(intent.id, { ...intent, status: "failed", diagnostic: error instanceof MoguriError ? error.message : "The owned PTY did not start. No launch was replayed." });
              prune();
              throw error;
            }
          }
        } else if (request.action === "inspect") {
          value = { terminal: state(request.terminalId), launchDigest: seen.get(request.terminalId) };
        } else {
          const terminal = state(request.terminalId);
          if (!terminal.binding || terminal.binding.digest !== request.bindingDigest) throw new MoguriError("terminal_binding", "The request does not own this terminal's captured binding. No input or stop was sent.", 409);
          if (request.action === "close") { if (terminal.pid !== null) await engine.close(terminal.id); value = { terminal: state(terminal.id), launchDigest: seen.get(terminal.id) }; }
          else if (request.action === "forget") { if (terminal.pid !== null) engine.forget(terminal.id); states.delete(terminal.id); value = info(); }
          else {
            if (request.action === "read") {
              const read = engine.read(terminal.id, request.offset, request.limit);
              value = { ...read, terminal: state(terminal.id) };
            } else {
              assertTerminalBinding(terminal.binding);
              if (request.action === "input") engine.input({ action: "input", terminalId: terminal.id, data: request.data });
              else engine.input({ action: "resize", terminalId: terminal.id, cols: request.cols, rows: request.rows });
              const updated: TerminalState = { ...terminal, ...engine.info(terminal.id), title: terminal.title }; states.set(terminal.id, updated);
              value = { terminal: updated, launchDigest: seen.get(terminal.id) };
            }
          }
        }
        wire.send({ id: request.id, ok: true, value }, (error) => {
          if (request.action === "dispose" && !error && owner.status === "stopped") { for (const peer of peers) peer.end(); server.close(); }
        });
      }).catch((error: unknown) => {
        const code = error instanceof MoguriError ? error.code : "terminal_owner_failed";
        console.error("Terminal owner operation failed:", code);
        wire.send({ id: isRecord(raw) && typeof raw.id === "string" ? raw.id : "unowned", ok: false, code,
          message: error instanceof MoguriError ? error.message : "Terminal owner operation failed. Inspect its actual state; no work was replayed." });
      });
    });
  });
  process.on("SIGTERM", () => { void closeAll().then((result) => {
    if (result.owner.status !== "stopped") { console.error("Terminal owner shutdown is unconfirmed; endpoint retained."); return; }
    for (const peer of peers) peer.destroy(); server.close();
  }).catch(() => console.error("Terminal owner shutdown failed; inspect its known groups.")); });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(owner.endpoint, resolve); });
    await chmod(owner.endpoint, 0o600);
    process.send?.({ kind: "terminal-owner-ready", owner });
    if (process.connected) process.disconnect?.();
  } catch (error) { await closeAll(); server.close(); throw error; }
}

if (process.argv.includes("--moguri-terminal-owner")) {
  process.once("message", (raw) => {
    void (async () => { const boot = parse(TerminalBootstrapSchema, raw); await runTerminalOwner(boot); })()
      .catch((error: unknown) => {
        console.error("Terminal owner startup failed:", error instanceof MoguriError ? error.code : "terminal_bootstrap");
        process.send?.({ kind: "terminal-owner-failed", diagnostic: "Terminal owner startup failed. No launch was replayed." });
        if (process.connected) process.disconnect?.(); process.exitCode = 1;
      });
  });
}
