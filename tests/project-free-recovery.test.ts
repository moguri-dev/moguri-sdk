import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { automaticHome, fixtureProvider, GENERATED_RETENTION_KEY, homeCommand, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual control-plane SIGKILL and source deletion preserve an independently owned Home quarantine without execution or model replay", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-home-recovery-")), home = join(directory, "home"), stateDir = join(directory, "state");
  await mkdir(home);
  const provider = await fixtureProvider();
  const runtime = await launchRuntimeChild({ stateDir, homeRoot: home, vaultPath: join(directory, "generated-vault.json"), modelId: provider.modelId, baseUrl: provider.baseUrl });
  let sdk: MoguriSdk | undefined = await new MoguriSdk(runtime.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const source = await automaticHome(sdk, "Generated original Home owner");
    const tool = (await sdk.tools.catalog(source, "run_command")).tools.find((tool) => tool.name === "run_command")!;
    const args = { command: "printf 'before\\n' > generated-crash-marker; sleep 1; printf 'after\\n' >> generated-crash-marker", timeoutMs: 5000 };
    const started = await sdk.tools.execute(source, tool.name, args, tool.schemaDigest);
    await waitFor(() => existsSync(join(home, "generated-crash-marker")));
    const original = sdk.getState().snapshot!.chatWriters.find((writer) => writer.sessionId === source)!;
    const job = sdk.getState().snapshot!.jobs.find((job) => job.id === started.id)!;
    assert.ok(original); assert.equal(original.status, "active"); assert.ok(job.toolingIntent);
    runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect(); sdk = undefined;
    restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
      platform: { terminal: { defaultRoot: home } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const recovered = sdk.getState().snapshot!.chatWriters.find((writer) => writer.id === original.id)!;
    assert.equal(recovered.status, "unconfirmed"); assert.deepEqual(recovered.root, original.root);
    assert.equal(recovered.sessionId, source); assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === source)?.status, "partial");
    await assert.rejects(() => sdk!.workspaces.acknowledgeHomeWriter(source, recovered.id, recovered.revision + 1, true), /exact retained Home writer/);
    restarted.store.db.prepare("DELETE FROM receipts WHERE profile_id='default' AND id=?").run(job.toolingIntent!.id);
    await assert.rejects(() => sdk!.command({ type: "tooling.execute", sessionId: source, name: tool.name, arguments: args, schemaDigest: tool.schemaDigest }, job.toolingIntent!.id), /already.*retained intent|already.*intent/i);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const marker = await readFile(join(home, "generated-crash-marker"), "utf8");
    assert.equal(marker.split("before").length - 1, 1); assert.ok(marker.split("after").length - 1 <= 1);
    await sdk.command({ type: "session.resume", sessionId: source });
    assert.equal(sdk.getState().snapshot!.chatWriters.find((writer) => writer.id === original.id)?.status, "unconfirmed");
    await sdk.sessions.delete(source, true);
    assert.equal(sdk.getState().snapshot!.sessions.some((session) => session.id === source), false);
    const inspector = await automaticHome(sdk, "Generated independent Home inspection");
    const blocked = await homeCommand(sdk, inspector, "printf GENERATED_MUST_NOT_RUN > generated-forbidden");
    await waitFor(() => restarted!.controller.snapshot().jobs.find((job) => job.id === blocked.id && job.status === "failed"));
    assert.equal(existsSync(join(home, "generated-forbidden")), false);
    const retained = (await sdk.workspaces.home(inspector)).writers.find((writer) => writer.id === original.id)!;
    assert.equal(retained.status, "unconfirmed"); assert.equal(retained.sessionId, source);
    await sdk.workspaces.acknowledgeHomeWriter(inspector, retained.id, retained.revision, true);
    const accepted = sdk.getState().snapshot!.chatWriters.find((writer) => writer.id === original.id)!;
    assert.equal(accepted.status, "acknowledged"); assert.deepEqual(accepted.inspection, { sessionId: inspector, actor: "user" });
    assert.match(accepted.diagnostic!, /not proof/);
    await sdk.command({ type: "session.resume", sessionId: inspector });
    const resumed = await homeCommand(sdk, inspector, "pwd");
    await waitFor(() => restarted!.controller.snapshot().jobs.find((job) => job.id === resumed.id && job.status === "completed"));
    assert.equal(restarted.controller.snapshot().projects.length, 0);
    assert.equal(provider.requests.length, 0);
    assert.equal((await readFile(join(home, "generated-crash-marker"), "utf8")).split("before").length - 1, 1);
  } finally { sdk?.disconnect(); await runtime.stop(); await restarted?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test("an unloaded profile's retained Home writer blocks another profile without leaking its source or treating a new chat as cleanup", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const fixture = await profileFixture(), home = join(fixture.directory, "home");
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined, owner: MoguriSdk | undefined;
  try {
    const other = await fixture.create("Generated Home owner profile"), source = await automaticHome(other.client, "Generated private Home writer");
    await homeCommand(other.client, source, "printf generated > generated-profile-started; sleep 10", 12000);
    await waitFor(() => existsSync(join(home, "generated-profile-started")));
    await other.client.command({ type: "session.stop", sessionId: source });
    const original = await waitFor(() => other.client.getState().snapshot!.chatWriters.find((writer) => writer.sessionId === source && writer.status === "unconfirmed"));
    for (const client of fixture.clients) client.disconnect();
    await fixture.service.close();
    const loaded: string[] = [], provider = fixture.options.profiles.provider;
    restarted = await startService({ ...fixture.options, profiles: { ...fixture.options.profiles, provider: (id) => { loaded.push(id); return provider(id); } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    const current = await automaticHome(peer, "Generated different profile Home"), waiting = await homeCommand(peer, current, "printf forbidden > generated-profile-forbidden");
    await waitFor(() => restarted!.controller.snapshot().jobs.find((job) => job.id === waiting.id && job.status === "running"));
    assert.equal(existsSync(join(home, "generated-profile-forbidden")), false);
    assert.equal(peer.getState().snapshot!.chatWriters.length, 0);
    assert.equal(peer.getState().snapshot!.sessions.some((session) => session.id === source), false);
    assert.equal(loaded.includes(other.profile.id), false);
    await assert.rejects(() => peer!.workspaces.acknowledgeHomeWriter(current, original.id, original.revision, true), /exact retained Home writer/);
    await peer.command({ type: "session.stop", sessionId: current });
    assert.equal(restarted.controller.snapshot().jobs.find((job) => job.id === waiting.id)?.status, "cancelled");
    owner = await peer.profiles.open(other.profile.id);
    const inspect = await owner.sessions.create(null, "Generated actual owner inspection"), retained = (await owner.workspaces.home(inspect.id!)).writers.find((writer) => writer.id === original.id)!;
    assert.equal(retained.profileId, other.profile.id); assert.equal(retained.status, "unconfirmed");
    assert.equal(retained.root.root, await realpath(home));
    await owner.workspaces.acknowledgeHomeWriter(inspect.id!, retained.id, retained.revision, true);
    const allowed = await homeCommand(peer, current, "pwd");
    await waitFor(() => restarted!.controller.snapshot().jobs.find((job) => job.id === allowed.id && job.status === "completed"));
    assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { owner?.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});
