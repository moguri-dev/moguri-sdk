import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { setupFixture } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("SDK creates/reviews real SSH stages, separately applies to the actual peer source, and preserves Local/source index and unrelated bytes", { timeout: ciTime(180_000) }, async () => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const git = initializeGeneratedRepository(f.workspace);
    await writeFile(join(f.workspace, "unrelated.txt"), "Generated user's staged peer file.\n"); git(["add", "--", "unrelated.txt"]);
    const index = await readFile(join(f.workspace, ".git/index")), head = git(["rev-parse", "HEAD"]), local = await readFile(join(f.project, "fixture.txt"), "utf8");
    await f.probe(); await f.select(); await sdk.refresh();
    const review = (await sdk.candidates.workspacePreview(f.sessionId, "Generated owned peer stage")).preview;
    assert.equal(review.source.env, "Remote");
    const created = await sdk.candidates.createWorkspace(f.sessionId, review.name, review.digest, true), stage = await sdk.candidates.waitWorkspace(created.id!);
    assert.equal(stage.status, "ready"); assert.ok(stage.stage);
    const files = await sdk.candidates.source(f.sessionId, ["fixture.txt"]);
    assert.equal(files.source.env, "Remote"); assert.equal(files.files[0]?.text, "generated actual remote source\n");
    const patch = { kind: "patch" as const, summary: "Generated SSH candidate", edits: [{ path: "fixture.txt", baseDigest: files.files[0]!.baseDigest, text: "Generated reviewed peer proposal.\n" }] };
    const preview = (await sdk.candidates.preview(f.sessionId, stage.id, patch)).preview;
    const proposal = await sdk.candidates.wait((await sdk.candidates.stage(f.sessionId, stage.id, patch, preview.digest)).id!);
    assert.equal(proposal.candidate.version, 2); assert.equal(proposal.candidate.status, "staged"); assert.equal(proposal.candidate.acceptance, null);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), "generated actual remote source\n");
    const application = (await sdk.candidates.applyPreview(proposal.candidate.id, f.sessionId)).preview;
    await sdk.candidates.apply(proposal.candidate.id, f.sessionId, application.revision, application.digest);
    const result = await sdk.candidates.wait(proposal.candidate.id);
    assert.equal(result.candidate.status, "applied"); assert.equal(result.candidate.acceptance?.actor, "user");
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), patch.edits[0]!.text);
    assert.deepEqual(await readFile(join(f.workspace, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
    assert.equal(git(["branch", "--show-current"]), "main"); assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), local);
    assert.equal(await readFile(join(f.workspace, "unrelated.txt"), "utf8"), "Generated user's staged peer file.\n");
    assert.equal(f.requests.length, 0);
    const resourcePath = stage.stage!.root;
    await sdk.command({ type: "session.archive", sessionId: f.sessionId });
    assert.equal((await sdk.candidates.workspace(stage.id)).workspace.status, "ready");
    assert.equal(await readFile(join(resourcePath, "fixture.txt"), "utf8"), patch.edits[0]!.text);
    await sdk.sessions.delete(f.sessionId, true);
    await sdk.refresh();
    assert.equal(f.service.controller.platform.candidateEnvs.transports.records().some((record) => record.ownerKind === "read" && record.sessionId === f.sessionId), false);
    assert.equal((await sdk.candidates.workspace(stage.id)).workspace.status, "ready");
    assert.equal(sdk.getState().snapshot!.candidates.some((candidate) => candidate.id === proposal.candidate.id), false);
    assert.equal(await readFile(join(resourcePath, "fixture.txt"), "utf8"), patch.edits[0]!.text);
    assert.equal(await readFile(join(f.workspace, "fixture.txt"), "utf8"), patch.edits[0]!.text);
    assert.deepEqual(await readFile(join(f.workspace, ".git/index")), index);
  } finally { sdk.disconnect(); await f.close(); }
});

test("unqualified native candidates fail before Local source reads or guest/model launch", { timeout: ciTime(20_000) }, async (t) => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const session = f.session();
    f.service.store.commit([{ event_type: "session.configured", profile_id: "default", project_id: session.projectId, session_id: session.id,
      payload: { controls: { ...session.controls, env: "Sandbox" } } }]);
    f.service.controller.refreshProfile(); await sdk.refresh();
    const source = t.mock.method(f.service.controller.platform.managed, "project", () => { throw new Error("Generated forbidden Local source lookup"); });
    const launch = t.mock.method(f.service.controller.sandbox, "launch", () => { throw new Error("Generated forbidden unqualified guest launch"); });
    const eligibility = await sdk.candidates.eligibility(session.id);
    assert.equal(eligibility.eligible, false); assert.match(eligibility.diagnostic!, /native|SendBox|Sandbox|qualif|configure/i);
    await assert.rejects(() => f.service.controller.platform.candidateEnvs.preview(session.id, "Generated native stage"), /SendBox|native|Sandbox|qualif|configure/i);
    assert.equal(source.mock.callCount(), 0); assert.equal(launch.mock.callCount(), 0); assert.equal(f.requests.length, 0);
    assert.equal(sdk.getState().snapshot!.candidates.length, 0);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { t.mock.restoreAll(); sdk.disconnect(); await f.close(); }
});
