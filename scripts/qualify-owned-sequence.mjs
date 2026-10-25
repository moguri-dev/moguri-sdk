import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export async function qualifyOwnedSequence({ sdk, controller, node, cli, directory, stateDir, modelId, setReply, requests, proposalOrigin = false, roleContracts = false }) {
  await mkdir(directory);
  const original = "Generated installed owned-role source.\n", marker = "GENERATED_INSTALLED_OWNED_ROLE_DATA_NOT_ACCEPTANCE";
  await writeFile(join(directory, "fixture.txt"), original);
  const git = (args) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: directory, encoding: "utf8" });
  git(["init", "--initial-branch=main"]); git(["add", "--", "fixture.txt"]);
  git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated owned-role qualification base"]);
  const project = await sdk.command({ type: "project.add", path: directory }), source = await sdk.sessions.create(project.id, "Generated installed role owner", { env: "Local", modelId });
  const workspace = await sdk.workspaces.wait((await sdk.workspaces.create(project.id, "moguri/generated-installed-role-stage")).id);
  const index = await readFile(join(directory, ".git/index")), head = git(["rev-parse", "HEAD"]), before = requests.length;
  const input = { sessionId: source.id, stageWorkspaceId: workspace.id, timeoutMs: 20_000,
    input: { task: "Generated installed bounded roles.", files: [{ path: "fixture.txt", baseDigest: createHash("sha256").update(original).digest("hex") }] },
    roles: ["draft", "critic", "revision"].map((role) => ({ role, modelId, instruction: `Return generated ${role} data, not permission, acceptance or independent-family evidence.`, outputBound: 64 })) };
  const patch = { kind: "patch", summary: "Generated installed canonical role proposal.", edits: [
    { path: "fixture.txt", baseDigest: input.input.files[0].baseDigest, text: marker + "\n" },
  ] }, reply = proposalOrigin ? JSON.stringify(patch) : marker;
  const routerReason = "GENERATED_INSTALLED_ROUTER_REASON_NOT_CONTEXT";
  if (roleContracts) input.roles = [
    { role: "router", modelId, instruction: "Return the original exact declared role plan.", outputBound: 256, contextRoleIndices: [],
      contract: { kind: "router", pattern: "critique", draftId: modelId, criticId: modelId, minimumConfidence: 0.9 } },
    { role: "draft", modelId, instruction: "Return one unaccepted canonical patch.", outputBound: 256, contextRoleIndices: [], contract: { kind: "patch" } },
    { role: "critic", modelId, instruction: "Return bounded generated advice, not independent-family evidence or approval.", outputBound: 256, contextRoleIndices: [1],
      contract: { kind: "critic", candidateIndex: 1 } },
    { role: "revision", modelId, instruction: "Return the explicit final unaccepted canonical patch.", outputBound: 256, contextRoleIndices: [1, 2], contract: { kind: "patch" } },
  ];
  const count = input.roles.length, last = count - 1;
  const preview = await controller.ownedRoles.preview(input), review = { digest: preview.digest, confirmCost: true }, commandId = randomUUID();
  setReply(roleContracts ? (request) => {
    const prompt = request.messages.filter((message) => ["system", "developer"].includes(message.role)).map((message) => message.content).join("\n");
    if (prompt.includes("\n\nRole router:\n")) return JSON.stringify({ pattern: "critique", draftId: modelId, criticId: modelId, confidence: 0.95, reason: routerReason });
    if (prompt.includes("\n\nRole critic:\n")) return JSON.stringify({ verdict: "revise", reason: "Generated declared-contract check, not model quality.", issues: ["Generated bounded revision."] });
    if (prompt.includes("\n\nRole draft:\n") || prompt.includes("\n\nRole revision:\n")) return JSON.stringify(patch);
    throw new Error("Generated installed response has no exact original role.");
  } : reply);
  try {
    const accepted = await controller.executeOwnedRoles(input, review, commandId);
    let record;
    for (let attempt = 0; attempt < 600; attempt++) {
      record = (await sdk.roleSequences.read(accepted.id)).sequence;
      if (record.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(record.status, "completed"); assert.equal(requests.length, before + count);
    assert.deepEqual(record.steps.map((step) => step.role), input.roles.map((role) => role.role));
    for (const [position, request] of requests.slice(before).entries()) {
      assert.equal(request.tools, undefined); assert.equal(request.max_tokens ?? request.max_completion_tokens, roleContracts ? 256 : 64);
      const context = JSON.parse(request.messages.findLast((message) => message.role === "user").content);
      if (roleContracts) {
        assert.deepEqual(context.untrustedPriorResults.map((value) => value.roleIndex), [[], [], [1], [1, 2]][position]);
        if (position) assert.equal(JSON.stringify(request).includes(routerReason), false);
        const contract = await sdk.roleSequences.contract(record.id, position);
        assert.equal(record.inputVersion, 2); assert.equal(contract.result.status, "valid"); assert.equal(contract.inputVersion, 2);
      } else {
        assert.equal(context.untrustedPriorResults.length, position);
        assert.ok(context.untrustedPriorResults.every((result) => result.text === reply));
      }
    }
    const calls = (await sdk.budgets.calls({ sessionId: source.id })).calls, plans = (await sdk.budgets.plans({ turnId: record.id })).plans;
    assert.equal(calls.length, count); assert.equal(calls.reduce((tokens, call) => tokens + call.reportedTokens, 0), count * 42);
    assert.equal(plans.length, count); assert.ok(plans.every((plan) => plan.status === "consumed"));
    const inspected = JSON.parse((await promisify(execFile)(node, [cli, "roles", record.id, String(last)], { env: { ...process.env, MOGURI_STATE_DIR: stateDir } })).stdout);
    assert.ok(inspected.step.input.includes(marker)); assert.ok(inspected.step.result.includes(marker));
    assert.equal(JSON.parse((await sdk.slash(source.id, "/roles " + record.id + " " + last, "tui")).text).sequence.id, record.id);
    if (roleContracts) {
      const gate = JSON.parse((await promisify(execFile)(node, [cli, "roles", "contract", record.id, "2"], { env: { ...process.env, MOGURI_STATE_DIR: stateDir } })).stdout);
      assert.equal(gate.result.value.verdict, "revise");
      assert.equal(JSON.parse((await sdk.slash(source.id, "/roles contract " + record.id + " 2", "tui")).text).result.status, "valid");
    }
    assert.equal(JSON.parse((await sdk.artifacts.export(record.id)).export.text).schemaVersion, 4);
    assert.equal(await readFile(join(directory, "fixture.txt"), "utf8"), original);
    assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), original);
    assert.deepEqual(await readFile(join(directory, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
    let linked;
    if (proposalOrigin) {
      const proposed = await sdk.candidates.roleProposal(record.id), reference = { roleSequenceId: record.id };
      assert.equal(proposed.document.roleOrigin.stepId, record.steps[last].stepId); assert.deepEqual(proposed.document.patch, patch);
      const exposed = JSON.parse((await promisify(execFile)(node, [cli, "candidate", "role-proposal", record.id], { env: { ...process.env, MOGURI_STATE_DIR: stateDir } })).stdout);
      assert.deepEqual(exposed.document.roleOrigin, proposed.document.roleOrigin);
      assert.equal(JSON.parse((await sdk.slash(source.id, "/candidate role-proposal " + record.id, "tui")).text).document.roleOrigin.sequenceId, record.id);
      const selection = join(directory, "generated-role-proposal.json"); await writeFile(selection, JSON.stringify(patch));
      const flags = ["--session", source.id, "--workspace", workspace.id, "--role-sequence", record.id];
      const stagedPreview = JSON.parse((await promisify(execFile)(node, [cli, "candidate", "preview", selection, ...flags], { env: { ...process.env, MOGURI_STATE_DIR: stateDir } })).stdout).preview;
      assert.ok(stagedPreview.warning); assert.notEqual(stagedPreview.digest, (await sdk.candidates.preview(source.id, workspace.id, patch)).preview.digest);
      const staged = JSON.parse((await promisify(execFile)(node, [cli, "candidate", "stage", selection, ...flags, "--digest", stagedPreview.digest, "--confirm-write"], { env: { ...process.env, MOGURI_STATE_DIR: stateDir } })).stdout);
      assert.equal(staged.candidate.status, "staged"); assert.equal(staged.candidate.acceptance, null);
      assert.deepEqual(staged.candidate.roleOrigin, proposed.document.roleOrigin);
      assert.equal(await readFile(join(directory, "fixture.txt"), "utf8"), original);
      const artifact = (await sdk.artifacts.read(record.id)).artifact; await sdk.artifacts.delete(record.id, artifact.revision, true);
      linked = staged.candidate;
      assert.equal(JSON.parse((await sdk.artifacts.export(linked.id)).export.text).schemaVersion, Array.isArray(sdk.getState().snapshot.candidateOwners) ? 10 : 5);
    }
    await sdk.refresh();
    const sessionOwned = Array.isArray(sdk.getState().snapshot.candidateOwners);
    if (linked && sessionOwned) await sdk.command({ type: "session.archive", sessionId: source.id });
    else await sdk.sessions.delete(source.id, true, sdk.getState().snapshot.sessions.find((session) => session.id === source.id).revision);
    return {
      async verifyRecovery(current, owner) {
        assert.equal((await current.budgets.calls({ sessionId: source.id })).calls.length, count);
        owner.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(owner.profileId, commandId);
        if (!linked) {
          const value = await current.roleSequences.read(record.id, last);
          assert.equal(value.sequence.status, "completed"); assert.ok(value.step.input.includes(marker)); assert.ok(value.step.result.includes(marker));
          assert.equal((await owner.executeOwnedRoles(input, review, commandId)).id, record.id);
          const artifact = (await current.artifacts.read(record.id)).artifact;
          await current.artifacts.delete(record.id, artifact.revision, true);
          owner.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(owner.profileId, commandId);
        } else {
          assert.deepEqual((await current.candidates.read(linked.id)).candidate.roleOrigin, linked.roleOrigin);
          const copy = JSON.parse((await current.artifacts.export(linked.id)).export.text);
          assert.equal(copy.schemaVersion, sessionOwned ? 10 : 5);
          for (const digest of [linked.roleOrigin.sequenceInputDigest, linked.roleOrigin.roleInputDigest, linked.roleOrigin.resultDigest]) {
            assert.ok(copy.documents[0].candidate.results.some((result) => result.digest === digest && result.text.length));
          }
          const user = await current.sessions.create(project.id, "Generated reopened candidate reviewer", { env: "Local" });
          const apply = (await current.candidates.applyPreview(linked.id, user.id)).preview;
          await current.candidates.apply(linked.id, user.id, linked.revision, apply.digest);
          const applied = await current.candidates.wait(linked.id);
          assert.equal(applied.candidate.acceptance.actor, "user"); assert.deepEqual(applied.candidate.roleOrigin, linked.roleOrigin);
          assert.equal(await readFile(join(directory, "fixture.txt"), "utf8"), patch.edits[0].text);
          assert.deepEqual(await readFile(join(directory, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
          if (sessionOwned) {
            await current.sessions.delete(source.id, true);
            await assert.rejects(() => current.candidates.read(linked.id), { code: "candidate_missing" });
            for (const digest of [linked.roleOrigin.sequenceInputDigest, linked.roleOrigin.roleInputDigest, linked.roleOrigin.resultDigest]) {
              assert.throws(() => owner.store.blob(digest), /Missing or deleted/);
            }
          }
        }
        await assert.rejects(() => owner.executeOwnedRoles(input, review, commandId), { code: "role_sequence_deleted" });
        assert.equal(requests.length, before + count);
      },
    };
  } finally { setReply(null); }
}
