import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
test("owned peer candidate operations create a detached stage, preserve source/index and require each exact file acknowledgement", async () => {
  const { executeCandidateOperation } = await import("../apps/service/src/candidate-worker.ts");
  const directory = resolve(".test-output", `candidate-worker-${randomUUID()}`);
  await mkdir(join(directory, "source"), { recursive: true, mode: 0o700 });
  try {
    const root = await realpath(join(directory, "source"));
    await writeFile(join(root, "fixture.txt"), "generated original\n");
    const git = initializeGeneratedRepository(root);
    await writeFile(join(root, "unrelated.txt"), "unrelated staged bytes\n"); git(["add", "--", "unrelated.txt"]);
    const index = await readFile(join(root, ".git/index")), head = git(["rev-parse", "HEAD"]);
    const scope = { env: "Remote" as const, profileId: "default", sessionId: randomUUID(), projectId: randomUUID(), sourceWorkspaceId: null,
      stateRoot: join(directory, "owned"), folders: { denied: [], readOnly: [] },
      boundary: { env: "Remote" as const, peerDigest: hash("peer"), configurationDigest: hash("config"), workerDigest: hash("worker"), sourceRoot: root } };
    const call = (action: object, boundary = async (_phase: string, _path: string | null) => {}) =>
      executeCandidateOperation(root, { kind: "candidate.operation", operationId: randomUUID(), scope, ...action }, AbortSignal.timeout(10_000), boundary);
    const source = await call({ action: "source", paths: ["fixture.txt"] });
    assert.equal(source.type, "source"); if (source.type !== "source") throw new Error("Wrong generated operation result");
    const workspaceId = randomUUID(), created = await call({ action: "create", workspaceId, source: source.source });
    assert.equal(created.type, "created"); if (created.type !== "created") throw new Error("Wrong generated operation result");
    assert.equal(git(["branch", "--show-current"]), "main");
    assert.equal(created.stage.env, "Remote");
    const patch = { kind: "patch" as const, summary: "Generated peer candidate", edits: [{ path: "fixture.txt", baseDigest: hash("generated original\n"), text: "proposed\n" }] };
    const candidateId = randomUUID(), boundaries: string[] = [];
    const staged = await call({ action: "write", candidateId, phase: "stage", source: source.source, stage: created.stage, patch },
      async (phase, path) => { boundaries.push(`${phase}:${path}`); });
    assert.equal(staged.type, "written"); assert.deepEqual(boundaries, ["attempt:fixture.txt", "observed:fixture.txt"]);
    assert.equal(await readFile(join(root, "fixture.txt"), "utf8"), "generated original\n");
    await call({ action: "write", candidateId, phase: "apply", source: source.source, stage: created.stage, patch });
    assert.equal(await readFile(join(root, "fixture.txt"), "utf8"), "proposed\n");
    assert.deepEqual(await readFile(join(root, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
    await assert.rejects(() => call({ action: "create", workspaceId, source: source.source }), /exist|replay|already/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
