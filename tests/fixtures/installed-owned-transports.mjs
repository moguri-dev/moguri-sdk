import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureProvider, waitFor } from "../fixture.ts";
import { createSshTarget } from "./ssh-target.ts";
import { generatedTechnicalAdvice } from "./decisions-api.ts";
import { initializeGeneratedRepository } from "./git-project.ts";

const installed = process.argv[2];
if (!installed) throw new Error("Provide the independently installed package root.");
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { PROTOCOL_VERSION, defaultKupoSettings } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
assert.ok(PROTOCOL_VERSION >= 85);
const primaryOptions = { exposeModels: true, responseMode: "auto", maxOutputTokens: 128 };
const primary = await fixtureProvider(primaryOptions), adviceOptions = { modelId: "generated-installed-owned-advice", exposeModels: true,
  responseMode: "text", maxOutputTokens: 128, replyText: generatedTechnicalAdvice() }, advice = await fixtureProvider(adviceOptions);
const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-owned-"))), project = join(root, "project"), workspace = join(root, "peer-project"), sshRoot = join(root, "ssh");
for (const path of [project, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
await writeFile(join(workspace, "fixture.txt"), "Generated independently installed SSH source.\n");
const ssh = await createSshTarget(sshRoot), secrets = new Map(), vault = { read: async (id) => secrets.get(id) ?? null,
  write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); } };
ssh.target.command = [process.execPath, join(installed, "dist/remote-bridge.mjs")];
const stateDir = join(root, "state"), options = { stateDir, retentionKey: Buffer.alloc(32, 0x49), provider: primary.provider,
  platform: { remote: { vault, modelsVault: vault } } };
let runtime, sdk, tightened;
try {
  runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  const added = await sdk.projects.add(project), created = await sdk.sessions.create(added.id, "Generated installed owned transport");
  const settings = structuredClone(sdk.settings.get().values);
  settings.remote = { ...ssh.target, models: [{ id: "generated-installed-owned", name: "Generated installed owned", enabled: true,
    baseUrl: advice.baseUrl + "/v1", auth: "none", models: [{ id: advice.modelId, name: "Generated installed advice",
      contextWindow: 16384, maxTokens: 128, imageInput: false }] }] };
  settings.kupo = { ...defaultKupoSettings(), approvedModelIds: [primary.modelId] };
  await sdk.settings.update(settings, sdk.settings.get().revision); await sdk.remote.probe(); await sdk.models.refresh();
  const decisionModel = sdk.getState().snapshot.provider.models.find((model) => model.name === "Generated installed advice");
  assert.ok(decisionModel);
  const configured = structuredClone(sdk.settings.get().values);
  configured.decisions = { ...configured.decisions, enabled: true, modelId: decisionModel.id, outputTokens: 128,
    technicalQuestions: [{ id: "generated-installed-exact-choice", kind: "technical-choice", question: "Choose a generated fixture approach?",
      choices: ["Generated first choice", "Generated second choice"] }] };
  await sdk.settings.update(configured, sdk.settings.get().revision);
  const configuration = (await sdk.projects.configuration(added.id)).configuration;
  await sdk.projects.configure(added.id, { ...configuration.values, remotePath: workspace }, configuration.revision);
  const current = () => sdk.getState().snapshot.sessions.find((session) => session.id === created.id);
  await sdk.sessions.configure(created.id, { ...current().controls, env: "Remote", modelId: "kupo" });
  await sdk.sessions.autonomy(created.id, "Autopilot Max");
  const send = async (text) => {
    await sdk.command({ type: "draft.save", sessionId: created.id, expectedRevision: current().draft.revision, text, attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id, expectedRevision: current().draft.revision, delivery: "queue" });
  };
  await send("generated structured question choices only through independently installed SSH Kupo");
  await waitFor(() => current()?.status === "completed" && !current().turnId, 20000).catch((error) => {
    throw new Error(`Generated installed SSH decision gate: ${JSON.stringify({ status: current()?.status, diagnostic: current()?.lastError,
      solverCalls: primary.requests.length, decisionCalls: advice.requests.length, decisions: sdk.getState().snapshot.decisions.map((record) =>
        ({ status: record.status, diagnostic: record.diagnostic, cleanup: record.cleanup })) })}`, { cause: error });
  });
  const decision = (await sdk.decisions.read(sdk.decisions.list(created.id)[0].id)).decision;
  assert.equal(decision.version, 2); assert.equal(decision.env, "Remote"); assert.equal(decision.cleanup, "owned-role-acknowledged");
  assert.equal(decision.status, "applied"); assert.equal(sdk.getState().snapshot.questions[0].answer.actor, "decision-provider");
  assert.deepEqual(sdk.getState().snapshot.budgetEntries.map((entry) => [entry.env, entry.role]),
    [["Remote", "solver"], ["Remote", "decision"], ["Remote", "solver"]]);
  assert.equal(primary.requests.length, 2); assert.equal(advice.requests.length, 1);
  const finishing = structuredClone(sdk.settings.get().values);
  finishing.winddown = { ...finishing.winddown, enabled: true, modelId: decisionModel.id, outputTokens: 128 };
  await sdk.settings.update(finishing, sdk.settings.get().revision);
  await sdk.sessions.configure(created.id, { ...current().controls, budget: { kind: "limited", basis: "estimate", tokens: 500000 } });
  primaryOptions.respond = (request) => {
    const messages = request.messages;
    const lastUser = messages.findLastIndex((message) => message.role === "user");
    return messages.slice(lastUser + 1).some((message) => message.role === "tool") ? { text: "Generated ordinary answer." } :
      { tool: { name: "read_file", args: { path: "fixture.txt" } } };
  };
  adviceOptions.replyText = '{"summary":"Generated installed source-independent finishing data."}';
  runtime.controller.on("change", (events) => {
    if (tightened || !events.some((event) => event.event_type === "model.completed" && event.session_id === created.id && event.payload.usage.role === "solver")) return;
    const snapshot = runtime.controller.snapshot(), record = snapshot.winddowns.at(-1);
    assert.ok(record);
    const tokens = snapshot.budgetEntries.reduce((sum, entry) => sum + (entry.reportedTokens ?? 0), 0);
    tightened = runtime.controller.dispatch({ id: randomUUID(), profileId: sdk.profileId, command: { type: "budget.policy",
      expectedRevision: snapshot.budgetPolicy.revision, limit: { basis: "estimate", tokens: tokens + record.step.inputBound + record.step.outputBound }, confirmRisk: true } });
  });
  await send("GENERATED_INSTALLED_TASK_NOT_FINISHING_CONTEXT");
  await waitFor(() => current()?.status === "partial" && !current().turnId, 20000).catch((error) => {
    throw new Error(`Generated installed SSH finishing gate: ${JSON.stringify({ status: current()?.status, diagnostic: current()?.lastError,
      solverCalls: primary.requests.length, finishingCalls: advice.requests.length, reports: sdk.getState().snapshot.winddowns.map((record) =>
        ({ status: record.status, diagnostic: record.diagnostic, step: record.step.state })) })}`, { cause: error });
  }); await tightened;
  const report = await sdk.winddown.read(sdk.winddown.list(created.id).at(-1).id);
  assert.equal(report.winddown.version, PROTOCOL_VERSION >= 86 ? 3 : 2); assert.equal(report.winddown.env, "Remote"); assert.equal(report.winddown.status, "ready");
  assert.ok(report.winddown.transport.executionId !== decision.transport.executionId);
  assert.equal(report.roleInput.includes("GENERATED_INSTALLED_TASK_NOT_FINISHING_CONTEXT"), false);
  assert.equal(sdk.getState().snapshot.budgetEntries.at(-1).role, "checkpoint");
  assert.equal(sdk.getState().snapshot.budgetPlans.find((plan) => plan.id === report.winddown.step.planId).status, "consumed");
  await assert.rejects(() => sdk.winddown.commitPreview({ sessionId: created.id, winddownId: report.winddown.id,
    candidateIds: ["generated-not-local"], branch: "generated/never-local", message: "Generated no-root-transfer." }), /Local accepted-work\/Git|Remote\/native boundary/);
  if (PROTOCOL_VERSION >= 86) {
    const git = initializeGeneratedRepository(workspace);
    git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    await sdk.workspaces.file(created.id, "fixture.txt"); await sdk.command({ type: "session.resume", sessionId: created.id });
    await writeFile(join(workspace, "fixture.txt"), "Generated installed separately accepted peer source.\n");
    const deepPath = "generated/".repeat(14) + "fixture.txt", paths = ["fixture.txt", deepPath];
    await mkdir(join(workspace, dirname(deepPath)), { recursive: true }); await writeFile(join(workspace, deepPath), "Generated installed deep peer path.\n");
    const source = await sdk.winddown.sourcePreview(report.winddown.id, paths);
    await sdk.winddown.acceptSource(report.winddown.id, paths, source.preview.revision, source.preview.digest, true);
    const checkpoint = { winddownId: report.winddown.id, sessionId: created.id, candidateIds: [], remoteAccepted: true,
      branch: "moguri/generated-installed-peer-checkpoint", message: "Retain exact installed peer source" };
    const review = await sdk.winddown.commitPreview(checkpoint), head = git(["rev-parse", "HEAD"]);
    await sdk.winddown.commit(checkpoint, review.preview.revision, review.preview.digest, true);
    const completed = await sdk.winddown.waitCommit(report.winddown.id);
    assert.equal(completed.winddown.status, "completed");
    assert.equal(git(["show", checkpoint.branch + ":fixture.txt"]), "Generated installed separately accepted peer source.");
    assert.equal(git(["show", checkpoint.branch + ":" + deepPath]), "Generated installed deep peer path.");
    assert.equal(git(["rev-parse", "HEAD"]), head);
    assert.equal((await sdk.winddown.inspectCommit(report.winddown.id)).inspection.review.document.actualCommit, completed.winddown.commit.publishedCommit);
  }
  const count = primary.requests.length + advice.requests.length;
  sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await connectMoguri({ stateDir, autoStart: false });
  assert.equal((await sdk.decisions.read(decision.id)).decision.transport.executionId, decision.transport.executionId);
  assert.equal((await sdk.winddown.read(report.winddown.id)).winddown.status, PROTOCOL_VERSION >= 86 ? "completed" : "ready");
  assert.equal(primary.requests.length + advice.requests.length, count);
  console.log(`Installed protocol${PROTOCOL_VERSION} runtime/SDK and installed SSH worker: owned Balanced-Kupo technical decision, actual role actor/transport, complete all-role holds, selected-peer finishing, separately accepted peer Git with current ref/source inspection and restart/no-replay passed.`);
} finally {
  sdk?.disconnect(); await runtime?.close(); await ssh.close(); await primary.close(); await advice.close();
  await rm(root, { recursive: true, force: true });
}
