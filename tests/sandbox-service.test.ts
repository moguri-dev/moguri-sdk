import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { nativeConfiguration, nativeFixtureCommand } from "./fixtures/native-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

const configuration = await nativeConfiguration();
async function nativeSdkFixture() {
  assert.ok(configuration);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-service-")), state = join(root, "state"), project = join(root, "project");
  for (const path of [state, project]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(project, "fixture.txt"), "generated source original\n");
  const provider = await fixtureProvider({ exposeModels: true }), vault = new GeneratedFileVault(join(root, "generated-vault.json"));
  const prepare = provider.provider.prepare.bind(provider.provider);
  provider.provider.prepare = async (id, signal) => {
    const value = await prepare(id, signal);
    return { ...value, model: { ...value.model, baseUrl: "https://api.githubcopilot.com" }, auth: { ...value.auth, baseUrl: "https://api.githubcopilot.com" } };
  };
  const service = await startService({ stateDir: state, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
    platform: { vault, sandbox: { vault, command: await nativeFixtureCommand(provider.modelId) } } });
  const sdk = await new MoguriSdk(service.connection).ready();
  return { root, project, provider, service, sdk, close: async (passed: boolean) => {
    sdk.disconnect(); await service.close(); await provider.close();
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error("Generated native service diagnostics retained:", root);
  } };
}
test("SDK native source review, real guest model/tools, Manual approvals and solver accounting never write the source checkout", { skip: !configuration, timeout: 90_000 }, async () => {
  assert.ok(configuration);
  const fixture = await nativeSdkFixture(), { sdk, provider, project } = fixture;
  const git = initializeGeneratedRepository(project);
  await writeFile(join(project, "staged-user.txt"), "Generated existing staged intent.\n"); git(["add", "staged-user.txt"]);
  await writeFile(join(project, "unrelated-user.txt"), "Generated unrelated untracked edit.\n");
  const index = await readFile(join(project, ".git", "index")), head = git(["rev-parse", "HEAD"]);
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = { ...configuration, qualification: { ...configuration.qualification!, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } };
    await sdk.settings.update(settings.values, settings.revision);
    await sdk.sandbox.probe();
    const bound = await sdk.command({ type: "project.add", path: project }), created = await sdk.sessions.create(bound.id!);
    const session = () => sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)!;
    await sdk.sessions.configure(created.id!, { ...session().controls, env: "Sandbox", modelId: provider.modelId });
    const preview = (await sdk.sandbox.preview(created.id!, ["fixture.txt"])).preview;
    const prepared = await sdk.sandbox.prepare(created.id!, ["fixture.txt"], preview.digest, session().revision);
    assert.equal(session().sandboxWorkspaceId, prepared.id);
    const original = await sdk.query({ type: "session.file", sessionId: created.id!, path: "fixture.txt" });
    assert.equal(original.text, "generated source original\n");
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated native write", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const approved: string[] = [];
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const current = session();
      if (current.pendingApproval && !approved.includes(current.pendingApproval.id)) {
        approved.push(current.pendingApproval.id);
        assert.ok(["read_file", "write_file"].includes(current.pendingApproval.call.name));
        await sdk.command({ type: "approval.respond", sessionId: current.id, approvalId: current.pendingApproval.id, allow: true });
      }
      if (!current.turnId && ["completed", "failed", "partial"].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(session().status, "completed", session().lastError ?? "Native turn did not settle.");
    assert.equal(approved.length, 2); assert.equal(provider.requests.length, 0, "No controller-side inference fallback.");
    assert.equal(session().usage.length, 3);
    assert.ok(session().usage.every((usage) => usage.quality === "provider-reported" && usage.totalTokens === 42));
    const execution = await waitFor(() => sdk.getState().snapshot!.sandboxExecutions?.find((value) => value.sessionId === created.id));
    assert.equal(execution.cleanup, "owned-guest-stopped");
    assert.equal(execution.workerOutcome, "completed"); assert.equal(execution.cliExitCode, 0);
    const result = (await sdk.sandbox.result(execution.id)).result!;
    assert.equal(result.journal.status, "verified");
    assert.equal(result.files.find((file) => file.path === "fixture.txt")?.text, "generated native replacement\n");
    const proof = JSON.parse(result.files.find((file) => file.path === "generated-native-proof.json")!.text);
    assert.equal(proof.calls.length, 3);
    assert.ok(proof.calls.every((call: { tools: string[] }) => call.tools.every((name) => ["ask_user", "list_files", "read_file", "write_file", "run_command"].includes(name))));
    assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated source original\n");
    const totals = (await sdk.budgets.status(created.id!)).status.totals;
    assert.equal(totals.calls, 3); assert.equal(totals.reportedTokens, 126);
    await assert.rejects(() => sdk.artifacts.update(execution.id, { text: "Generated forged native provenance." }, 0), /immutable/i);
    const exported = await sdk.artifacts.export(execution.id);
    assert.equal(JSON.parse(exported.export.text).schemaVersion, 6);
    await writeFile(join(project, "fixture.txt"), "Generated concurrent user edit.\n");
    await assert.rejects(() => sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"]), /changed|base/i);
    assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "Generated concurrent user edit.\n");
    await writeFile(join(project, "fixture.txt"), "generated source original\n");
    const review = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"])).preview;
    await assert.rejects(() => sdk.sandbox.publish(execution.id, ["fixture.txt"], "0".repeat(64), execution.revision), /review|current/i);
    const accepted = await sdk.sandbox.publish(execution.id, ["fixture.txt"], review.digest, execution.revision);
    const published = await sdk.sandbox.waitPublication(accepted.id!);
    assert.equal(published.publication.status, "completed", published.publication.diagnostic ?? "Native publication did not complete.");
    assert.equal(published.publication.acceptance.actor, "user");
    assert.deepEqual(published.publication.publishedPaths, ["fixture.txt"]);
    assert.equal(published.operation?.files[0]?.bytes, Buffer.byteLength("generated native replacement\n"));
    assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated native replacement\n");
    assert.deepEqual(await readFile(join(project, ".git", "index")), index);
    assert.equal(git(["rev-parse", "HEAD"]), head);
    assert.equal(await readFile(join(project, "unrelated-user.txt"), "utf8"), "Generated unrelated untracked edit.\n");
    await sdk.sessions.delete(created.id!, true);
    assert.equal((await sdk.sandbox.result(execution.id)).result?.files.find((file) => file.path === "fixture.txt")?.text, "generated native replacement\n");
    await sdk.artifacts.delete(execution.id, 0, true);
    const independent = await sdk.sandbox.publication(accepted.id!);
    assert.equal(independent.publication.status, "completed");
    assert.equal(independent.document.patch.edits[0]?.text, "generated native replacement\n");
    assert.ok((await sdk.artifacts.export(accepted.id!)).export.text.includes("generated native replacement"));
    passed = true;
  } finally {
    await fixture.close(passed);
  }
});

test("project-free native SDK turns read scoped long-paste pages through the authenticated broker without mounting or uploading the full file", { skip: !configuration, timeout: 90_000 }, async () => {
  assert.ok(configuration);
  const fixture = await nativeSdkFixture(), { sdk, provider } = fixture;
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = { ...configuration, qualification: { ...configuration.qualification!, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const created = await sdk.sessions.create(null), session = () => sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)!;
    await sdk.sessions.configure(created.id!, { ...session().controls, env: "Sandbox", modelId: provider.modelId });
    const preview = (await sdk.sandbox.preview(created.id!, [])).preview;
    await sdk.sandbox.prepare(created.id!, [], preview.digest, session().revision);
    const text = Array.from({ length: 51 }, (_, index) => `Generated native paste ${index} ${"x".repeat(500)}`).join("\r\n") + "\r\nGENERATED_PASTE_END_NOT_SENT";
    await sdk.command({ type: "draft.paste", sessionId: created.id!, expectedRevision: 0, text: "", attachments: [], pastedText: text, start: 0, end: 0 });
    const file = session().draft.attachments[0]!;
    assert.equal(file.kind, "paste_file");
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const pending = await waitFor(() => session().pendingApproval, 20_000);
    assert.equal(pending.call.name, "read_file"); assert.equal(pending.call.arguments.path, file.path);
    await sdk.command({ type: "approval.respond", sessionId: created.id!, approvalId: pending.id, allow: true });
    await waitFor(() => !session().turnId && ["completed", "failed", "partial"].includes(session().status), 20_000);
    assert.equal(session().status, "completed", session().lastError ?? "Native scoped-file read did not finish.");
    const execution = sdk.getState().snapshot!.sandboxExecutions!.find((value) => value.sessionId === created.id)!;
    assert.equal(execution.root, null); assert.equal(execution.sourceRoot, null);
    const result = (await sdk.sandbox.result(execution.id)).result!;
    const proof = JSON.parse(result.files.find((file) => file.path === "generated-native-proof.json")!.text);
    assert.equal(proof.calls.length, 2);
    assert.ok(proof.calls.every((call: { tail: boolean; tools: string[] }) => !call.tail && !call.tools.includes("run_command") && !call.tools.includes("write_file")));
    const tool = session().messages.find((message) => message.role === "tool")!;
    assert.match(tool.text, /scoped-controller-snapshot/);
    assert.match(tool.text, /Generated native paste 0/);
    assert.ok(tool.text.length < 1024);
    assert.equal(provider.requests.length, 0);
    assert.deepEqual((await sdk.attachments.read(created.id!, file.id)).content, { kind: "text", text });
    await assert.rejects(() => sdk.query({ type: "session.files", sessionId: created.id!, path: "." }), /project-bound|project-free/i);
    passed = true;
  } finally { await fixture.close(passed); }
});

test("actual native model cancellation holds unknown metering, verifies guest absence and refuses a rolled-back stage before draft consumption", { skip: !configuration, timeout: 90_000 }, async () => {
  assert.ok(configuration);
  const fixture = await nativeSdkFixture(), { sdk, provider } = fixture;
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = { ...configuration, qualification: { ...configuration.qualification!, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const created = await sdk.sessions.create(null), session = () => sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)!;
    await sdk.sessions.configure(created.id!, { ...session().controls, env: "Sandbox", modelId: provider.modelId });
    const preview = (await sdk.sandbox.preview(created.id!, [])).preview;
    await sdk.sandbox.prepare(created.id!, [], preview.digest, session().revision);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated native slow", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().messages.some((message) => message.text.includes("GENERATED_NATIVE_PENDING")), 20_000);
    await sdk.command({ type: "session.stop", sessionId: created.id! });
    await waitFor(() => !session().turnId && ["stopped", "partial", "failed"].includes(session().status), 20_000);
    assert.equal(session().status, "stopped", session().lastError ?? "Native stop was not acknowledged.");
    const execution = sdk.getState().snapshot!.sandboxExecutions!.find((value) => value.sessionId === created.id)!;
    assert.equal(execution.cleanup, "owned-guest-stopped"); assert.equal(execution.cliExitCode, 130);
    assert.equal((await sdk.sandbox.result(execution.id)).result?.rollback, "confirmed");
    const entry = (await sdk.budgets.calls({ sessionId: created.id! })).calls[0]!;
    assert.equal(entry.status, "unknown"); assert.equal(entry.reportedTokens, null); assert.ok(entry.reservedTokens! > 0);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "Generated retained next prompt.", attachments: [] });
    await assert.rejects(() => sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: session().draft.revision, delivery: "queue" }), /replaced|newly reviewed|stage/i);
    assert.equal(session().draft.text, "Generated retained next prompt.");
    assert.equal(sdk.getState().snapshot!.sandboxExecutions!.length, 1);
    assert.equal((await sdk.budgets.calls({ sessionId: created.id! })).calls.length, 1);
    assert.equal(provider.requests.length, 0);
    passed = true;
  } finally { await fixture.close(passed); }
});
