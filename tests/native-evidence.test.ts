import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNativeRollback } from "../apps/service/src/native-evidence.ts";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const ordered = (values: Record<string, string>) => Object.keys(values).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  .map((key) => `${JSON.stringify(key)}:${JSON.stringify(values[key])}`).join(",");
async function evidenceFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-evidence-"))), sid = "17".repeat(16), root = join(directory, "sessions", sid), snapshots = join(root, "snapshots");
  await mkdir(join(snapshots, "manifests"), { recursive: true, mode: 0o700 }); await mkdir(join(snapshots, "objects"), { mode: 0o700 });
  const pair = generateKeyPairSync("ed25519"), publicBytes = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const identity = { version: 1, fingerprint: hash(publicBytes), name: "Generated evidence signer", email: null, public_key_base64: publicBytes.toString("base64"),
    valid_from_unix: 90, expires_at_unix: null, revoked_at_unix: null };
  const detached = (content: string, kind: string, name: string, metadata: Record<string, string>) => {
    const subject = JSON.stringify({ kind, sha256: hash(content), name });
    const payload = `{"format":"sendbox-provenance","version":1,"signature_id":"${"41".repeat(16)}","subject":${subject},"signer_fingerprint":"${identity.fingerprint}","signed_at_unix":101,"expires_at_unix":null,"metadata":{${ordered(metadata)}}}`;
    const signature = sign(null, Buffer.concat([Buffer.from("sendbox-provenance-signature-v1\0"), Buffer.from(payload)]), pair.privateKey).toString("base64");
    return `${payload.slice(0, -1)},"signature_base64":${JSON.stringify(signature)}}`;
  };
  const image = `docker.io/library/generated-native@sha256:${"a".repeat(64)}`, workspace = join(directory, "workspace");
  await mkdir(workspace, { mode: 0o700 });
  const command = { program: "/generated/node", arguments: ["--foreground", "Generated {literal} \"quotes\" \\ path"] };
  const base = { format: "sendbox-boundary-plan", version: 3, session_id: [...Buffer.from(sid, "hex")], created_at_unix: 100, workspace: { source: workspace },
    workload: { reference: image }, provider: { runtime: "apple" }, command };
  const planRaw = `${JSON.stringify(base).slice(0, -1)},"resources":{"disk_bytes":18446744073709551614,"numeric_map":{"10":"first","2":"second"}}}`;
  const planDigest = hash(planRaw);
  const envelope = `{\n"format":"sendbox-signed-boundary-plan","version":3,\n"plan":${planRaw},\n"signer":${JSON.stringify(identity)},\n"signature":${detached(planRaw, "configuration", `boundary-plan:${sid}`, { format: "sendbox-boundary-plan", runtime: "apple", session_id: sid, "10": "Generated first", "2": "Generated second", "\ue000": "Generated BMP", "\u{10000}": "Generated supplementary" })}\n}`;
  const proof = Buffer.from(JSON.stringify({ marker: "Generated native cancellation", cancelled: true, requests: 1 }));
  const snapshot = async (entries: { path: string; mode: number; kind: Record<string, unknown> }[], totalSize: number) => {
    const content = { format: "sendbox-snapshot", version: 1, entries, total_size: totalSize }, id = hash(JSON.stringify(content));
    const value = { format: content.format, version: content.version, id, entries, total_size: totalSize };
    const path = join(snapshots, "manifests", `${id}.json`); await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    return { id, path, value };
  };
  const before = await snapshot([], 0), proofDigest = hash(proof);
  const proofDirectory = join(snapshots, "objects", proofDigest.slice(0, 2)); await mkdir(proofDirectory, { mode: 0o700 });
  const proofPath = join(proofDirectory, proofDigest.slice(2)); await writeFile(proofPath, proof, { mode: 0o600 });
  const after = await snapshot([{ path: "generated-proof.json", mode: 0o600, kind: { type: "regular", content_hash: proofDigest, size: proof.length } }], proof.length);
  const events = [
    { action: "before_snapshot_captured", subject: before.id, result: "success", metadata: {} },
    { action: "runtime_execution_finished", subject: "persistent", result: "error", metadata: { exit_code: "130" } },
    { action: "session_finalized", subject: "failed", result: "error", metadata: {} },
    { action: "snapshot_rollback", subject: before.id, result: "success", metadata: {} },
  ];
  const writeAudit = async (values = events, foreign = false) => {
    const content = JSON.stringify({ format: "sendbox-host-audit-publication", version: 1, session_id: sid, boundary_plan_digest: planDigest, event_count: values.length,
      records: values.map((event, index) => ({ event: { version: 1, sequence: index, session_id: [...Buffer.from(foreign ? "18".repeat(16) : sid, "hex")], timestamp_unix_nanos: "generated-nanos", ...event }, previous_hash: "0".repeat(64), hash: hash(String(index)) })) })
      .replaceAll('"generated-nanos"', "1792484696123456789");
    await writeFile(join(root, "audit-log.json"), content, { mode: 0o600 });
    await writeFile(join(root, "audit-log.signature.json"), detached(content, "artifact", "audit-log.json", { session_id: sid, boundary_plan_digest: planDigest }), { mode: 0o600 });
  };
  await writeFile(join(root, "boundary-plan.json"), envelope, { mode: 0o600 }); await writeAudit();
  const input = { stateRoot: directory, sessionId: sid, workspace, image, exitCode: 130, file: "generated-proof.json", command, createdAfter: 99, createdBefore: 102 };
  return { directory, root, input, identity, proof, proofDigest, proofPath, before, after, snapshot, events, writeAudit,
    close: () => rm(directory, { recursive: true, force: true }) };
}

test("native rollback evidence verifies exact provenance and lossless plan/audit bytes without claiming an audit-v1 after-ID binding", async () => {
  const fixture = await evidenceFixture();
  try {
    const result = await readNativeRollback(fixture.input);
    assert.deepEqual(result.content, fixture.proof); assert.equal(result.digest, fixture.proofDigest);
    assert.equal(result.signerFingerprint, fixture.identity.fingerprint);
    assert.equal(result.beforeId, fixture.before.id); assert.equal(result.afterId, fixture.after.id);
    assert.equal(result.rollback, "confirmed"); assert.equal(result.afterBinding, "unique-private-store");
  } finally { await fixture.close(); }
});

test("native evidence rejects another workspace/image/command/time, successful exit and traversing proof paths", async () => {
  const fixture = await evidenceFixture();
  try {
    for (const changed of [
      { workspace: join(fixture.directory, "other-generated-workspace") }, { image: `${fixture.input.image}invalid` },
      { command: { program: fixture.input.command.program, arguments: ["different-generated-command"] } }, { createdAfter: 101 },
      { exitCode: 0 }, { exitCode: 2 }, { file: "../boundary-signing.key" }, { file: "/generated/absolute" }, { maxBytes: 1 }, { maxBytes: 0 },
    ]) await assert.rejects(() => readNativeRollback({ ...fixture.input, ...changed }), /Native|native/);
  } finally { await fixture.close(); }
});

test("retained native evidence checks the captured baseline rather than trusting the after-object alone", async () => {
  const fixture = await evidenceFixture();
  try {
    await assert.rejects(() => readNativeRollback({ ...fixture.input, baseline: { "generated-source.mjs": fixture.proofDigest } }), /captured source/);
  } finally { await fixture.close(); }
});

test("native evidence rejects altered audit bytes, corrupted signature and changed retained object", async () => {
  for (const mutation of ["audit", "signature", "object"] as const) {
    const fixture = await evidenceFixture();
    try {
      if (mutation === "audit") await writeFile(join(fixture.root, "audit-log.json"), `${await readFile(join(fixture.root, "audit-log.json"), "utf8")} `);
      if (mutation === "signature") {
        const value: { signature_base64: string } = JSON.parse(await readFile(join(fixture.root, "audit-log.signature.json"), "utf8"));
        value.signature_base64 = Buffer.alloc(64).toString("base64"); await writeFile(join(fixture.root, "audit-log.signature.json"), JSON.stringify(value));
      }
      if (mutation === "object") await writeFile(fixture.proofPath, "Generated modified object.");
      await assert.rejects(() => readNativeRollback(fixture.input), /subject bytes|signature validation|length|digest/i);
    } finally { await fixture.close(); }
  }
});

test("a signed audit without actual rollback or with foreign session records is not rollback evidence", async () => {
  const fixture = await evidenceFixture();
  try {
    await fixture.writeAudit(fixture.events.filter((event) => event.action !== "snapshot_rollback"));
    await assert.rejects(() => readNativeRollback(fixture.input), /rollback/);
    await fixture.writeAudit(fixture.events, true);
    await assert.rejects(() => readNativeRollback(fixture.input), /foreign|session/);
  } finally { await fixture.close(); }
});

test("audit v1 cannot silently select one of several retained after-snapshots", async () => {
  const fixture = await evidenceFixture();
  try {
    await fixture.snapshot([{ path: "generated-alternative.json", mode: 0o600, kind: { type: "regular", content_hash: fixture.proofDigest, size: fixture.proof.length } }], fixture.proof.length);
    await assert.rejects(() => readNativeRollback(fixture.input), /unique retained after-state/);
  } finally { await fixture.close(); }
});

test("native retained objects cannot follow a filesystem alias even when its bytes match", async () => {
  const fixture = await evidenceFixture();
  try {
    const alias = join(fixture.directory, "generated-alias-target");
    await writeFile(alias, fixture.proof, { mode: 0o600 }); await rm(fixture.proofPath); await symlink(alias, fixture.proofPath);
    await assert.rejects(() => readNativeRollback(fixture.input), /filesystem alias/);
  } finally { await fixture.close(); }
});

test("native snapshot IDs use typed hash content and reject a self-file digest or unsorted entries", async () => {
  for (const mutation of ["self-hash", "unsorted"]) {
    const fixture = await evidenceFixture();
    try {
      if (mutation === "self-hash") {
        const wrong = hash(await readFile(fixture.after.path)), value = { ...fixture.after.value, id: wrong };
        await rm(fixture.after.path); await writeFile(join(fixture.root, "snapshots", "manifests", `${wrong}.json`), JSON.stringify(value), { mode: 0o600 });
      } else await fixture.snapshot([
        { path: "z-generated", mode: 0o600, kind: { type: "regular", content_hash: fixture.proofDigest, size: fixture.proof.length } },
        { path: "a-generated", mode: 0o600, kind: { type: "regular", content_hash: fixture.proofDigest, size: fixture.proof.length } },
      ], fixture.proof.length * 2);
      await assert.rejects(() => readNativeRollback(fixture.input), /hash content|out of order/);
    } finally { await fixture.close(); }
  }
});
