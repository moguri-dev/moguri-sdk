import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Value } from "typebox/value";
import { MoguriError, parse } from "../../../packages/protocol/src/index.ts";
import { BridgeEnvelopeSchema, SavedStatusSchema, type BridgeFrame, type BridgeInfo, type BridgeStatus, type SavedStatus } from "./remote-protocol.ts";
import type { WorkerRequest } from "./worker-protocol.ts";
import { frameDigest, MAX_WORKER_FRAME } from "./worker-wire.ts";

export const executionFrameName = (sequence: number) => `${String(sequence).padStart(12, "0")}.bin`;
const fail = (message: string): never => { throw new MoguriError("execution_journal", `${message} No execution or effect was replayed.`, 409); };
const proof = (key: Buffer, value: Omit<SavedStatus, "proof">) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
const json = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
async function privateRoot(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!isAbsolute(directory) || !metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
    metadata.mode & 0o077 || await realpath(directory) !== directory) fail("Execution journal ownership/path is invalid.");
}
async function readBounded(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.uid !== process.getuid?.() || before.mode & 0o077 || before.size > maximum) fail("Execution journal file is not private, regular or bounded.");
    const chunks: Buffer[] = []; let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - total)), read = await file.read(chunk, 0, chunk.length, null);
      if (!read.bytesRead) break;
      total += read.bytesRead;
      if (total > maximum) fail("Execution journal grew beyond its byte bound.");
      chunks.push(chunk.subarray(0, read.bytesRead));
    }
    const after = await file.stat();
    if (before.size !== total || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail("Execution journal changed while being read.");
    return Buffer.concat(chunks, total);
  } finally { await file.close(); }
}
async function writeSynced(path: string, value: string | Buffer): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(directory: string): Promise<void> {
  const file = await open(directory, "r");
  try { await file.sync(); } finally { await file.close(); }
}
export function encryptExecutionFrame(key: Buffer, value: unknown): Buffer {
  if (key.length !== 32) return fail("Execution journal key must contain exactly 32 bytes.");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]);
}
export function decodeExecutionFrame(key: Buffer, value: Buffer): BridgeFrame {
  if (key.length !== 32 || value.length < 28 || value.length > MAX_WORKER_FRAME) return fail("Execution journal encrypted frame bounds are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  const decoded = json(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]));
  if (!Value.Check(BridgeEnvelopeSchema, decoded) || decoded.kind !== "frame" || decoded.digest !== frameDigest(decoded.request)) return fail("Execution journal frame authentication or digest failed.");
  return decoded;
}
export async function saveExecutionStatus(directory: string, key: Buffer, status: BridgeStatus, info: BridgeInfo): Promise<void> {
  const saved = { status: structuredClone(status), info: structuredClone(info) }, value = { ...saved, proof: proof(key, saved) };
  if (!Value.Check(SavedStatusSchema, value)) fail("Execution status has incompatible schema or identity.");
  const temporary = join(directory, `status-${randomBytes(8).toString("hex")}.tmp`);
  await writeSynced(temporary, JSON.stringify(value));
  await rename(temporary, join(directory, "status.json")); await syncDirectory(directory);
}
export function decodeExecutionStatus(key: Buffer, bytes: Uint8Array): SavedStatus {
  const value = json(bytes);
  if (!Value.Check(SavedStatusSchema, value)) return fail("Execution status metadata is corrupt.");
  const expected = proof(key, { status: value.status, info: value.info });
  if (key.length !== 32 || !timingSafeEqual(Buffer.from(value.proof, "hex"), Buffer.from(expected, "hex"))) return fail("Execution identity/key proof does not match.");
  return value;
}
export async function loadExecutionStatus(directory: string, key: Buffer): Promise<SavedStatus> {
  return decodeExecutionStatus(key, await readBounded(join(directory, "status.json"), 64 * 1024));
}
export async function readExecutionFrames(directory: string, key: Buffer, after: number): Promise<BridgeFrame[]> {
  return executionFrames(await readdir(directory), key, after, (name, maximum) => readBounded(join(directory, name), maximum));
}
type JournalRead = (name: string, maximum: number) => Promise<Buffer>;
async function executionFrames(entries: readonly string[], key: Buffer, after: number, read: JournalRead): Promise<BridgeFrame[]> {
  const names = entries.filter((name) => /^\d{12}\.bin$/.test(name) && Number(name.slice(0, 12)) > after).sort();
  const result: BridgeFrame[] = []; let bytes = 0;
  for (const name of names) {
    const value = await read(name, MAX_WORKER_FRAME); bytes += value.length;
    if (bytes > MAX_WORKER_FRAME / 2 && result.length || result.length >= 128) break;
    const frame = decodeExecutionFrame(key, value);
    if (executionFrameName(frame.sequence) !== name) fail("Execution journal frame identity changed.");
    result.push(frame);
  }
  return result;
}
export async function inspectExecutionJournal(directory: string, key: Buffer, after: number) {
  await privateRoot(directory);
  return inspectExecutionJournalSource(key, after, () => readdir(directory), (name, maximum) => readBounded(join(directory, name), maximum));
}
export async function inspectExecutionJournalSource(key: Buffer, after: number, names: () => Promise<readonly string[]>, source: JournalRead) {
  const read: JournalRead = async (name, maximum) => {
    const value = await source(name, maximum);
    if (value.length > maximum) fail("Original execution journal bytes exceed their requested bound.");
    return value;
  };
  const saved = decodeExecutionStatus(key, await read("status.json", 64 * 1024));
  if (!Number.isSafeInteger(after) || after < saved.status.acknowledged || after > saved.status.sequence) return fail("Execution journal durable cursor is outside its retained range.");
  const frames = (await executionFrames(await names(), key, after, read)).filter((frame) => frame.sequence <= saved.status.sequence);
  if (frames.some((frame, index) => frame.sequence !== after + index + 1) || after < saved.status.sequence && !frames.length) fail("Execution journal has a missing unacknowledged frame.");
  return { ...saved, frames };
}
export class ExecutionJournal {
  private queue: Promise<void> = Promise.resolve();
  private bytes = 0;
  private failure?: Error;
  private constructor(private readonly directory: string, private readonly key: Buffer, private readonly info: BridgeInfo, private state: BridgeStatus) {}
  static async create(directory: string, key: Buffer, info: BridgeInfo, status: BridgeStatus): Promise<ExecutionJournal> {
    if (key.length !== 32 || status.sequence !== 0 || status.acknowledged !== 0) fail("A new execution journal needs its exact key and initial cursor.");
    await mkdir(directory, { recursive: true, mode: 0o700 }); await privateRoot(directory);
    await writeSynced(join(directory, "owner.json"), JSON.stringify({ format: "moguri-execution-journal", version: 1, runId: status.runId }));
    const journal = new ExecutionJournal(directory, Buffer.from(key), structuredClone(info), structuredClone(status));
    await saveExecutionStatus(directory, key, status, info); return journal;
  }
  get status(): BridgeStatus { return structuredClone(this.state); }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(() => { if (this.failure) throw this.failure; return operation(); });
    this.queue = task.then(() => {}, (error: unknown) => { this.failure ??= error instanceof Error ? error : new Error("Execution journal storage failed."); });
    return task;
  }
  append(request: WorkerRequest): Promise<BridgeFrame> {
    return this.serialize(async () => {
      if (this.state.sequence >= 999_999_999_999) fail("Execution journal sequence bound was reached.");
      const frame: BridgeFrame = { kind: "frame", sequence: this.state.sequence + 1, digest: frameDigest(request), request: structuredClone(request) };
      const value = encryptExecutionFrame(this.key, frame);
      if (this.bytes + value.length > MAX_WORKER_FRAME) fail("Execution journal unacknowledged capacity was exhausted.");
      await writeSynced(join(this.directory, executionFrameName(frame.sequence)), value);
      const next = { ...this.state, sequence: frame.sequence };
      await saveExecutionStatus(this.directory, this.key, next, this.info);
      this.state = next; this.bytes += value.length; return frame;
    });
  }
  update(changes: Partial<Pick<BridgeStatus, "workerPid" | "status" | "cancellation" | "cleanup" | "diagnostic">>): Promise<void> {
    return this.serialize(async () => {
      const next = { ...this.state, ...structuredClone(changes) };
      await saveExecutionStatus(this.directory, this.key, next, this.info); this.state = next;
    });
  }
  acknowledge(sequence: number): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < this.state.acknowledged || sequence > this.state.sequence) return Promise.reject(new MoguriError("execution_journal", "Execution journal durable cursor is invalid. No frame was removed.", 409));
    return this.serialize(async () => {
      if (!Number.isSafeInteger(sequence) || sequence < this.state.acknowledged || sequence > this.state.sequence) fail("Execution journal durable cursor is invalid.");
      const next = { ...this.state, acknowledged: sequence };
      await saveExecutionStatus(this.directory, this.key, next, this.info);
      for (let current = this.state.acknowledged + 1; current <= sequence; current++) {
        const path = join(this.directory, executionFrameName(current)), file = await lstat(path);
        await unlink(path); this.bytes -= file.size;
      }
      await syncDirectory(this.directory); this.state = next;
    });
  }
}

export interface ForegroundSink {
  send(value: unknown, callback?: (error: Error | null) => void): void;
  end(): void;
  acknowledge?(sequence: number): Promise<void>;
}
export function journaledForegroundSink(wire: ForegroundSink, journal: ExecutionJournal, failed: (error: Error) => void): ForegroundSink & { acknowledge(sequence: number): Promise<void> } {
  let queue: Promise<void> = Promise.resolve(), failure: Error | undefined;
  return {
    send(value, callback) {
      const packet = structuredClone(value);
      const task = queue.then(async () => {
        if (failure) throw failure;
        const envelope = parse(BridgeEnvelopeSchema, packet);
        if (envelope.kind === "frame") {
          const saved = await journal.append(envelope.request);
          if (saved.sequence !== envelope.sequence || saved.digest !== envelope.digest) fail("Foreground frame/cursor identity changed before delivery.");
        } else if (envelope.kind === "ready" || envelope.kind === "status") {
          const status = envelope.status;
          if (status.runId !== journal.status.runId || status.sequence !== journal.status.sequence) fail("Foreground status belongs to another run or cursor.");
          await journal.update({ workerPid: status.workerPid, status: status.status, cancellation: status.cancellation, cleanup: status.cleanup, diagnostic: status.diagnostic });
          envelope.status = journal.status;
        }
        await new Promise<void>((resolve, reject) => wire.send(envelope, (error) => error ? reject(error) : resolve()));
        callback?.(null);
      });
      queue = task.catch((error: unknown) => {
        const actual = error instanceof Error ? error : new Error("Foreground journal delivery failed.");
        if (!failure) {
          failure = actual;
          wire.send({ kind: "error", code: "execution_journal", message: "Owned execution journal persistence/delivery failed. Accounting and cleanup remain unconfirmed; no work was replayed." });
          failed(actual);
        }
        callback?.(actual);
      });
    },
    async acknowledge(sequence) {
      await queue;
      if (failure) throw failure;
      await journal.acknowledge(sequence);
    },
    end() { void queue.then(() => wire.end()); },
  };
}
