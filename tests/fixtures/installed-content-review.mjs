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
let phase = 0, reviewId = "", sourceDigest = "";
const generated = await fixtureProvider({ respond: (request) => {
  const toolResults = request.messages.filter((message) => message.role === "tool"), last = toolResults.at(-1);
  if (phase++ === 0) return { tool: { name: "discover_tools", args: { query: "review_script run_script" } } };
  if (phase === 2) return { tool: { name: "review_script", args: { action: "inspect", path: "generated.sh", interpreter: "sh" } } };
  if (phase === 3) {
    const result = JSON.parse(last.content);
    assert.equal(result.text, source); assert.equal(result.complete, true);
    reviewId = result.inspection.id; sourceDigest = result.inspection.source.digest;
    return { tool: { name: "review_script", args: { action: "review", id: reviewId, path: "generated.sh",
      expectedDigest: sourceDigest, expectedRevision: 0, verdict: "unsafe", summary: "Generated installed script writes its named output.",
      findings: ["Generated output mutation needs an explicit actual-user decision."] } } };
  }
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
  const forced = await sdk.scriptReviews.force(sessionId, reviewId, sourceDigest, original.revision, current().revision, "generated-installed-force");
  assert.equal((await sdk.jobs.wait(forced.id)).status, "completed");
  assert.equal(await readFile(join(project, "generated-result.txt"), "utf8"), "GENERATED_INSTALLED_FORCE");
  const retained = (await sdk.scriptReviews.read(sessionId, reviewId)).review;
  assert.equal(retained.force.actor, "user"); assert.equal(retained.attempt.owner, "user"); assert.equal(generated.requests.length, models);
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  assert.deepEqual((await sdk.scriptReviews.read(sessionId, reviewId)).review, retained);
  await assert.rejects(() => sdk.scriptReviews.force(sessionId, reviewId, sourceDigest, retained.revision, current().revision), /original|retained|exact/i);
  assert.equal(generated.requests.length, models);
  console.log("Installed protocol83 SDK/CLI/TUI, actual worker, full-source model review, unsafe/no-prompt gate, separate user force, comment filtering and restart/no-replay passed using generated loopback inference only.");
} finally { sdk?.disconnect(); await runtime?.close(); await generated.close(); await rm(root, { recursive: true, force: true }); }
