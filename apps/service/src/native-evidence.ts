import { createHash, createPublicKey, verify } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { isRecord, MoguriError } from "../../../packages/protocol/src/index.ts";

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function fail(message: string): never { throw new MoguriError("native_evidence", `${message} No native success, publication or replay was authorized.`, 409); }
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : fail("Native evidence has an invalid object.");
const text = (value: unknown): string => {
  if (typeof value !== "string") return fail("Native evidence has an invalid string.");
  for (const character of value) { const code = character.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) return fail("Native evidence has invalid Unicode."); }
  return value;
};
const exact = (value: Record<string, unknown>, fields: string[]) => {
  if (Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) fail("Native evidence has unsupported fields.");
};
const decimal = (value: unknown): number => uint(value) ? value : fail("Native evidence has an unsafe unsigned integer.");
const nullableTime = (value: unknown): number | null => value === null ? null : decimal(value);
const compare = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const pathName = (value: unknown): string => {
  const path = text(value);
  if (!path || path.length > 4096 || isAbsolute(path) || /[\\\u0000]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) fail("Native evidence has an unsafe relative path.");
  return path;
};
const json = (bytes: Buffer): unknown => {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail("Native evidence is not bounded valid UTF-8 JSON."); }
};
const base64 = (value: unknown, length: number): Buffer => {
  const encoded = text(value), bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== length || bytes.toString("base64") !== encoded) fail("Native evidence has invalid public signature bytes.");
  return bytes;
};

function minify(source: string): string {
  let result = "", quoted = false, escaped = false;
  for (const character of source) {
    if (quoted || !/\s/.test(character)) result += character;
    if (quoted && escaped) escaped = false;
    else if (quoted && character === "\\") escaped = true;
    else if (character === '"') quoted = !quoted;
  }
  return result;
}

// Preserve serde's original field order and integer bytes rather than re-encoding the inner plan.
function planBytes(bytes: Buffer): Buffer {
  const source = minify(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const fields = new Map<string, string>();
  const endString = (start: number): number => {
    let escaped = false;
    for (let index = start + 1; index < source.length; index++) {
      const character = source[index];
      if (!escaped && character === '"') return index + 1;
      if (!escaped && character === "\\") escaped = true; else escaped = false;
    }
    return fail("Native plan has an unfinished string.");
  };
  let index = 1;
  while (index < source.length - 1) {
    const keyEnd = endString(index), key: unknown = JSON.parse(source.slice(index, keyEnd));
    if (typeof key !== "string" || source[keyEnd] !== ":" || fields.has(key)) fail("Native plan has duplicate or invalid envelope fields.");
    index = keyEnd + 1;
    const start = index;
    if (source[index] === '"') index = endString(index);
    else if (source[index] === "{" || source[index] === "[") {
      let depth = 0;
      do {
        if (source[index] === '"') { index = endString(index); continue; }
        if (source[index] === "{" || source[index] === "[") depth++;
        if (source[index] === "}" || source[index] === "]") depth--;
        index++;
      } while (depth && index < source.length);
    } else while (index < source.length && source[index] !== "," && source[index] !== "}") index++;
    fields.set(key, source.slice(start, index));
    if (source[index] === ",") index++; else break;
  }
  const plan = fields.get("plan");
  if (!plan || fields.size !== 5) fail("Native signed plan has an unsupported envelope.");
  return Buffer.from(plan);
}

function signature(value: unknown, identity: Record<string, unknown>, content: Buffer, kind: string, name: string, bindings: Record<string, string>): string {
  const signed = record(value), subject = record(signed.subject), metadata = record(signed.metadata);
  exact(signed, ["format", "version", "signature_id", "subject", "signer_fingerprint", "signed_at_unix", "expires_at_unix", "metadata", "signature_base64"]);
  exact(subject, ["kind", "sha256", "name"]);
  exact(identity, ["version", "fingerprint", "name", "email", "public_key_base64", "valid_from_unix", "expires_at_unix", "revoked_at_unix"]);
  text(identity.name); if (identity.email !== null) text(identity.email);
  if (signed.format !== "sendbox-provenance" || signed.version !== 1 || typeof signed.signature_id !== "string" || !/^[a-f0-9]{32}$/.test(signed.signature_id)) fail("Native provenance version or identity is unsupported.");
  const publicBytes = base64(identity.public_key_base64, 32), fingerprint = hash(publicBytes);
  if (identity.version !== 1 || identity.fingerprint !== fingerprint || signed.signer_fingerprint !== fingerprint || identity.revoked_at_unix !== null) fail("Native provenance does not match its unrevoked public identity.");
  const signedAt = decimal(signed.signed_at_unix), expiry = nullableTime(signed.expires_at_unix), identityExpiry = nullableTime(identity.expires_at_unix);
  if (decimal(identity.valid_from_unix) > signedAt || expiry !== null && expiry < signedAt || identityExpiry !== null && identityExpiry < signedAt) fail("Native provenance predates or exceeds signer validity.");
  if (subject.kind !== kind || subject.name !== name || subject.sha256 !== hash(content)) fail("Native provenance subject bytes do not match.");
  if (Object.keys(metadata).length > 32 || Object.entries(bindings).some(([key, value]) => metadata[key] !== value)) fail("Native provenance belongs to another session or plan.");
  const pairs = Object.keys(metadata).sort(compare).map((key) => {
    if (!key || Buffer.byteLength(text(key)) > 128 || Buffer.byteLength(text(metadata[key])) > 4096) fail("Native provenance metadata exceeds bounds.");
    return `${JSON.stringify(key)}:${JSON.stringify(metadata[key])}`;
  });
  const prefix = JSON.stringify({
    format: signed.format, version: signed.version, signature_id: signed.signature_id,
    subject: { kind: subject.kind, sha256: subject.sha256, name: subject.name },
    signer_fingerprint: fingerprint, signed_at_unix: signedAt, expires_at_unix: expiry,
  });
  const payload = `${prefix.slice(0, -1)},"metadata":{${pairs.join(",")}}}`;
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBytes]), format: "der", type: "spki" });
  if (!verify(null, Buffer.concat([Buffer.from("sendbox-provenance-signature-v1\0"), Buffer.from(payload)]), key, base64(signed.signature_base64, 64))) fail("Native public signature validation failed.");
  return fingerprint;
}

interface Entry { path: string; mode: number; kind: Record<string, unknown> }
function manifest(value: unknown): { id: string; entries: Entry[] } {
  const saved = record(value);
  exact(saved, ["format", "version", "id", "entries", "total_size"]);
  if (saved.format !== "sendbox-snapshot" || saved.version !== 1 || !hex(saved.id) || !Array.isArray(saved.entries) || saved.entries.length > 100_000) return fail("Native snapshot layout is unsupported.");
  const entries: Entry[] = saved.entries.map((value) => {
    const entry = record(value), kind = record(entry.kind), path = pathName(entry.path), mode = decimal(entry.mode);
    exact(entry, ["path", "mode", "kind"]);
    if (mode > 0o7777) fail("Native snapshot mode is invalid.");
    let normalized: Record<string, unknown>;
    if (kind.type === "regular") {
      exact(kind, ["type", "content_hash", "size"]); if (!hex(kind.content_hash)) fail("Native snapshot has an invalid object digest.");
      normalized = { type: kind.type, content_hash: kind.content_hash, size: decimal(kind.size) };
    } else if (kind.type === "directory") { exact(kind, ["type"]); normalized = { type: kind.type }; }
    else if (kind.type === "symlink") { exact(kind, ["type", "target"]); normalized = { type: kind.type, target: text(kind.target) }; }
    else if (kind.type === "hardlink") { exact(kind, ["type", "source", "size"]); normalized = { type: kind.type, source: pathName(kind.source), size: decimal(kind.size) }; }
    else return fail("Native snapshot contains an unsupported entry.");
    return { path, mode, kind: normalized };
  });
  for (let index = 1; index < entries.length; index++) if (compare(entries[index - 1]!.path, entries[index]!.path) >= 0) fail("Native snapshot paths are duplicated or out of order.");
  if (hash(JSON.stringify({ format: saved.format, version: saved.version, entries, total_size: decimal(saved.total_size) })) !== saved.id) fail("Native snapshot ID does not match its versioned hash content.");
  return { id: saved.id, entries };
}

async function privateDirectory(path: string): Promise<string> {
  const actual = await realpath(path), metadata = await lstat(path);
  if (actual !== path || !metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077) fail("Native evidence directory is not canonical, private and user-owned.");
  return actual;
}
async function bytes(path: string, limit: number): Promise<Buffer> {
  if (await realpath(path) !== path) return fail("Native evidence cannot follow a filesystem alias.");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || metadata.mode & 0o022 || metadata.size > limit) return fail("Native evidence file is not regular, owned and bounded.");
    const chunks: Buffer[] = []; let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total)), read = await file.read(chunk, 0, chunk.length, null);
      if (!read.bytesRead) break;
      total += read.bytesRead;
      if (total > limit) return fail("Native evidence grew beyond its requested bound.");
      chunks.push(chunk.subarray(0, read.bytesRead));
    }
    const final = await file.stat();
    if (total !== metadata.size || final.size !== metadata.size || final.mtimeMs !== metadata.mtimeMs) return fail("Native evidence changed while being read.");
    return Buffer.concat(chunks, total);
  } finally { await file.close(); }
}
const sessionHex = (value: unknown): string => {
  if (typeof value === "string" && /^[a-f0-9]{32}$/.test(value)) return value;
  if (Array.isArray(value) && value.length === 16 && value.every((part) => uint(part) && part <= 255)) return Buffer.from(value).toString("hex");
  return fail("Native evidence has an invalid session binding.");
};

export interface NativeBoundaryInput {
  stateRoot: string; sessionId: string; workspace: string; image: string;
  command: { program: string; arguments: string[] }; createdAfter: number; createdBefore: number;
}
export interface NativeRollbackInput extends NativeBoundaryInput {
  exitCode: number; file: string; maxBytes?: number;
  baseline?: Record<string, string>;
}
export interface NativeCompletionInput extends NativeBoundaryInput {
  exitCode?: number; planDigest?: string; signerFingerprint?: string; baseline?: Record<string, string>;
}
async function boundary(input: NativeBoundaryInput) {
  const sid = sessionHex(input.sessionId), root = join(await privateDirectory(input.stateRoot), "sessions", sid);
  await privateDirectory(root);
  if (!uint(input.createdAfter) || !uint(input.createdBefore) || input.createdAfter > input.createdBefore) fail("Native boundary needs a captured launch interval.");
  const planRaw = await bytes(join(root, "boundary-plan.json"), 16 * 1024 * 1024), envelope = record(json(planRaw)), plan = record(envelope.plan), identity = record(envelope.signer);
  if (envelope.format !== "sendbox-signed-boundary-plan" || envelope.version !== 3 || plan.format !== "sendbox-boundary-plan" || plan.version !== 3) fail("Native boundary version is unsupported.");
  if (sessionHex(plan.session_id) !== sid || record(plan.workspace).source !== input.workspace || record(plan.workload).reference !== input.image || record(plan.provider).runtime !== "apple") fail("Native boundary belongs to another workspace, image or runtime.");
  const command = record(plan.command), created = decimal(plan.created_at_unix);
  if (command.program !== input.command.program || JSON.stringify(command.arguments) !== JSON.stringify(input.command.arguments) || created < input.createdAfter || created > input.createdBefore) fail("Native boundary does not match the captured command/time.");
  const planContent = planBytes(planRaw), planDigest = hash(planContent);
  const signerFingerprint = signature(envelope.signature, identity, planContent, "configuration", `boundary-plan:${sid}`, { format: "sendbox-boundary-plan", runtime: "apple", session_id: sid });
  return { sid, root, identity, planDigest, signerFingerprint };
}
export async function readNativeBoundary(input: NativeBoundaryInput) {
  const value = await boundary(input);
  return { sessionId: value.sid, planDigest: value.planDigest, signerFingerprint: value.signerFingerprint,
    workspace: input.workspace, image: input.image };
}
export async function readNativeCompletion(input: NativeCompletionInput) {
  const { sid, root, identity, planDigest, signerFingerprint } = await boundary(input);
  if (input.planDigest !== undefined && input.planDigest !== planDigest || input.signerFingerprint !== undefined && input.signerFingerprint !== signerFingerprint) fail("Native completion changed its originally bound plan or signer.");
  const auditRaw = await bytes(join(root, "audit-log.json"), 16 * 1024 * 1024), audit = record(json(auditRaw));
  signature(json(await bytes(join(root, "audit-log.signature.json"), 64 * 1024)), identity, auditRaw, "artifact", "audit-log.json", { session_id: sid, boundary_plan_digest: planDigest });
  if (audit.format !== "sendbox-host-audit-publication" || audit.version !== 1 || audit.session_id !== sid || audit.boundary_plan_digest !== planDigest || !Array.isArray(audit.records) || audit.event_count !== audit.records.length) fail("Native signed audit does not match the captured boundary.");
  const events = audit.records.map((value) => record(record(value).event));
  if (events.some((event) => event.version !== 1 || sessionHex(event.session_id) !== sid)) fail("Native audit contains a foreign or unsupported event.");
  const before = events.filter((event) => event.action === "before_snapshot_captured" && event.result === "success");
  if (before.length !== 1 || !hex(before[0]!.subject)) fail("Native audit has no unique captured baseline.");
  const beforeId = before[0]!.subject;
  const runtime = events.filter((event) => event.action === "runtime_execution_finished"), lost = events.filter((event) => event.action === "runtime_execution_failed"),
    terminal = events.filter((event) => event.action === "session_finalized");
  const exit = runtime.length === 1 ? record(runtime[0]!.metadata).exit_code : null;
  const unreportedFailure = runtime.length === 0 && lost.length === 1 && lost[0]!.result === "error" && terminal[0]?.subject === "failed";
  if (!unreportedFailure && (typeof exit !== "string" || !/^(0|[1-9]\d{0,2})$/.test(exit) || Number(exit) > 255 || lost.length !== 0) ||
    input.exitCode !== undefined && String(input.exitCode) !== exit ||
    terminal.length !== 1 || !["completed", "failed"].includes(String(terminal[0]!.subject))) fail("Native signed audit has no unique matching execution exit and finalization.");
  const exitCode = unreportedFailure ? null : Number(exit), failed = exitCode !== 0 || terminal[0]!.subject !== "completed";
  const rolledBack = events.some((event) => event.action === "snapshot_rollback" && event.subject === beforeId && event.result === "success");
  if (failed && !rolledBack) fail("Native failure or successful rollback is not in its signed audit.");
  if (!failed && rolledBack || terminal[0]!.subject === "completed" && exitCode !== 0) fail("Native finalization contradicts its actual exit or rollback.");
  const snapshots = join(root, "snapshots"), names = await readdir(join(snapshots, "manifests"));
  if (names.length > 128 || names.some((name) => !/^[a-f0-9]{64}\.json$/.test(name))) fail("Native retained snapshot set is unbounded or unsupported.");
  const manifests = await Promise.all(names.map(async (name) => {
    const value = manifest(json(await bytes(join(snapshots, "manifests", name), 16 * 1024 * 1024)));
    if (`${value.id}.json` !== name) fail("Native snapshot filename does not match its ID.");
    return value;
  }));
  const baseline = manifests.find((saved) => saved.id === beforeId), after = manifests.filter((saved) => saved.id !== beforeId);
  if (!baseline || after.length !== 1) fail("Native audit v1 cannot identify a unique retained after-state in this private session store.");
  for (const [path, digest] of Object.entries(input.baseline ?? {})) {
    pathName(path);
    if (!hex(digest) || baseline.entries.find((entry) => entry.path === path)?.kind.content_hash !== digest) fail("Native retained baseline differs from the captured source.");
  }
  const saved = after[0]!;
  return { sessionId: sid, signerFingerprint, planDigest, auditDigest: hash(auditRaw), beforeId, afterId: saved.id,
    afterBinding: "unique-private-store" as const, rollback: rolledBack ? "confirmed" as const : "not-requested" as const, exitCode,
    entries: saved.entries.map((entry) => ({ ...entry, kind: { ...entry.kind } })),
    async read(requested: string, maximum = 128 * 1024) {
      const name = pathName(requested), beforeEntry = baseline.entries.find((entry) => entry.path === name);
      let entry = saved.entries.find((entry) => entry.path === name);
      const visited = new Set<string>();
      while (entry?.kind.type === "hardlink") {
        if (visited.has(entry.path)) fail("Native snapshot hardlink cycle was rejected.");
        visited.add(entry.path); entry = saved.entries.find((candidate) => candidate.path === entry!.kind.source);
      }
      if (entry?.kind.type !== "regular" || !hex(entry.kind.content_hash) || !uint(entry.kind.size)) return fail("Native after-state has no regular retained proof.");
      if (!uint(maximum) || maximum < 1 || maximum > 32 * 1024 * 1024 || entry.kind.size > maximum) fail("Native retained file exceeds the requested bound.");
      const digest = entry.kind.content_hash, content = await bytes(join(snapshots, "objects", digest.slice(0, 2), digest.slice(2)), maximum);
      if (content.length !== entry.kind.size || hash(content) !== digest) fail("Native retained object length/digest changed.");
      return { digest, content, added: !beforeEntry, mode: entry.mode };
    },
  };
}
export async function readNativeRollback(input: NativeRollbackInput) {
  const file = pathName(input.file);
  if (!uint(input.exitCode) || input.exitCode === 0) fail("Native rollback needs an actual unsuccessful run.");
  const evidence = await readNativeCompletion(input), maximum = input.maxBytes ?? 128 * 1024;
  if (!uint(maximum) || maximum < 1 || maximum > 16 * 1024 * 1024) fail("Native retained file exceeds the requested bound.");
  if (evidence.rollback !== "confirmed") fail("Native failure or successful rollback is not in its signed audit.");
  const content = await evidence.read(file, maximum);
  const { entries: _entries, read: _read, ...proof } = evidence;
  return { ...proof, rollback: "confirmed" as const, ...content };
}
