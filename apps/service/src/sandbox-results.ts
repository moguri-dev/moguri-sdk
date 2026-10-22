import { isUtf8 } from "node:buffer";
import { homedir } from "node:os";
import { join } from "node:path";
import { MoguriError, parse, SandboxResultSchema, type SandboxExecution, type SandboxResult } from "../../../packages/protocol/src/index.ts";
import { isProtectedProjectPath } from "./files.ts";
import { readNativeCompletion } from "./native-evidence.ts";
import { decodeExecutionFrame, decodeExecutionStatus } from "./execution-journal.ts";
import { executionFrameName } from "./execution-journal.ts";
import type { BridgeFrame } from "./remote-protocol.ts";
import { digest } from "./store.ts";
import { MAX_WORKER_FRAME } from "./worker-wire.ts";

export function sandboxResult(text: string): SandboxResult {
  const result = parse(SandboxResultSchema, JSON.parse(text)), names = new Set<string>();
  let total = 0;
  for (const file of result.files) {
    const name = file.path.normalize("NFC").toLowerCase();
    if (names.has(name) || isProtectedProjectPath(file.path) || file.path.startsWith("/") || /[\\\0]/.test(file.path) ||
      file.path.split("/").some((part) => !part || part === "." || part === "..") ||
      file.text.includes("\0") || !file.text.isWellFormed() || file.bytes !== Buffer.byteLength(file.text) || file.digest !== digest(file.text)) {
      throw new MoguriError("sandbox_result", "Retained native output path, bytes or content digest changed. No output was published.", 409);
    }
    names.add(name); total += file.bytes;
  }
  if (total > 2 * 1024 * 1024) throw new MoguriError("sandbox_result", "Retained native output exceeds its exact 2-MiB boundary. No content was truncated or published.", 409);
  return result;
}
export async function captureSandboxResult(execution: SandboxExecution, key: Buffer, sourcePaths: string[]) {
  if (!execution.nativeSessionId || !execution.planDigest || !execution.signerFingerprint) throw new MoguriError("sandbox_result", "The original native session/plan/signer was never durably bound. No after-state or replacement was inferred.", 409);
  const evidence = await readNativeCompletion({ stateRoot: join(homedir(), ".sendbox", "run"), sessionId: execution.nativeSessionId,
    workspace: execution.stage.workspace, image: execution.image, command: { program: execution.command[0]!, arguments: execution.command.slice(1) },
    createdAfter: execution.createdAfter, createdBefore: execution.createdBefore, planDigest: execution.planDigest, signerFingerprint: execution.signerFingerprint,
    ...(execution.cliExitCode === null ? {} : { exitCode: execution.cliExitCode }) });
  const files: SandboxResult["files"] = [], excluded: SandboxResult["excluded"] = [];
  let total = 0, excludedCount = 0;
  const exclude = (path: string, reason: string) => { excludedCount++; if (excluded.length < 200) excluded.push({ path, reason }); };
  for (const entry of evidence.entries) {
    if (entry.kind.type === "directory") continue;
    if (isProtectedProjectPath(entry.path)) { exclude(entry.path, "Protected runtime, credentials or control state is not a client output file."); continue; }
    if (!["regular", "hardlink"].includes(String(entry.kind.type))) { exclude(entry.path, "Only bounded regular text outputs can be retained or published."); continue; }
    if (typeof entry.kind.size !== "number" || entry.kind.size > 128 * 1024 || files.length >= 200 || total + entry.kind.size > 2 * 1024 * 1024) {
      exclude(entry.path, "Outside the disclosed 200-file, 128-KiB-per-file and 2-MiB aggregate text output boundary."); continue;
    }
    const file = await evidence.read(entry.path);
    if (file.content.includes(0) || !isUtf8(file.content)) { exclude(entry.path, "Binary or non-UTF-8 output remains in the native store, not a text publication."); continue; }
    total += file.content.length;
    files.push({ path: entry.path, text: file.content.toString("utf8"), digest: file.digest, bytes: file.content.length, mode: entry.mode });
  }
  const paths = new Set(evidence.entries.map((entry) => entry.path));
  const frames: BridgeFrame[] = [];
  let cursor = execution.lastSequence, more = false, journal: SandboxResult["journal"] = { status: "verified", diagnostic: null };
  try {
    const directory = `.moguri/execution/${execution.id}`, saved = decodeExecutionStatus(key, (await evidence.read(`${directory}/status.json`, 64 * 1024)).content);
    if (saved.status.runId !== execution.id || saved.info.workerDigest !== execution.workerDigest || saved.info.root !== execution.root ||
      saved.info.native?.bridgeDigest !== execution.config.qualification?.bridgeDigest ||
      cursor < saved.status.acknowledged || cursor > saved.status.sequence) throw new MoguriError("sandbox_journal", "Native after-state journal changed its exact run/build/root or durable cursor.", 409);
    let size = 0;
    while (cursor < saved.status.sequence && frames.length < 128) {
      const content = (await evidence.read(`${directory}/${executionFrameName(cursor + 1)}`, MAX_WORKER_FRAME)).content;
      size += content.length;
      if (size > MAX_WORKER_FRAME) throw new MoguriError("sandbox_journal", "Native unacknowledged replay data exceeds its 32-MiB boundary. No work was resumed.", 409);
      const frame = decodeExecutionFrame(key, content);
      if (frame.sequence !== cursor + 1) throw new MoguriError("sandbox_journal", "Native after-state frame has a cursor gap. No work was resumed.", 409);
      frames.push(frame); cursor++;
    }
    more = cursor < saved.status.sequence;
  } catch (error) {
    console.error("Native after-state journal validation failed:", error instanceof MoguriError ? error.code : "native_journal_unconfirmed");
    frames.length = 0; cursor = execution.lastSequence;
    journal = { status: "unconfirmed", diagnostic: error instanceof MoguriError ? error.message : "Original native journal is missing, corrupt or unavailable. Model holds remain unknown; no effect or model call was replayed." };
  }
  const result = sandboxResult(JSON.stringify({ format: "moguri-native-result", version: 1, executionId: execution.id, workspaceId: execution.workspaceId,
    inputDigest: execution.inputDigest, nativeSessionId: execution.nativeSessionId, planDigest: evidence.planDigest, signerFingerprint: evidence.signerFingerprint,
    auditDigest: evidence.auditDigest, beforeId: evidence.beforeId, afterId: evidence.afterId, afterBinding: evidence.afterBinding, rollback: evidence.rollback, exitCode: evidence.exitCode,
    files, excluded, excludedCount, deletedPaths: sourcePaths.filter((path) => !paths.has(path)), journal }));
  return { result, frames, cursor, more };
}
