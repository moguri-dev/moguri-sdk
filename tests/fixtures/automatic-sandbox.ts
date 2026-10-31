import type { TestContext } from "node:test";
import { MoguriSdk, MoguriError, defaultSandboxManagement, type SandboxConfiguration, type SandboxExecution } from "../../packages/sdk/src/index.ts";
import { frameDigest } from "../../apps/service/src/worker-wire.ts";
import { setupFixture } from "../fixture.ts";
import type { SandboxDns } from "../../apps/service/src/sandbox-network.ts";

const hash = "1".repeat(64);
const configuration: SandboxConfiguration = { executable: "/generated/sendbox", configPath: null,
  image: `generated/worker@sha256:${hash}`, bundlePath: "/generated/bundle", trustRootPath: "/generated/root.key",
  qualification: { release: "0.2.3", hostSha256: hash, keySha256: hash, manifestSha256: hash, workerDigest: hash, bridgeDigest: hash,
    trustRootId: "generated", minimumReleaseSequence: 7, allowedDomains: ["github.com", "api.github.com"], allowCopilot: true,
    resources: { cpus: 2, memoryMb: 4096, diskMb: 8192 } } };
const dns: SandboxDns = { addresses: async () => ["1.1.1.1"], aliases: async (host) => host === "api.individual.githubcopilot.com" ? ["api.githubcopilot.com"] :
  host === "api.githubcopilot.com" ? ["generated-edge.github.com"] : [] };
export async function automaticFixture(context: TestContext, resolver = dns) {
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
