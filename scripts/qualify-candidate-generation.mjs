import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function qualifyCandidateGeneration({ sdk, directory, stateDir, modelId, setReply, requests }) {
  await mkdir(directory);
  const original = "Generated qualified proposal source.\n", proposed = "Generated qualified model proposal.\n";
  const path = join(directory, "fixture.txt"); await writeFile(path, original);
  const git = (args) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: directory, encoding: "utf8" });
  git(["init", "--initial-branch=main"]); git(["add", "--", "fixture.txt"]);
  git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated proposal qualification base"]);
  const patch = { kind: "patch", summary: "Generated qualified model proposal.", edits: [{ path: "fixture.txt", baseDigest: createHash("sha256").update(original).digest("hex"), text: proposed }] };
  const input = { task: "Generate one bounded reviewed proposal.", files: patch.edits.map(({ path, baseDigest }) => ({ path, baseDigest })) };
  const before = requests.length;
  setReply(JSON.stringify(patch));
  try {
    const project = await sdk.command({ type: "project.add", path: directory }), source = await sdk.sessions.create(project.id, "Generated qualified proposal owner", { env: "Local", modelId }, undefined, "checkout");
    const created = await sdk.workspaces.create(project.id, "moguri/generated-qualified-proposal"), workspace = await sdk.workspaces.wait(created.id);
    const index = await readFile(join(directory, ".git/index")), head = git(["rev-parse", "HEAD"]);
    const preview = (await sdk.candidates.generatePreview(source.id, workspace.id, input)).preview;
    await assert.rejects(() => sdk.command({ type: "candidate.generate", sessionId: source.id, stageWorkspaceId: workspace.id, input, expectedDigest: preview.digest, confirmCost: false }));
    assert.equal(requests.length, before);
    const generated = await sdk.candidates.waitGeneration((await sdk.candidates.generate(source.id, workspace.id, input, preview.digest, true)).id);
    assert.equal(generated.generation.status, "proposed"); assert.equal(generated.generation.modelId, modelId);
    assert.equal(requests.length, before + 1); assert.equal(requests.at(-1).tools, undefined);
    assert.equal(await readFile(path, "utf8"), original); assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), original);
    const calls = (await sdk.budgets.calls({ sessionId: source.id })).calls;
    assert.equal(calls.length, 1); assert.equal(calls[0].role, "draft"); assert.equal(calls[0].reportedTokens, 42); assert.equal(calls[0].status, "settled");
    assert.equal(JSON.parse((await sdk.artifacts.export(generated.generation.id)).export.text).schemaVersion, Array.isArray(sdk.getState().snapshot.candidateOwners) ? 10 : 3);
    assert.ok((await sdk.artifacts.read(generated.generation.id)).artifact.sources.some((source) => source.actor === "model" && source.modelId === modelId));
    const shared = await sdk.slash(source.id, `/candidate generation ${generated.generation.id}`, "tui");
    assert.equal(shared.kind, "text"); assert.equal(JSON.parse(shared.text).generation.status, "proposed");
    const review = (await sdk.candidates.preview(source.id, workspace.id, generated.proposal.patch)).preview;
    const staged = await sdk.candidates.wait((await sdk.candidates.stage(source.id, workspace.id, generated.proposal.patch, review.digest, generated.generation.id)).id);
    assert.equal(staged.candidate.status, "staged"); assert.equal(staged.candidate.generationId, generated.generation.id); assert.equal(staged.candidate.acceptance, null); assert.equal(await readFile(path, "utf8"), original);
    const apply = (await sdk.candidates.applyPreview(staged.candidate.id, source.id)).preview;
    await sdk.candidates.apply(staged.candidate.id, source.id, staged.candidate.revision, apply.digest);
    assert.equal((await sdk.candidates.wait(staged.candidate.id)).candidate.acceptance.actor, "user");
    assert.equal(await readFile(path, "utf8"), proposed); assert.deepEqual(await readFile(join(directory, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
    const command = { type: "candidate.generate", sessionId: source.id, stageWorkspaceId: workspace.id, input, expectedDigest: preview.digest, confirmCost: true };
    return {
      id: generated.generation.id,
      async verifyRecovery(current) {
        const raw = new DatabaseSync(join(stateDir, "state.sqlite"));
        try { raw.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", generated.generation.commandId); } finally { raw.close(); }
        const newer = "Generated later actual-user edit after model proposal.\n"; await writeFile(path, newer);
        assert.equal((await current.candidates.generation(generated.generation.id)).generation.status, "proposed");
        assert.equal((await current.command(command, generated.generation.commandId)).id, generated.generation.id);
        assert.equal(await readFile(path, "utf8"), newer); assert.equal(requests.length, before + 1);
        assert.equal((await current.budgets.calls({ sessionId: source.id, role: "draft" })).calls[0].reportedTokens, 42);
        if (Array.isArray(current.getState().snapshot.candidateOwners)) {
          await current.sessions.delete(source.id, true);
          await assert.rejects(() => current.candidates.generation(generated.generation.id), { code: "candidate_generation_missing" });
          await assert.rejects(() => current.candidates.read(staged.candidate.id), { code: "candidate_missing" });
          const deleted = new DatabaseSync(join(stateDir, "state.sqlite"));
          try { deleted.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", generated.generation.commandId); } finally { deleted.close(); }
          await assert.rejects(() => current.command(command, generated.generation.commandId), { code: "candidate_generation_deleted" });
          assert.equal((await current.budgets.calls({ sessionId: source.id, role: "draft" })).calls[0].reportedTokens, 42);
          assert.equal(await readFile(path, "utf8"), newer); assert.equal(requests.length, before + 1);
        }
      },
    };
  } finally { setReply(null); }
}
