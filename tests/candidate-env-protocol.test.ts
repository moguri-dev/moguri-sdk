import test from "node:test";
import assert from "node:assert/strict";
import { Value } from "typebox/value";
import { CandidateDocumentSchema, CandidateRootSchema, sameCandidateRoot } from "../packages/protocol/src/candidates.ts";
import { parentMessage } from "../apps/service/src/worker-protocol.ts";
import { CompoundValidationResultSchema } from "../packages/protocol/src/compound.ts";

const hash = "a".repeat(64), head = "b".repeat(40);
const local = { env: "Local" as const, projectId: "project", workspaceId: null, root: "/generated/source",
  device: "1", inode: "2", gitCommonDir: "/generated/source/.git", branch: "main", head };
const remote = { ...local, version: 2 as const, env: "Remote" as const, boundary: {
  env: "Remote" as const, peerDigest: hash, configurationDigest: hash, workerDigest: hash, sourceRoot: local.root,
} };
const native = { version: 2 as const, env: "Sandbox" as const, projectId: "project", workspaceId: null, root: "/workspace",
  device: "1", inode: "2", snapshotDigest: hash, boundary: {
    env: "Sandbox" as const, workspaceId: "native-workspace", inputDigest: hash, configurationDigest: hash,
    workerDigest: hash, sourceRoot: "/workspace",
  } };

test("candidate roots retain historical Local shape and admit only versioned exact peer/snapshot roots", () => {
  assert.equal(Value.Check(CandidateRootSchema, local), true);
  assert.equal(Value.Check(CandidateRootSchema, remote), true);
  assert.equal(Value.Check(CandidateRootSchema, native), true);
  assert.equal(Value.Check(CandidateRootSchema, { ...local, env: "Remote" }), false);
  assert.equal(Value.Check(CandidateRootSchema, { ...native, gitCommonDir: "/controller/.git", head, branch: "main" }), false);
  assert.equal(sameCandidateRoot(remote, { ...remote, boundary: { ...remote.boundary, peerDigest: "c".repeat(64) } }), false);
  assert.equal(sameCandidateRoot(native, { ...native, snapshotDigest: "c".repeat(64) }), false);
});

test("a v1 Local candidate document cannot be relabeled as peer/native work", () => {
  const stage = { ...remote, root: "/generated/owned/stage", workspaceId: "stage", inode: "3" };
  const document = { format: "moguri-candidate", version: 2, source: remote, stage, authorityDigest: hash,
    patch: { kind: "patch", summary: "Generated", edits: [{ path: "fixture.txt", baseDigest: hash, text: "proposed\n" }] } };
  assert.equal(Value.Check(CandidateDocumentSchema, document), true);
  assert.equal(Value.Check(CandidateDocumentSchema, { ...document, version: 1 }), false);
  assert.equal(Value.Check(CandidateDocumentSchema, { ...document, source: native }), false);
});

test("non-Local public compound is rooted in its actual parent, never a private root-less role", () => {
  for (const env of ["Remote", "Sandbox"] as const) {
    assert.doesNotThrow(() => parentMessage({ kind: "start", env, root: "/generated/source", context: [], readOnly: true, publicCompound: true }));
    assert.throws(() => parentMessage({ kind: "start", env, root: null, context: [], readOnly: true, publicCompound: true }));
    assert.throws(() => parentMessage({ kind: "start", env, root: "/generated/source", context: [], readOnly: false, publicCompound: true }));
  }
});

test("selected Env validation receipts cannot be relabeled as historical Local v1 results", () => {
  const result = { version: 2, validationId: "validation", candidateId: "candidate", stage: remote, commandDigest: hash,
    text: "Generated actual peer test output.", isError: false, outcome: "completed", exitCode: 0, signal: null, candidateUnchanged: true, diagnostic: null };
  assert.equal(Value.Check(CompoundValidationResultSchema, result), true);
  assert.equal(Value.Check(CompoundValidationResultSchema, { ...result, version: 1 }), false);
});
