import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { MoguriSdk, MoguriError, defaultSandboxManagement, type SandboxConfiguration, type SandboxExecution } from "../packages/sdk/src/index.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import type { SandboxDns } from "../apps/service/src/sandbox-network.ts";

const native = { skip: process.platform !== "darwin", timeout: 20_000 }, hash = "1".repeat(64);
const configuration: SandboxConfiguration = { executable: "/generated/sendbox", configPath: null,
  image: `generated/worker@sha256:${hash}`, bundlePath: "/generated/bundle", trustRootPath: "/generated/root.key",
  qualification: { release: "0.2.3", hostSha256: hash, keySha256: hash, manifestSha256: hash, workerDigest: hash, bridgeDigest: hash,
    trustRootId: "generated", minimumReleaseSequence: 7, allowedDomains: ["github.com", "api.github.com"], allowCopilot: true,
    resources: { cpus: 2, memoryMb: 4096, diskMb: 8192 } } };
const dns: SandboxDns = { addresses: async () => ["1.1.1.1"], aliases: async (host) => host === "api.individual.githubcopilot.com" ? ["api.githubcopilot.com"] :
  host === "api.githubcopilot.com" ? ["generated-edge.github.com"] : [] };
async function automaticFixture(context: TestContext, resolver = dns) {
  const fixture = await setupFixture({ platform: { sandbox: { dns: resolver } } }), controller = fixture.service.controller;
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const state = sdk.settings.get()!;
  await sdk.settings.update({ ...state.values, sandbox: configuration, sandboxManagement: { ...defaultSandboxManagement(), enabled: true } }, state.revision);
  controller.sandbox.readiness = { ready: true, configured: true, diagnostic: "Generated staging-only native fixture; no VM.",
    configDigest: frameDigest(configuration), release: "0.2.3", workerDigest: hash, image: configuration.image };
  controller.provider.synchronize();
  const prepare = fixture.provider.prepare.bind(fixture.provider);
  context.mock.method(fixture.provider, "prepare", async (id: string, signal: AbortSignal) => {
    const value = await prepare(id, signal);
    return { ...value, model: { ...value.model, baseUrl: "https://api.individual.githubcopilot.com" },
      auth: { ...value.auth, baseUrl: "https://api.individual.githubcopilot.com" } };
  });
  const executions: SandboxExecution[] = [];
  context.mock.method(controller.sandbox, "launch", (execution: SandboxExecution) => {
    executions.push(execution); throw new MoguriError("generated_no_guest", "Generated stop at launch. No guest or inference was dispatched.", 409);
  });
  await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, env: "Sandbox", modelId: fixture.modelId });
  return { ...fixture, sdk, controller, executions, close: async () => { sdk.disconnect(); await fixture.close(); } };
}

test("managed Send automatically snapshots the complete bound project and captures actual provider aliases before guest admission", native, async (context) => {
  const fixture = await automaticFixture(context);
  try {
    await writeFile(join(fixture.project, "generated-extra.txt"), "Generated automatically included.\n");
    await fixture.send("Generated automatic Sandbox prompt.");
    await waitFor(() => fixture.executions[0]);
    const execution = fixture.executions[0]!;
    assert.equal(execution.sourceRoot, await import("node:fs/promises").then((fs) => fs.realpath(fixture.project)));
    assert.equal(execution.root, "/workspace");
    assert.equal(await readFile(join(execution.stage.workspace, "generated-extra.txt"), "utf8"), "Generated automatically included.\n");
    assert.deepEqual(execution.networkScope?.providerHosts, ["api.individual.githubcopilot.com"]);
    assert.ok(execution.config.qualification!.allowedDomains.includes("generated-edge.github.com"));
    assert.equal(execution.config.qualification!.allowedDomains.includes("google.com"), false);
    const workspace = fixture.controller.snapshot().sandboxWorkspaces!.find((value) => value.id === execution.workspaceId)!;
    assert.equal(workspace.preparation?.kind, "automatic"); assert.equal(workspace.preparation?.turnId, execution.turnId);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("project-free managed chats prepare an empty root-less workspace without inheriting any project", native, async (context) => {
  const fixture = await automaticFixture(context);
  try {
    const created = await fixture.sdk.sessions.create(null, "Generated automatic root-less", { env: "Sandbox", modelId: fixture.modelId });
    await fixture.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated root-less prompt.", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.executions[0]);
    assert.equal(fixture.executions[0]!.sourceRoot, null); assert.equal(fixture.executions[0]!.root, null);
    const input = fixture.controller.sandboxWorkspaces.document(fixture.executions[0]!);
    assert.equal(input.version, 2); assert.equal(input.source, null);
    if (input.version === 2) assert.equal(input.workingSource.files.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("Stop during provider preparation owns cancellation, holds later prompts and never launches a guest or paid role", native, async (context) => {
  const fixture = await automaticFixture(context), entered = Promise.withResolvers<void>();
  context.mock.method(fixture.provider, "prepare", async (_id: string, signal: AbortSignal) => {
    entered.resolve();
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    throw new Error("Generated unreachable.");
  });
  try {
    await fixture.send("Generated waiting native turn."); await entered.promise;
    await fixture.send("Generated next queued prompt.");
    await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    await waitFor(() => fixture.session().status === "stopped");
    assert.equal(fixture.executions.length, 0); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().queue.length, 1); assert.equal(fixture.session().queue[0]!.held, true);
    assert.equal(fixture.controller.snapshot().budgetEntries.length, 0);
  } finally { await fixture.close(); }
});

test("revoked provider-network policy during DNS resolution blocks admission without substituting a worker", native, async (context) => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const resolver: SandboxDns = { aliases: async () => [], addresses: async () => { entered.resolve(); await release.promise; return ["1.1.1.1"]; } };
  const fixture = await automaticFixture(context, resolver);
  try {
    await fixture.send("Generated revoked pending provider."); await entered.promise;
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, sandboxManagement: { ...defaultSandboxManagement(), enabled: true, automaticProviderNetwork: false } }, settings.revision);
    release.resolve();
    await waitFor(() => fixture.session().status === "failed");
    assert.equal(fixture.executions.length, 0); assert.equal(fixture.requests.length, 0);
    assert.match(fixture.session().lastError!, /scope|policy|changed/);
  } finally { release.resolve(); await fixture.close(); }
});
