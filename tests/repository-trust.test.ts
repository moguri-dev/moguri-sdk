import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { startService } from "../apps/service/src/server.ts";
import { scriptReviewFixture } from "./fixtures/script-review.ts";

async function trustedFixture() {
  const call = { name: "run_script", args: { path: "scripts/existing.sh", interpreter: "sh", args: ["Generated argument"] } };
  const f = await setupFixture({ toolBatches: [[call]] });
  await mkdir(join(f.project, "scripts"));
  await writeFile(join(f.project, "scripts/existing.sh"), "printf '%s\\n' \"$1\" > generated-trusted-result.txt\n");
  await writeFile(join(f.project, "package.json"), '{"name":"generated-trust","private":true}\n');
  await writeFile(join(f.project, "package-lock.json"), '{"name":"generated-trust","lockfileVersion":3,"packages":{}}\n');
  const git = initializeGeneratedRepository(f.project, ["fixture.txt", "scripts/existing.sh", "package.json", "package-lock.json"]);
  const sdk = await new MoguriSdk(f.service.connection).ready();
  await f.configure(); await sdk.refresh();
  const projectId = f.session().projectId!;
  return { ...f, sdk, git, projectId, call, close: async () => { sdk.disconnect(); await f.close(); } };
}

test("actual-user repository trust runs an existing exact script without model assessment and remains separate from execution approval", { skip: process.platform !== "darwin" }, async () => {
  const f = await trustedFixture();
  try {
    const { preview } = await f.sdk.repositoryTrust.preview(f.projectId);
    assert.ok(preview.files.some((file) => file.path === "scripts/existing.sh"));
    await f.sdk.repositoryTrust.trust(preview);
    await f.send("Generated trusted script under normal Manual policy.");
    await waitFor(() => f.session().pendingApproval);
    assert.equal(f.service.controller.snapshot().scriptReviews.length, 0);
    await assert.rejects(() => readFile(join(f.project, "generated-trusted-result.txt")), { code: "ENOENT" });
    const approval = f.session().pendingApproval!;
    await f.sdk.approvals.respond(f.sessionId, approval.id, true);
    await f.terminal();
    assert.equal(await readFile(join(f.project, "generated-trusted-result.txt"), "utf8"), "Generated argument\n");
    const state = f.service.controller.snapshot();
    assert.equal(state.repositoryTrusts[0]?.actor, "user");
    assert.equal(state.trustedScriptAttempts.length, 1);
    assert.equal(state.trustedScriptAttempts[0]?.stepId, approval.stepId);
    assert.equal(state.trustedScriptAttempts[0]?.callId, approval.call.id);
    assert.equal(state.scriptReviews.length, 0);
    assert.equal(f.sdk.attention.list({ type: "script-review" }).length, 0);
    assert.ok(f.requests.every((request) => !JSON.stringify(request).includes('"action":"review"')));
  } finally { await f.close(); }
});

test("new, changed, third-party and dependency-drifted scripts do not inherit an existing repository trust baseline", { skip: process.platform !== "darwin" }, async () => {
  const f = await trustedFixture();
  try {
    const { preview } = await f.sdk.repositoryTrust.preview(f.projectId);
    await f.sdk.repositoryTrust.trust(preview);
    await f.sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await writeFile(join(f.project, "scripts/existing.sh"), "printf GENERATED_CHANGED > generated-must-not-run.txt\n");
    await f.send("Generated changed script is outside the exact baseline."); await f.terminal();
    assert.equal(f.service.controller.snapshot().trustedScriptAttempts.length, 0);
    await assert.rejects(() => readFile(join(f.project, "generated-must-not-run.txt")), { code: "ENOENT" });
    assert.ok(f.session().messages.some((message) => message.role === "tool" && /changed|review_script|baseline/i.test(message.text)));
    await writeFile(join(f.project, "scripts/existing.sh"), "printf '%s\\n' \"$1\" > generated-trusted-result.txt\n");
    await writeFile(join(f.project, "package-lock.json"), '{"name":"generated-new-package","lockfileVersion":3,"packages":{}}\n');
    await f.send("Generated changed dependency inputs invalidate entrypoint trust."); await f.terminal();
    assert.equal(f.service.controller.snapshot().trustedScriptAttempts.length, 0);
    assert.ok(f.session().messages.some((message) => message.role === "tool" && /dependenc/i.test(message.text)));
    await writeFile(join(f.project, "scripts/generated.sh"), "printf GENERATED_NEW\n");
    f.git(["add", "--", "scripts/generated.sh"]);
    f.git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated later source"]);
    const baseline = f.sdk.repositoryTrust.get(f.projectId)!;
    assert.equal(baseline.baselineDigest, preview.baselineDigest);
    assert.ok(!preview.files.some((file) => file.path.includes("node_modules") || file.path === "scripts/generated.sh"));
    f.call.args.path = "scripts/generated.sh";
    await f.send("Generated later commit cannot enlarge trust."); await f.terminal();
    assert.equal(f.service.controller.snapshot().trustedScriptAttempts.length, 0);
    await mkdir(join(f.project, "node_modules/generated-package"), { recursive: true });
    await writeFile(join(f.project, "node_modules/generated-package/script.sh"), "printf GENERATED_PACKAGE > generated-must-not-run.txt\n");
    f.call.args.path = "node_modules/generated-package/script.sh";
    await f.send("Generated package code cannot use repository trust."); await f.terminal();
    assert.equal(f.service.controller.snapshot().trustedScriptAttempts.length, 0);
    await assert.rejects(() => readFile(join(f.project, "generated-must-not-run.txt")), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("trust approval rejects stale previews and concurrent decisions; failed persistence cannot grant trust and revocation is immediate", async () => {
  const f = await trustedFixture(), second = await new MoguriSdk(f.service.connection).ready();
  try {
    const { preview } = await f.sdk.repositoryTrust.preview(f.projectId);
    await writeFile(join(f.project, "scripts/existing.sh"), "printf GENERATED_REVIEW_CHANGED\n");
    await assert.rejects(() => f.sdk.repositoryTrust.trust(preview), /changed|review|stale/i);
    assert.equal(f.sdk.repositoryTrust.get(f.projectId), undefined);
    const { preview: current } = await f.sdk.repositoryTrust.preview(f.projectId);
    f.service.store.db.exec("CREATE TRIGGER generated_trust_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='repository.trust_recorded' BEGIN SELECT RAISE(ABORT,'Generated trust persistence failure'); END");
    await assert.rejects(() => f.sdk.repositoryTrust.trust(current), /operation failed.*no success/i);
    assert.equal(f.sdk.repositoryTrust.get(f.projectId), undefined);
    f.service.store.db.exec("DROP TRIGGER generated_trust_failure");
    const results = await Promise.allSettled([f.sdk.repositoryTrust.trust(current), second.repositoryTrust.trust(current)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    await f.sdk.refresh();
    const trust = f.sdk.repositoryTrust.get(f.projectId)!;
    await f.sdk.repositoryTrust.revoke(f.projectId, trust.revision);
    assert.equal(f.sdk.repositoryTrust.get(f.projectId)?.status, "revoked");
    await assert.rejects(() => second.repositoryTrust.revoke(f.projectId, trust.revision), /changed|revision/i);
  } finally { second.disconnect(); await f.close(); }
});

test("repository trust follows exact existing source into a service-owned worktree without granting the base checkout", { skip: process.platform !== "darwin" }, async () => {
  const f = await trustedFixture();
  try {
    const { preview } = await f.sdk.repositoryTrust.preview(f.projectId);
    await f.sdk.repositoryTrust.trust(preview);
    const created = await f.sdk.sessions.create(f.projectId, "Generated trusted isolated task", { modelId: f.modelId });
    const id = created.id!, workspace = await f.sdk.workspaces.wait(f.sdk.sessions.get(id)!.workspaceId!);
    await f.sdk.sessions.autonomy(id, "Autopilot");
    const saved = await f.sdk.command({ type: "draft.save", sessionId: id, text: "Generated trusted isolated script.", attachments: [], expectedRevision: 0 });
    await f.sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
    await waitFor(() => f.sdk.sessions.get(id)?.status === "completed");
    assert.equal(await readFile(join(workspace.path, "generated-trusted-result.txt"), "utf8"), "Generated argument\n");
    await assert.rejects(() => readFile(join(f.project, "generated-trusted-result.txt")), { code: "ENOENT" });
    assert.equal(f.service.controller.snapshot().trustedScriptAttempts[0]?.workspaceId, workspace.id);
    assert.equal(f.git(["branch", "--show-current"]), "main");
  } finally { await f.close(); }
});

test("the actual TUI repo-trust command retains only its explicit original baseline, without inference or execution", async () => {
  const f = await trustedFixture();
  const command = async (text: string) => {
    const saved = await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text, attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: saved.revision!, delivery: "queue", client: "tui" });
    return waitFor(() => {
      const current = f.service.controller.snapshot().commandExecutions.findLast((execution) => execution.sessionId === f.sessionId);
      return current && ["completed", "failed", "partial"].includes(current.status) ? current : null;
    });
  };
  try {
    const { preview } = await f.sdk.repositoryTrust.preview(f.projectId);
    const execution = await command(`/repo-trust trust ${preview.baselineDigest} ${preview.expectedRevision} confirm-existing`);
    assert.equal(execution.status, "completed", execution.diagnostic ?? "");
    await f.sdk.refresh();
    assert.equal(f.sdk.repositoryTrust.get(f.projectId)?.actor, "user");
    assert.equal(f.sdk.repositoryTrust.get(f.projectId)?.baselineDigest, preview.baselineDigest);
    assert.equal(f.requests.length, 0); assert.equal(f.service.controller.snapshot().trustedScriptAttempts.length, 0);
  } finally { await f.close(); }
});

test("revoking a trusted baseline while Manual approval waits prevents that original script from starting", { skip: process.platform !== "darwin" }, async () => {
  const f = await trustedFixture();
  try {
    await f.sdk.repositoryTrust.trust((await f.sdk.repositoryTrust.preview(f.projectId)).preview);
    await f.send("Generated pending trusted script.");
    const approval = await waitFor(() => f.session().pendingApproval);
    await f.sdk.repositoryTrust.revoke(f.projectId, f.sdk.repositoryTrust.get(f.projectId)!.revision);
    await assert.rejects(() => f.sdk.approvals.respond(f.sessionId, approval.id, true), /trust|review_script/i);
    await assert.rejects(() => readFile(join(f.project, "generated-trusted-result.txt")), { code: "ENOENT" });
    await f.sdk.command({ type: "session.stop", sessionId: f.sessionId });
    await f.terminal();
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "process.started"), false);
  } finally { await f.close(); }
});

test("trusted entrypoints cannot lift a hard execution denial even under explicitly selected Autopilot", { skip: process.platform !== "darwin" }, async () => {
  const f = await trustedFixture();
  try {
    await f.sdk.repositoryTrust.trust((await f.sdk.repositoryTrust.preview(f.projectId)).preview);
    const settings = f.sdk.settings.get()!;
    await f.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions,
      tools: [...settings.values.permissions.tools, { id: "generated-deny-trusted-execution", tool: "run_command", pathPrefix: "", decision: "deny" }] } }, settings.revision);
    await f.sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await f.send("Generated trust is not permission."); await f.terminal();
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "process.started"), false);
    assert.ok(f.service.controller.events(0).some((event) => event.event_type === "tool.completed" && event.payload.call.name === "run_script" && event.payload.outcome === "denied"));
  } finally { await f.close(); }
});

test("a trust preview or project identity from another profile cannot authorize the same physical repository", async () => {
  const f = await profileFixture();
  try {
    const root = join(f.directory, "generated-trust-repository"); await mkdir(root);
    await writeFile(join(root, "fixture.txt"), "Generated shared physical source.\n");
    await writeFile(join(root, "existing.sh"), "printf GENERATED_EXISTING\n");
    initializeGeneratedRepository(root, ["fixture.txt", "existing.sh"]);
    const project = await f.sdk.projects.add(root), preview = (await f.sdk.repositoryTrust.preview(project.id!)).preview;
    await f.sdk.repositoryTrust.trust(preview);
    const { client } = await f.create("Generated trust-isolated profile"), other = await client.projects.add(root);
    assert.equal(client.repositoryTrust.get(project.id!), undefined);
    assert.throws(() => client.repositoryTrust.trust(preview), /profile/i);
    await assert.rejects(() => client.command({ type: "repository.trust.approve", projectId: other.id!, baselineDigest: preview.baselineDigest,
      expectedRevision: -1, confirmExistingScripts: true }), /changed|current baseline|review/i);
    assert.equal(client.repositoryTrust.get(other.id!), undefined);
    assert.equal(f.providers.reduce((total, provider) => total + provider.requests.length, 0), 0);
  } finally { await f.close(); }
});

test("trusted attempts retain their original source through restart without execution replay or filesystem substitution", { skip: process.platform !== "darwin" }, async () => {
  const f = await trustedFixture();
  let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    await f.sdk.repositoryTrust.trust((await f.sdk.repositoryTrust.preview(f.projectId)).preview);
    await f.sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await f.send("Generated retained trusted attempt."); await f.terminal();
    const attempt = structuredClone(f.service.controller.snapshot().trustedScriptAttempts[0]!);
    const calls = f.requests.length, original = "printf '%s\\n' \"$1\" > generated-trusted-result.txt\n";
    await writeFile(join(f.project, "scripts/existing.sh"), "printf GENERATED_LATER_SOURCE\n");
    f.sdk.disconnect(); await f.service.close();
    service = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(service.connection).ready();
    assert.deepEqual(sdk.getState().snapshot!.trustedScriptAttempts[0], attempt);
    assert.equal(service.store.blob(attempt.sourceDigest), original);
    assert.equal(f.requests.length, calls);
    assert.equal(sdk.getState().snapshot!.scriptReviews.length, 0);
  } finally { sdk?.disconnect(); await service?.close(); await f.close(); }
});

test("a trusted baseline cannot bypass a later exact unsafe assessment or fabricate its separate user force", { skip: process.platform !== "darwin" }, async () => {
  const f = await scriptReviewFixture({ unsafe: true, attemptUnsafe: true, autopilot: true, trustAttemptAfterReview: true });
  try {
    initializeGeneratedRepository(f.project, ["fixture.txt", "generated-script.sh"]);
    await f.sdk.repositoryTrust.trust((await f.sdk.repositoryTrust.preview(f.session().projectId)).preview);
    await f.send("Generated later unsafe advice cannot become trusted execution."); await f.terminal();
    assert.equal(f.review()?.advice?.verdict, "unsafe"); assert.equal(f.review()?.force, null);
    assert.equal(f.service.controller.snapshot().trustedScriptAttempts.length, 0);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "process.started"), false);
    assert.ok(f.session().messages.some((message) => message.role === "tool" && /retained unsafe assessment/i.test(message.text)));
    const { preview } = await f.sdk.repositoryTrust.preview(f.session().projectId);
    assert.equal(preview.files.some((file) => file.path === "generated-script.sh"), false);
    assert.ok(preview.excluded.some((file) => file.path === "generated-script.sh" && /unsafe/i.test(file.reason)));
  } finally { await f.close(); }
});
