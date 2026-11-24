import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { hostedSecretId } from "../apps/service/src/hosted-providers.ts";
import { MoguriSdk, type LocalEndpoint } from "../packages/sdk/src/index.ts";
import { profileFixture } from "./fixtures/profiles.ts";

const anthropicKey = "sk-ant-api03-generated-import-key", endpointToken = "generated-endpoint-token";
const endpoint: LocalEndpoint = { id: "generated-gateway", name: "Generated gateway", enabled: true, baseUrl: "http://127.0.0.1:9/v1", auth: "bearer", discovery: false,
  models: [{ id: "generated-model", name: "Generated model", contextWindow: 32768, maxTokens: 1024, imageInput: false }] };

async function settings(client: MoguriSdk, change: (values: NonNullable<ReturnType<MoguriSdk["settings"]["get"]>>["values"]) => void) {
  await client.refresh();
  const current = client.settings.get()!, values = structuredClone(current.values);
  change(values);
  await client.settings.update(values, current.revision);
}

test("a new profile imports reviewed API keys, endpoints, preferences and skill sources from another profile without copying sign-ins or changing the source", async () => {
  const models = new Map<string, Map<string, string>>(), failing = new Set<string>(), modelVault = (id: string) => {
    let secrets = models.get(id); if (!secrets) { secrets = new Map(); models.set(id, secrets); }
    const scoped = secrets;
    return { read: async (key: string) => scoped.get(key) ?? null, remove: async (key: string) => { scoped.delete(key); },
      write: async (key: string, value: string) => { if (failing.has(id) && key.startsWith("local-")) throw new Error("Generated locked keychain"); scoped.set(key, value); } };
  };
  const fixture = await profileFixture((id) => ({ models: { vault: modelVault(id), hosted: { baseUrls: { anthropic: "http://127.0.0.1:9", openrouter: "http://127.0.0.1:9/api/v1" } } } }));
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const source = fixture.sdk, repository = join(fixture.directory, "generated-repository"), skills = join(fixture.directory, "generated-skills");
    await mkdir(repository); await mkdir(skills);
    await source.projects.add(repository, "generated-repository");
    const sourceVault = models.get("default")!;
    sourceVault.set(hostedSecretId("anthropic"), JSON.stringify({ type: "api_key", key: anthropicKey }));
    sourceVault.set(hostedSecretId("openrouter"), JSON.stringify({ type: "oauth", access: "generated-access", refresh: "generated-refresh", expires: Date.now() + 3_600_000 }));
    await settings(source, (values) => {
      values.hostedProviders = ["anthropic", "openrouter"]; values.localModels = [endpoint];
      values.modelPreferences = { disabledProviders: [], disabledModels: ["generated-disabled"], sources: [] };
      values.skillSources = [{ id: "generated-folder", name: "Generated skills", enabled: true, kind: "local", path: skills }];
    });
    await (await fixture.service.profiles.control("default")).provider.storeEndpointToken(endpoint, endpointToken, AbortSignal.timeout(5000));
    const sourceSecrets = structuredClone([...sourceVault]), sourceRevision = source.settings.get()!.revision;

    const { profile, client } = await fixture.create("Generated imported");
    const reviewed = await client.profiles.imports.preview("default");
    const text = JSON.stringify(reviewed);
    assert.ok(![anthropicKey, endpointToken, "generated-access", "generated-refresh"].some((secret) => text.includes(secret)), "previews never carry secrets");
    assert.deepEqual(reviewed.preview.hostedProviders, [{ providerId: "anthropic", credential: "api_key", configured: false }, { providerId: "openrouter", credential: "oauth", configured: false }]);
    assert.deepEqual(reviewed.preview.localEndpoints.map(({ id, keyStored, configured }) => [id, keyStored, configured]), [["generated-gateway", true, false]]);
    assert.deepEqual(reviewed.preview.modelPreferences, { disabledProviders: 0, disabledModels: 1, sources: 0 });
    assert.deepEqual(reviewed.preview.skillSources.map(({ id, location, configured }) => [id, location, configured]), [["generated-folder", skills, false]]);
    assert.equal(reviewed.preview.repositories.length, 1); assert.equal(reviewed.preview.repositories[0]!.registered, false);

    await assert.rejects(() => source.profiles.imports.preview("default"), { code: "profile_import_source" });
    await assert.rejects(() => client.profiles.imports.apply("default", reviewed.digest, { hostedProviders: ["openrouter"] }), { code: "profile_import_sign_in" });
    await assert.rejects(() => client.profiles.imports.apply("default", "0".repeat(64), { hostedProviders: ["anthropic"] }), { code: "profile_import_stale" });
    await assert.rejects(() => client.profiles.imports.apply("default", reviewed.digest, {}), { code: "profile_import_empty" });
    assert.equal(models.get(profile.id)?.size ?? 0, 0, "refused imports store nothing");
    failing.add(profile.id);
    await assert.rejects(() => client.profiles.imports.apply("default", reviewed.digest, { hostedProviders: ["anthropic"], localEndpoints: ["generated-gateway"] }), { code: "profile_import_secret" });
    failing.delete(profile.id);
    await client.refresh();
    assert.equal(models.get(profile.id)?.size ?? 0, 0, "a failed copy removes the keys it already wrote");
    assert.deepEqual([client.settings.get()!.values.hostedProviders ?? [], client.settings.get()!.values.localModels], [[], []], "and commits no settings");

    await client.profiles.imports.apply("default", reviewed.digest, { hostedProviders: ["anthropic"], localEndpoints: ["generated-gateway"], modelPreferences: true, skillSources: ["generated-folder"] });
    await client.refresh();
    const imported = client.settings.get()!.values, targetVault = models.get(profile.id)!;
    assert.deepEqual(imported.hostedProviders, ["anthropic"]);
    assert.deepEqual(imported.localModels.map((value) => value.id), ["generated-gateway"]);
    assert.deepEqual(imported.modelPreferences?.disabledModels, ["generated-disabled"]);
    assert.deepEqual(imported.skillSources?.map((value) => value.id), ["generated-folder"]);
    assert.deepEqual(JSON.parse(targetVault.get(hostedSecretId("anthropic"))!), { type: "api_key", key: anthropicKey }, "the key gets its own slot in this profile");
    assert.ok([...targetVault.values()].includes(endpointToken));
    assert.equal(targetVault.has(hostedSecretId("openrouter")), false, "sign-ins are never cloned");
    assert.deepEqual([...sourceVault], sourceSecrets, "the source profile's secrets are unchanged");
    await source.refresh(); assert.equal(source.settings.get()!.revision, sourceRevision, "the source profile's settings are unchanged");

    const again = await client.profiles.imports.preview("default");
    assert.notEqual(again.digest, reviewed.digest);
    assert.equal(again.preview.hostedProviders.find((value) => value.providerId === "anthropic")?.configured, true);
    await assert.rejects(() => client.profiles.imports.apply("default", reviewed.digest, { skillSources: ["generated-folder"] }), { code: "profile_import_stale" });
    await assert.rejects(() => client.profiles.imports.apply("default", again.digest, { skillSources: ["generated-folder"] }), /already a skill source/);
    await assert.rejects(() => client.profiles.imports.repositories("default", reviewed.digest, [again.preview.repositories[0]!.projectId]), { code: "profile_import_stale" });
    const { registered } = await client.profiles.imports.repositories("default", again.digest, [again.preview.repositories[0]!.projectId]);
    assert.deepEqual(registered, [again.preview.repositories[0]!.path]);
    assert.equal((await client.profiles.imports.preview("default")).preview.repositories[0]!.registered, true, "repositories register the same folder");

    for (const value of fixture.clients) value.disconnect();
    await fixture.service.close();
    restarted = await startService(fixture.options);
    const reopened = await new MoguriSdk(restarted.connection, undefined, profile.id).ready();
    try {
      const values = reopened.settings.get()!.values;
      assert.deepEqual([values.hostedProviders, values.localModels.map((value) => value.id), values.skillSources?.map((value) => value.id)], [["anthropic"], ["generated-gateway"], ["generated-folder"]]);
      assert.equal(reopened.getState().snapshot!.projects.some((project) => project.path.endsWith("generated-repository")), true);
    } finally { reopened.disconnect(); }
  } finally {
    if (restarted) { await restarted.close(); fixture.service.close = async () => {}; }
    await fixture.close();
  }
});
