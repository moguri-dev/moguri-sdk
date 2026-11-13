import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { profileFixture } from "./fixtures/profiles.ts";
import { nativeConfiguration, nativeFixtureCommand } from "./fixtures/native-target.ts";
import { waitFor } from "./fixture.ts";
import { defaultSandboxManagement } from "../packages/sdk/src/index.ts";

const configuration = await nativeConfiguration();
test("actual simultaneous native profiles isolate their private roots, original Stop authority and unknown global holds", {
  skip: !configuration, timeout: 120000,
}, async () => {
  assert.ok(configuration?.qualification);
  const vaults = new Map<string, Map<string, string>>();
  const f = await profileFixture((profileId) => {
    const values = new Map<string, string>(); vaults.set(profileId, values);
    const vault = { read: async (id: string) => values.get(id) ?? null,
      write: async (id: string, value: string) => { values.set(id, value); }, remove: async (id: string) => { values.delete(id); } };
    return { terminal: { vault }, sandbox: { vault, dns: { addresses: async () => ["1.1.1.1"], aliases: async () => [] } } };
  });
  let passed = false;
  try {
    const base = await realpath(f.directory);
    const roots = [join(base, "generated-native-alpha-source"), join(base, "generated-native-beta-source")];
    for (const root of roots) {
      await mkdir(root, { mode: 0o700 }); await writeFile(join(root, "fixture.txt"), "Generated unchanged profile source.\n");
    }
    const beta = await f.create("Generated native Beta"), clients = [f.sdk, beta.client];
    const sessions: Array<{ client: typeof f.sdk; id: string }> = [];
    for (const [index, client] of clients.entries()) {
      const provider = f.providers[index]!, prepare = provider.provider.prepare.bind(provider.provider);
      provider.provider.prepare = async (id, signal) => {
        const value = await prepare(id, signal), baseUrl = "https://api.githubcopilot.com";
        return { ...value, model: { ...value.model, baseUrl }, auth: { ...value.auth, baseUrl } };
      };
      const control = await f.service.profiles.control(client.profileId), command = await nativeFixtureCommand(provider.modelId);
      control.sandbox.workerArgv = () => [...command];
      const settings = client.settings.get()!;
      await client.settings.update({ ...settings.values,
        sandbox: { ...configuration, qualification: { ...configuration.qualification!, allowedDomains: ["api.githubcopilot.com"], allowCopilot: true } },
        sandboxManagement: { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false } }, settings.revision);
      await client.sandbox.probe();
      const project = await client.projects.add(roots[index]!);
      const created = await client.sessions.create(project.id!, `Generated native profile ${index}`, { env: "Sandbox", modelId: provider.modelId });
      sessions.push({ client, id: created.id! });
    }
    await f.sdk.profiles.globalBudget({ basis: "estimate", tokens: 100000 }, 0, true);
    await Promise.all(sessions.map(({ client, id }) => f.send(client, id, "generated native slow")));
    await waitFor(() => sessions.every(({ client, id }) => f.session(client, id).messages.some((message) => message.text.includes("GENERATED_NATIVE_PENDING"))), 30000);
    const controls = await Promise.all(clients.map((client) => f.service.profiles.control(client.profileId)));
    const executions = controls.map((control) => control.snapshot().sandboxExecutions![0]!);
    assert.ok(executions.every((execution) => execution.nativeSessionId && execution.status === "running"));
    assert.notEqual(executions[0]!.nativeSessionId, executions[1]!.nativeSessionId);
    assert.notEqual(executions[0]!.stage.workspace, executions[1]!.stage.workspace);
    assert.deepEqual(executions.map((execution) => execution.sourceRoot), roots);
    await assert.rejects(() => f.sdk.command({ type: "session.stop", sessionId: sessions[1]!.id }), /session|profile|outside|missing/i);
    await assert.rejects(() => f.sdk.sandbox.execution(executions[1]!.id), /execution|profile|outside|missing/i);
    await sessions[0]!.client.command({ type: "session.stop", sessionId: sessions[0]!.id });
    await waitFor(() => !f.session(sessions[0]!.client, sessions[0]!.id).turnId, 30000);
    assert.ok(f.session(sessions[1]!.client, sessions[1]!.id).turnId);
    assert.equal(controls[1]!.snapshot().sandboxExecutions![0]!.status, "running");
    await sessions[1]!.client.command({ type: "session.stop", sessionId: sessions[1]!.id });
    await waitFor(() => controls.every((control) => control.snapshot().sandboxExecutions!.every((execution) =>
      execution.cleanup === "owned-guest-stopped" && !control.sandbox.owns(execution.id))), 30000);
    const entries = controls.map((control) => control.snapshot().budgetEntries);
    assert.ok(entries.every((entries) => entries.length === 1 && entries[0]!.status === "unknown" &&
      entries[0]!.reportedTokens === null && entries[0]!.reservedTokens! > 0));
    const held = entries.flat().reduce((sum, entry) => sum + entry.reservedTokens!, 0);
    assert.equal((await f.sdk.budgets.status(sessions[0]!.id)).status.remainingTokens, 100000 - held);
    assert.ok(f.sdk.getState().events.every((event) => event.profile_id === f.sdk.profileId));
    assert.ok(beta.client.getState().events.every((event) => event.profile_id === beta.client.profileId));
    assert.equal(f.sdk.getState().snapshot!.sessions.some((session) => session.id === sessions[1]!.id), false);
    assert.equal(beta.client.getState().snapshot!.sessions.some((session) => session.id === sessions[0]!.id), false);
    assert.ok(f.providers.every((provider) => provider.requests.length === 0));
    for (const root of roots) assert.equal(await readFile(join(root, "fixture.txt"), "utf8"), "Generated unchanged profile source.\n");
    assert.ok(vaults.size >= 2 && [...vaults.values()].every((values) => values.size > 0));
    passed = true;
  } catch (error) {
    console.error("Generated native profile qualification failed:", error instanceof Error ? error.message : "Unknown original failure.",
      JSON.stringify(await Promise.all(f.clients.map(async (client) => {
        const state = (await f.service.profiles.control(client.profileId)).snapshot();
        return { profileId: client.profileId, sessions: state.sessions.map(({ status, lastError, turnId }) => ({ status, lastError, turnId })),
          executions: state.sandboxExecutions?.map(({ status, cleanup, diagnostic }) => ({ status, cleanup, diagnostic })),
          calls: state.budgetEntries.map(({ status, reservedTokens }) => ({ status, reservedTokens })) };
      }))));
    throw error;
  } finally { await f.close(!passed); }
});
