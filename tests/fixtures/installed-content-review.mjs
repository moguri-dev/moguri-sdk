import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixtureProvider, waitFor } from "../fixture.ts";

const installed = process.argv[2];
if (!installed) throw new Error("Provide the actual installed package root.");
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { PROTOCOL_VERSION } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
assert.ok(PROTOCOL_VERSION >= 83);
const root = await mkdtemp(join(tmpdir(), "moguri-installed-content-review-")), project = join(root, "project"), stateDir = join(root, "state");
await mkdir(project);
const source = "printf 'GENERATED_INSTALLED_FORCE' > generated-result.txt\n", secret = "GENERATED_HIDDEN_INSTALLED_WORK_ITEM";
await writeFile(join(project, "generated.sh"), source);
let phase = 0, reviewId = "", sourceDigest = "", safe = false, reviewedPath = "generated.sh", reviewedSource = source;
const generated = await fixtureProvider({ respond: (request) => {
  const toolResults = request.messages.filter((message) => message.role === "tool"), last = toolResults.at(-1);
  if (phase++ === 0) return { tool: { name: "discover_tools", args: { query: "review_script run_script" } } };
  if (phase === 2) return { tool: { name: "review_script", args: { action: "inspect", path: reviewedPath, interpreter: "sh" } } };
  if (phase === 3) {
    const result = JSON.parse(last.content);
    assert.equal(result.text, reviewedSource); assert.equal(result.complete, true);
    reviewId = result.inspection.id; sourceDigest = result.inspection.source.digest;
    return { tool: { name: "review_script", args: { action: "review", id: reviewId, path: reviewedPath,
      expectedDigest: sourceDigest, expectedRevision: 0, verdict: safe ? "safe" : "unsafe",
      summary: safe ? "Generated installed script only prints a fixture marker." : "Generated installed script writes its named output.",
      findings: [safe ? "Generated descriptive observation: prints one marker without network access." : "Generated output mutation needs an explicit actual-user decision."] } } };
  }
  if (phase === 4 && safe) return { text: "Generated safe assessment is ready for separate actual-user review." };
  if (phase === 4) return { tool: { name: "run_script", args: { reviewId, path: "generated.sh", expectedDigest: sourceDigest, expectedRevision: 1 } } };
  return { text: "Generated installed unsafe script blocked. Reported without execution approval." };
} });
const options = { stateDir, retentionKey: Buffer.alloc(32, 0x73), provider: generated.provider };
let runtime, sdk;
try {
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const added = await sdk.projects.add(project), created = await sdk.sessions.create(added.id, "Generated installed script review", { modelId: generated.modelId });
  const sessionId = created.id, current = () => sdk.getState().snapshot.sessions.find((session) => session.id === sessionId);
  const work = await sdk.issues.create(added.id, { title: "Generated installed item", body: `Visible installed work.<!--${secret}-->`,
    kind: "misc", phaseId: "backlog", pullRequestUrl: null });
  assert.equal((await sdk.issues.board(added.id)).issues.find((issue) => issue.id === work.id).body, "Visible installed work.");
  await sdk.sessions.autonomy(sessionId, "Autopilot");
  const saved = await sdk.command({ type: "draft.save", sessionId, text: "Generated installed source/review binding.", expectedRevision: 0, attachments: [] });
  await sdk.command({ type: "message.send", sessionId, expectedRevision: saved.revision, delivery: "queue" });
  await waitFor(() => current()?.status === "completed" && !current()?.turnId);
  const original = (await sdk.scriptReviews.read(sessionId, reviewId)).review;
  assert.equal(original.advice.verdict, "unsafe"); assert.equal(original.attempt, null); assert.equal(current().pendingApproval, null);
  const models = generated.requests.length;
  const cliRead = JSON.parse((await promisify(execFile)(process.execPath, [join(installed, "bin/moguri.mjs"), "script-review", "read", reviewId,
    "--session", sessionId, "--json"], { env: { ...process.env, MOGURI_STATE_DIR: stateDir }, encoding: "utf8", timeout: 15_000 })).stdout);
  assert.equal(cliRead.text, source);
  assert.equal((await sdk.slash(sessionId, "/script-review list", "tui")).kind, "text");
  const command = `/script-review force ${reviewId} ${original.revision} ${sourceDigest} ${current().revision} confirm-unsafe`;
  const queued = await sdk.command({ type: "draft.save", sessionId, text: command, expectedRevision: current().draft.revision, attachments: [] });
  await sdk.command({ type: "message.send", sessionId, expectedRevision: queued.revision, delivery: "queue", client: "tui" });
  const execution = await waitFor(() => {
    const value = sdk.getState().snapshot.commandExecutions.find((entry) => entry.sessionId === sessionId && entry.name === "script-review");
    return value && ["completed", "failed", "partial"].includes(value.status) ? value : null;
  });
  assert.equal(execution.status, "completed", execution.diagnostic ?? "");
  const recorded = await sdk.query({ type: "slash.read", executionId: execution.id });
  assert.equal(recorded.result.kind, "text");
  const forced = JSON.parse(recorded.result.text);
  assert.equal((await sdk.jobs.wait(forced.id)).status, "completed");
  assert.equal(await readFile(join(project, "generated-result.txt"), "utf8"), "GENERATED_INSTALLED_FORCE");
  const retained = (await sdk.scriptReviews.read(sessionId, reviewId)).review;
  assert.equal(retained.force.actor, "user"); assert.equal(retained.attempt.owner, "user"); assert.equal(generated.requests.length, models);
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  assert.deepEqual((await sdk.scriptReviews.read(sessionId, reviewId)).review, retained);
  await assert.rejects(() => sdk.scriptReviews.force(sessionId, reviewId, sourceDigest, retained.revision, current().revision), /original|retained|exact/i);
  assert.equal(generated.requests.length, models);
  if (PROTOCOL_VERSION >= 100) {
    phase = 0; safe = true; reviewedPath = "generated-safe.sh"; reviewedSource = "printf 'GENERATED_INSTALLED_SAFE\\n'\n";
    await writeFile(join(project, reviewedPath), reviewedSource);
    const draft = await sdk.command({ type: "draft.save", sessionId, text: "Generated installed safe assessment.", expectedRevision: current().draft.revision, attachments: [] });
    await sdk.command({ type: "message.send", sessionId, expectedRevision: draft.revision, delivery: "queue" });
    await waitFor(() => current()?.status === "completed" && !current()?.turnId);
    const assessed = (await sdk.scriptReviews.read(sessionId, reviewId)).review, calls = generated.requests.length;
    assert.equal(assessed.advice.verdict, "safe"); assert.equal(assessed.advice.findings.length, 1);
    assert.equal(sdk.attention.list().filter((entry) => entry.reason === "script-review" && entry.messageId === reviewId).length, 1);
    await promisify(execFile)(process.execPath, [join(installed, "bin/moguri.mjs"), "script-review", "approve", reviewId,
      String(assessed.revision), sourceDigest, String(current().revision), "confirm-reviewed", "--session", sessionId, "--json"],
    { env: { ...process.env, MOGURI_STATE_DIR: stateDir }, encoding: "utf8", timeout: 15_000 });
    await sdk.refresh();
    const accepted = (await sdk.scriptReviews.read(sessionId, reviewId)).review;
    assert.equal(accepted.approval.actor, "user"); assert.equal(accepted.approval.sourceDigest, sourceDigest);
    assert.equal(accepted.revision, assessed.revision); assert.equal(accepted.attempt, null);
    assert.equal(sdk.attention.list().filter((entry) => entry.reason === "script-review").length, 0);
    assert.equal(generated.requests.length, calls);
    sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
    assert.deepEqual((await sdk.scriptReviews.read(sessionId, reviewId)).review, accepted);
    assert.equal(generated.requests.length, calls);
  }
  if (PROTOCOL_VERSION >= 101) {
    const calls = generated.requests.length;
    const git = (args) => promisify(execFile)("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
      { cwd: project, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", timeout: 15_000 });
    await git(["init", "--initial-branch=main"]);
    await git(["add", "--", "generated.sh", "generated-safe.sh"]);
    await git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated installed baseline"]);
    const { preview } = await sdk.repositoryTrust.preview(added.id);
    assert.ok(preview.files.some((file) => file.path === "generated-safe.sh"));
    assert.ok(preview.excluded.some((file) => file.path === "generated.sh" && /unsafe/i.test(file.reason)));
    await sdk.repositoryTrust.trust(preview);
    assert.equal(sdk.repositoryTrust.get(added.id).actor, "user");
    const task = await sdk.sessions.create(added.id, "Generated installed default worktree");
    const isolated = sdk.sessions.get(task.id);
    assert.equal(isolated.workspaceOrigin, "default-worktree");
    const workspace = await sdk.workspaces.wait(isolated.workspaceId);
    assert.equal(workspace.status, "ready"); assert.notEqual(workspace.path, project);
    assert.equal(await readFile(join(workspace.path, "generated-safe.sh"), "utf8"), reviewedSource);
    assert.equal((await git(["branch", "--show-current"])).stdout.trim(), "main");
    const filtered = JSON.parse((await promisify(execFile)(process.execPath, [join(installed, "bin/moguri.mjs"), "inbox", "list",
      "--filters", JSON.stringify({ type: "completed", query: "generated installed script review" }), "--json"],
    { env: { ...process.env, MOGURI_STATE_DIR: stateDir }, encoding: "utf8", timeout: 15_000 })).stdout);
    assert.ok(filtered.length > 0 && filtered.every((entry) => entry.reason === "completed" && entry.sessionId === sessionId));
    assert.equal((await sdk.slash(sessionId, `/inbox list ${JSON.stringify({ type: "script-review" })}`, "tui")).kind, "text");
    await sdk.repositoryTrust.revoke(added.id, sdk.repositoryTrust.get(added.id).revision);
    assert.equal(sdk.repositoryTrust.get(added.id).status, "revoked");
    assert.equal(generated.requests.length, calls);
  }
  console.log(`Installed protocol${PROTOCOL_VERSION} SDK/CLI/TUI, actual worker, full-source model review, unsafe/no-prompt gate, separate user force, ${PROTOCOL_VERSION >= 100 ? "descriptive safe findings and exact user approval/Inbox cleanup, " : ""}${PROTOCOL_VERSION >= 101 ? "actual-user trust/revocation, default worktree and shared notification filters, " : ""}comment filtering and restart/no-replay passed using generated loopback inference only.`);
} finally { sdk?.disconnect(); await runtime?.close(); await generated.close(); await rm(root, { recursive: true, force: true }); }
