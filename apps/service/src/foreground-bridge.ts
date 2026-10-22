import { fork } from "node:child_process";
import { Value } from "typebox/value";
import { isRecord } from "../../../packages/protocol/src/index.ts";
import { parentMessage, WorkerRequestSchema, type WorkerRequest } from "./worker-protocol.ts";
import { frameDigest, MAX_WORKER_FRAME } from "./worker-wire.ts";
import { ForegroundQuerySchema, type BridgeInfo, type BridgeInit, type BridgeStatus } from "./remote-protocol.ts";
import { workerCatalog } from "./worker-queries.ts";
import { repositoryContext } from "./project-policy.ts";
import type { ForegroundSink } from "./execution-journal.ts";

const proxyVariables = ["ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy", "NODE_USE_ENV_PROXY"] as const;
export function foregroundEnvironment(runId: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, MOGURI_TURN_ID: runId };
  for (const key of proxyVariables) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}
export function foregroundWorker(workerPath: string, init: BridgeInit, info: BridgeInfo, wire: ForegroundSink): { receive(raw: unknown): Promise<void>; disconnect(): void } {
  if (!init.runId || !init.key) throw new Error("Foreground execution needs its exact run identity.");
  const status: BridgeStatus = { runId: init.runId, workerPid: null, port: 0, acknowledged: 0, sequence: 0, status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null };
  const child = fork(workerPath, [], { execPath: process.execPath, execArgv: process.execArgv, stdio: ["ignore", "ignore", "pipe", "ipc"], env: foregroundEnvironment(init.runId) });
  let started = false, settled = false, lost = false, finalAcknowledged = false, final: Extract<WorkerRequest, { kind: "finished" }> | undefined, queued = 0;
  const pending = new Map<number, number>();
  const queries = new Set<AbortController>();
  const queryIds = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined, escalation: ReturnType<typeof setTimeout> | undefined;
  const publish = () => wire.send({ kind: "status", status });
  const stop = (controlLost: boolean) => {
    if (settled) return;
    for (const query of queries) query.abort();
    lost ||= controlLost; status.cancellation = status.cancellation === "acknowledged" ? "acknowledged" : "requested"; status.status = "stopping"; publish();
    if (child.connected) child.send({ kind: controlLost ? "control-lost" : "stop" });
    timer ??= setTimeout(() => {
      status.cancellation = "unconfirmed"; status.cleanup = "unconfirmed"; status.diagnostic = "Foreground worker did not acknowledge full cleanup. Native VM teardown remains required."; publish();
      child.kill("SIGTERM"); escalation = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, 5000);
  };
  const fail = (message: string) => { wire.send({ kind: "error", code: "foreground_protocol", message }); stop(true); };
  const launchDeadline = setTimeout(() => { if (!started && !settled) fail("No exact foreground start arrived within 15 seconds. No model or tool was started."); }, 15_000);
  child.once("spawn", () => { status.workerPid = child.pid ?? null; status.status = "running"; wire.send({ kind: "ready", info, status }); });
  child.on("message", (raw: unknown) => {
    if (!Value.Check(WorkerRequestSchema, raw)) { fail("Foreground worker returned an incompatible request. No continuation was authorized."); return; }
    const frame = { kind: "frame", sequence: ++status.sequence, digest: frameDigest(raw), request: raw }, bytes = Buffer.byteLength(JSON.stringify(frame));
    if (queued + bytes > MAX_WORKER_FRAME) { fail("Foreground unacknowledged frames exceeded 32 MiB. Native cleanup is required."); return; }
    queued += bytes; pending.set(frame.sequence, bytes);
    if (raw.kind === "ack") status.cancellation = "acknowledged";
    if (raw.kind === "finished") final = raw;
    wire.send(frame);
  });
  child.stderr?.on("data", (data: Buffer) => {
    const codes = [...new Set(data.toString().match(/\b(?:ERR_[A-Z_]+|MODULE_NOT_FOUND|EACCES|ENOENT|EPERM)\b/g) ?? [])];
    const text = `Foreground worker emitted credential-private stderr${codes.length ? ` (${codes.join(", ")})` : ""}. Check its exact runtime/native dependencies.`;
    console.error(text); wire.send({ kind: "stderr", text });
  });
  child.once("error", () => fail("The foreground Node worker could not launch. No Local fallback or alternate worker was used."));
  child.once("exit", (code, signal) => {
    settled = true; clearTimeout(timer); clearTimeout(escalation); clearTimeout(launchDeadline);
    for (const query of queries) query.abort();
    status.status = final && finalAcknowledged ? final.outcome : lost || status.cancellation !== "none" || final ? "partial" : "failed";
    status.cleanup = "owned-worker-stopped";
    status.diagnostic = final && finalAcknowledged ? final.diagnostic : `Foreground worker ended (${signal ?? code}) without an acknowledged terminal result. Native VM cleanup still requires verification.`;
    process.exitCode = status.status === "completed" ? 0 : status.status === "stopped" ? 130 : status.status === "partial" ? 2 : 1;
    wire.send({ kind: "status", status }, () => { wire.end(); process.stdin.destroy(); });
  });
  return {
    disconnect: () => stop(true),
    async receive(raw) {
      if (!isRecord(raw)) { fail("Invalid foreground parent frame."); return; }
      if (raw.kind === "query") {
        if (lost || settled || !Value.Check(ForegroundQuerySchema, raw) || queryIds.has(raw.requestId) || queries.size >= 8) { fail("Foreground query is duplicate, unbounded or outside the current control authority."); return; }
        const abort = new AbortController(); queries.add(abort);
        queryIds.add(raw.requestId);
        void (async () => {
          try {
            const result = raw.query.type === "catalog" ? await workerCatalog(raw.query.catalog, abort.signal) :
              info.root ? { type: "context" as const, text: await repositoryContext(info.root, raw.query.settings) } : null;
            abort.signal.throwIfAborted();
            if (!result) throw new Error("No filesystem root was approved for repository context.");
            wire.send({ kind: "query-result", runId: init.runId, requestId: raw.requestId, result });
          } catch {
            wire.send({ kind: "query-error", runId: init.runId, requestId: raw.requestId, code: "foreground_query", message: abort.signal.aborted ? "Owned foreground query was cancelled; no fallback." : "The execution-side query failed. Check the approved root, endpoint and native proxy policy; no Local fallback or alternate provider." });
          } finally { queries.delete(abort); queryIds.delete(raw.requestId); }
        })();
        return;
      }
      if (raw.kind === "ack") {
        if (typeof raw.sequence !== "number" || !Number.isSafeInteger(raw.sequence) || raw.sequence < status.acknowledged || raw.sequence > status.sequence) { fail("Invalid foreground durable cursor."); return; }
        for (const [sequence, bytes] of pending) if (sequence <= raw.sequence) { queued -= bytes; pending.delete(sequence); }
        await wire.acknowledge?.(raw.sequence);
        status.acknowledged = raw.sequence; return;
      }
      if (raw.kind !== "parent" || lost || settled) { fail("Foreground authority is disconnected or incompatible. No effect was replayed."); return; }
      let message;
      try { message = parentMessage(raw.message); } catch { fail("Invalid foreground worker parent message."); return; }
      if (message.kind === "start") {
        if (started || message.root !== info.root || typeof message.readOnly !== "boolean") { fail("A foreground worker cannot start twice or change its approved root."); return; }
        started = true; clearTimeout(launchDeadline);
      } else if (message.kind === "stop" || message.kind === "control-lost") { stop(message.kind === "control-lost"); return; }
      else if (!started) { fail("A reply arrived before the exact foreground start."); return; }
      if (message.kind === "reply" && message.requestId === final?.requestId && !message.error && message.value && "accepted" in message.value && message.value.accepted === true) finalAcknowledged = true;
      if (!child.connected) { fail("The owned foreground worker is disconnected."); return; }
      child.send(message, (error) => { if (error) fail("Foreground IPC delivery failed. Cleanup remains unconfirmed."); });
    },
  };
}
