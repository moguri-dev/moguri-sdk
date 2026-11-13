import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isatty } from "node:tty";
import { isRecord, MoguriError } from "../../../packages/protocol/src/index.ts";
import { MAX_WORKER_FRAME } from "./worker-wire.ts";

const fail = (message: string): never => { throw new MoguriError("private_control", `${message} No control frame or effect was replayed.`, 409); };
const bytes = (value: unknown, length?: number): Buffer => {
  if (typeof value !== "string") return fail("Private control encoding is invalid.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || length !== undefined && decoded.length !== length || decoded.length > MAX_WORKER_FRAME) return fail("Private control byte bounds are invalid.");
  return decoded;
};
export function preparePrivateControlTty(): boolean {
  if (!isatty(0) || !isatty(1)) return false;
  // Initialize the guest before libuv saves its mode; the outer host PTY is independent.
  const result = spawnSync("/bin/stty", ["-echo"], { stdio: ["inherit", "ignore", "pipe"], timeout: 5000 });
  if (result.error || result.signal || result.status !== 0) {
    const reason = result.error?.message ?? result.signal ?? `exit ${result.status ?? "unknown"}`;
    throw new MoguriError("private_control_tty", `Private control terminal echo initialization failed: ${reason.slice(0, 512)}. No bootstrap or worker was started.`, 409);
  }
  process.stdin.setRawMode(true);
  return true;
}
export class PrivateControl {
  private sent = 0;
  private received = 0;
  private readonly key: Buffer;
  constructor(private readonly runId: string, key: Buffer, private readonly role: "controller" | "worker") {
    if (key.length !== 32 || !/^[a-f0-9-]{36}$/.test(runId)) fail("Private control owner/key identity is invalid.");
    this.key = createHmac("sha256", key).update("moguri-private-control-v1").digest();
  }
  private aad(direction: string, sequence: number): Buffer {
    return Buffer.from(JSON.stringify({ format: "moguri-private-control", version: 1, runId: this.runId, direction, sequence }));
  }
  encode(value: unknown) {
    if (this.sent === Number.MAX_SAFE_INTEGER) return fail("Private control sequence limit was reached.");
    const text = JSON.stringify(value);
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_WORKER_FRAME / 1.5) return fail("Private control plaintext exceeds its bounded transport capacity.");
    const sequence = ++this.sent, nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(this.aad(this.role, sequence));
    const data = Buffer.concat([cipher.update(text), cipher.final()]);
    return { kind: "sealed", version: 1, runId: this.runId, direction: this.role, sequence,
      nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  }
  decode(value: unknown): unknown {
    const direction = this.role === "controller" ? "worker" : "controller";
    if (!isRecord(value) || Object.keys(value).length !== 8 || value.kind !== "sealed" || value.version !== 1) return fail("Private control frame format is invalid.");
    if (value.runId !== this.runId) return fail("Private control owner identity is invalid.");
    if (value.direction !== direction) return fail(`Private control direction is invalid (expected ${direction}; received ${
      value.direction === "controller" || value.direction === "worker" ? value.direction : "unrecognized"}).`);
    if (value.sequence !== this.received + 1) return fail("Private control sequence/cursor is duplicate, missing or replayed.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, bytes(value.nonce, 12));
      decipher.setAAD(this.aad(direction, this.received + 1)); decipher.setAuthTag(bytes(value.tag, 16));
      const content = Buffer.concat([decipher.update(bytes(value.data)), decipher.final()]);
      const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
      this.received++; return result;
    } catch (error) {
      if (error instanceof MoguriError) throw error;
      return fail("Private control authentication/decryption failed.");
    }
  }
}
