import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { generatedRepository, generatedGit as git } from "./fixtures/git.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { startService } from "../apps/service/src/server.ts";
import { assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";
import { generatedRepositoryMetadata as metadata } from "./fixtures/repository-info.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { ciTime } from "./fixtures/time-scale.ts";
test("verified repository snapshots bind future actual model/tool attribution while origin/license changes never rewrite old charges", { skip: process.platform !== "darwin" }, async () => {
  let license = "MIT", lookups = 0;
  const fixture = await setupFixture({ platform: { integrations: { fetch: async (url, init) => {
    lookups++; assert.equal(String(url), "https://api.github.com/repos/generated/example"); assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json(metadata(license));
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "git@github.com:generated/example.git");
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    assert.equal(preview.repository, "https://github.com/generated/example"); assert.equal(preview.lookupBoundary, "control-plane-public"); assert.equal(lookups, 0);
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "completed"); assert.equal(lookups, 1);
    const observation = (await sdk.repositories.state(fixture.sessionId)).observation!;
    assert.equal(observation.repository?.publicOsiLicensed, true); assert.equal(observation.repository?.ownerKind, "organization");
    await fixture.configure(); await fixture.send("generated tool repository attribution"); await fixture.terminal();
    const before = await sdk.budgets.calls({ sessionId: fixture.sessionId });
    assert.equal(before.calls.length, 2); assert.ok(before.calls.every((call) => call.repository?.fullName === "generated/example"));
    assert.ok(before.calls.every((call) => call.repository?.observationId === observation.id)); assert.equal(lookups, 1);
    const tools = await sdk.telemetry.operations({ sessionId: fixture.sessionId });
    assert.equal(tools.totals.completed, 1); assert.equal(tools.entries[0]?.repository?.fullName, "generated/example");
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools.find((tool) => tool.name === "grep_logs")!;
    const external = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "generated" }, tool.digest);
    assert.equal((await sdk.jobs.wait(external.id!)).status, "completed");
    assert.equal((await sdk.telemetry.operations({ actor: "external", repositoryId: 42 })).totals.completed, 1);
    assert.equal(fixture.requests.length, 2);
    assert.equal(JSON.stringify(before).includes("GENERATED_PRIVATE_METADATA_SENTINEL"), false); assert.equal(JSON.stringify(before).includes("generated-private-credential"), false);
    await git(fixture.project, "remote", "set-url", "origin", "https://github.com/generated/different.git");
    await fixture.send("Generated different observed origin."); await fixture.terminal();
    const changed = await sdk.budgets.calls({ sessionId: fixture.sessionId });
    assert.equal(changed.calls.length, 3); assert.equal(changed.calls[0]?.repository, null); assert.equal(changed.calls[0]?.repositoryDiagnostic, "repository-changed");
    assert.equal(changed.calls.filter((call) => call.repository?.publicOsiLicensed).length, 2); assert.equal(lookups, 1);
    await git(fixture.project, "remote", "set-url", "origin", "https://github.com/generated/example.git");
    license = "BUSL-1.1";
    const current = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const updated = await sdk.repositories.refresh(fixture.sessionId, current.bindingDigest, current.revision, true);
    assert.equal((await sdk.jobs.wait(updated.id!)).status, "completed");
    await fixture.send("Generated current non-OSI metadata."); await fixture.terminal();
    const all = await sdk.budgets.dashboard({ sessionId: fixture.sessionId }), open = await sdk.budgets.dashboard({ sessionId: fixture.sessionId, visibility: "open-source" });
    assert.equal(all.totals.calls, 4); assert.equal(open.totals.calls, 2); assert.equal(open.repositoryCoverage.unattributedCalls, 1);
    assert.equal((await sdk.budgets.dashboard({ organization: "generated", repositoryId: 42 })).totals.calls, 3);
    assert.equal((await sdk.budgets.dashboard()).totals.calls, 4); assert.equal(lookups, 2);
    await sdk.refresh(); await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal((await sdk.budgets.dashboard({ repositoryId: 42 })).totals.calls, 3);
    assert.equal((await sdk.telemetry.operations({ repositoryId: 42 })).totals.completed, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a repository refresh that loses its reviewed root or is cancelled cannot publish metadata or dispatch a model", { skip: process.platform !== "darwin" }, async () => {
  let release = () => {}, held = false;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => { held = true; await barrier; return Response.json(metadata()); } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    await waitFor(() => held);
    await git(fixture.project, "remote", "set-url", "origin", "https://github.com/generated/changed.git"); release();
    assert.notEqual((await sdk.jobs.wait(refresh.id!)).status, "completed");
    assert.equal((await sdk.repositories.state(fixture.sessionId)).observation, null);
    assert.equal(fixture.requests.length, 0);
    await assert.rejects(() => sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true), /changed|binding/i);
  } finally { release(); sdk.disconnect(); await fixture.close(); }
});

test("a public repository with unknown license stays attributable while open-source filtering discloses the unverified category", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => Response.json({ ...metadata(), license: { spdx_id: null } }) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "completed");
    await fixture.configure(); await fixture.send("Generated public repository with unknown license."); await fixture.terminal();
    const all = await sdk.budgets.dashboard(), filtered = await sdk.budgets.dashboard({ visibility: "open-source" });
    assert.equal(all.totals.calls, 1); assert.equal(filtered.totals.calls, 0);
    assert.equal(filtered.repositoryCoverage.attributedCalls, 1); assert.equal(filtered.repositoryCoverage.unverifiedLicenseCalls, 1);
    assert.equal((await sdk.budgets.calls()).calls[0]?.repository?.publicOsiLicensed, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("exact refresh cancellation before publication retains no metadata and adds no model work", async () => {
  let release = () => {}, held = false;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => { held = true; await barrier; return Response.json(metadata()); } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    await waitFor(() => held); await sdk.jobs.cancel(refresh.id!); release();
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "cancelled");
    assert.equal((await sdk.repositories.state(fixture.sessionId)).observation, null);
    assert.equal(fixture.requests.length, 0);
  } finally { release(); sdk.disconnect(); await fixture.close(); }
});

test("a stop observed after metadata retention is partial, never a successful refresh or an implicit rollback", async (t) => {
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => Response.json(metadata()) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const commit = fixture.service.store.commit.bind(fixture.service.store);
    t.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      const result = commit(...args);
      const publication = args[0].find((event) => event.event_type === "repository.recorded" && event.payload.observation.jobId);
      if (publication?.event_type === "repository.recorded") void fixture.service.controller.platform.execute({ type: "job.cancel", jobId: publication.payload.observation.jobId! }, () => ({}));
      return result;
    });
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "partial");
    assert.equal((await sdk.repositories.state(fixture.sessionId)).observation?.repository?.fullName, "generated/example");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("private metadata uses only explicitly selected local GitHub CLI access, not Copilot or public-lookup credentials", async () => {
  let generatedGh: string | undefined;
  const fixture = await setupFixture({ platform: { integrations: {
    fetch: async () => { throw new Error("Generated public lookup must not run"); },
    program: async (executable, args, options) => {
      assert.equal(executable, "gh");
      if (!generatedGh) throw new Error("The exact generated GitHub CLI has not been prepared. Personal authentication is forbidden.");
      return runProgram(generatedGh, args, options);
    },
  } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const bin = join(fixture.directory, "generated-gh-bin"); await mkdir(bin);
    const output = JSON.stringify(metadata()).replace('"private":false', '"private":true').replace('"visibility":"public"', '"visibility":"private"');
    await writeFile(join(bin, "gh"), `#!/bin/sh\nprintf '%s' '${output}'\n`, { mode: 0o700 });
    generatedGh = join(bin, "gh");
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    assert.equal(preview.lookupBoundary, "control-plane-gh-cli");
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "completed");
    assert.equal((await sdk.repositories.state(fixture.sessionId)).observation?.repository?.visibility, "private");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("actual SSH attribution observes the remote origin, rejects host CLI fallback and records real remote model provenance", { skip: process.platform !== "darwin", timeout: ciTime(25_000) }, async () => {
  const fixture = await remoteFixture({ platform: { integrations: { fetch: async () => Response.json(metadata()) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const host = initializeGeneratedRepository(fixture.project), remote = initializeGeneratedRepository(fixture.workspace);
    host(["remote", "add", "origin", "https://github.com/generated/host.git"]); remote(["remote", "add", "origin", "git@github.com:generated/example.git"]);
    await fixture.probe(); await fixture.select();
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    assert.equal(preview.env, "Remote"); assert.equal(preview.repository, "https://github.com/generated/example"); assert.equal(preview.root, fixture.workspace);
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "completed");
    await fixture.send("Generated attributed remote answer."); await fixture.terminal();
    const calls = (await sdk.budgets.calls({ sessionId: fixture.sessionId })).calls;
    assert.equal(calls[0]?.env, "Remote"); assert.equal(calls[0]?.repository?.fullName, "generated/example");
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(configuration.projectId, { ...configuration.values, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
    const authenticated = (await sdk.repositories.preview(fixture.sessionId)).preview;
    assert.equal(authenticated.lookupBoundary, "remote-gh-cli");
    assert.equal(authenticated.remote?.root, fixture.workspace);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("legacy repository gaps and independently retained attribution survive schema-21 upgrade/restart without retroactive backfill", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ legacyTurnCheckpointJournal: true, workerPath: fileURLToPath(new URL("./fixtures/legacy-worker-83.ts", import.meta.url)), platform: { integrations: { fetch: async () => Response.json(metadata()) } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    await fixture.configure(); await fixture.send("Generated older unassigned call."); await fixture.terminal();
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview, refreshed = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refreshed.id!)).status, "completed");
    await fixture.send("Generated newly attributed call."); await fixture.terminal();
    const before = (await sdk.budgets.calls()).calls; assert.equal(before.filter((call) => call.repository).length, 1);
    sdk.disconnect(); await writeLegacyState(fixture.service, 21);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try {
      assertCurrentSchema(restarted.store);
      const after = await peer.budgets.calls(); assert.deepEqual(after.calls, before);
      assert.equal(after.repositoryCoverage.unattributedCalls, 1); assert.equal(after.repositoryCoverage.attributedCalls, 1);
      const state = (await peer.repositories.state(fixture.sessionId)).observation;
      assert.ok(state); await peer.repositories.clear(fixture.sessionId, state.revision, true);
      assert.equal((await peer.repositories.state(fixture.sessionId)).observation, null);
      assert.equal((await peer.budgets.dashboard({ repositoryId: 42 })).totals.calls, 1); assert.equal(fixture.requests.length, 2);
    } finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("actual Single classifier and solver retain their own repository/role snapshots without another metadata lookup", { skip: process.platform !== "darwin" }, async () => {
  let lookups = 0;
  const fixture = await routedFixture({ platform: { integrations: { fetch: async () => { lookups++; return Response.json(metadata()); } } } });
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const preview = (await fixture.sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await fixture.sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await fixture.sdk.jobs.wait(refresh.id!)).status, "completed");
    await fixture.select(); await fixture.send("Generated repository-attributed routed task."); await fixture.terminal();
    const calls = (await fixture.sdk.budgets.calls({ sessionId: fixture.sessionId, repositoryId: 42 })).calls;
    assert.deepEqual(calls.map((call) => call.role).sort(), ["router", "solver"]);
    assert.ok(calls.every((call) => call.repository?.publicOsiLicensed === true));
    assert.equal(lookups, 1); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
  } finally { await fixture.close(); }
});

test("compaction, side and optional tool-less child roles capture real repository provenance through the same owner ledger", { skip: process.platform !== "darwin" }, async () => {
  let lookups = 0;
  const fixture = await setupFixture({ maxOutputTokens: 128, replyText: "Generated bounded retained summary.", platform: { integrations: { fetch: async () => { lookups++; return Response.json(metadata()); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await generatedRepository(fixture.project); await git(fixture.project, "remote", "add", "origin", "https://github.com/generated/example.git");
    const preview = (await sdk.repositories.preview(fixture.sessionId)).preview;
    const refresh = await sdk.repositories.refresh(fixture.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await sdk.jobs.wait(refresh.id!)).status, "completed");
    const settings = structuredClone(sdk.settings.get()!.values); settings.subagents.enabled = true;
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await fixture.configure();
    for (let index = 0; index < 3; index++) { await fixture.send(`Generated retained attributed role turn ${index}. ` + "Generated context retained for a bounded compactor. ".repeat(100)); await fixture.terminal(); }
    const compact = (await sdk.compactions.preview(fixture.sessionId, { keepRecentTurns: 1 })).preview;
    const request = await sdk.compactions.generate(fixture.sessionId, compact, true);
    await waitFor(() => fixture.service.controller.snapshot().compactions.some((entry) => entry.id === request.id && entry.status !== "running"));
    assert.equal((await sdk.compactions.read(fixture.sessionId, request.id!)).compaction.status, "proposed");
    const side = await sdk.sessions.spawn(fixture.sessionId, "side", "Generated attributed side");
    await sdk.command({ type: "draft.save", sessionId: side.id!, expectedRevision: 0, text: "Generated attributed side answer.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: side.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.status === "completed");
    const child = await sdk.subagents.run(fixture.sessionId, "Generated attributed tool-less child.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)?.status === "completed");
    for (const role of ["compaction", "side", "subagent"] as const) {
      const calls = (await sdk.budgets.calls({ role, repositoryId: 42 })).calls;
      assert.equal(calls.length, 1); assert.equal(calls[0]?.repository?.fullName, "generated/example");
    }
    assert.equal(lookups, 1); assert.equal(fixture.requests.length, 6);
  } finally { sdk.disconnect(); await fixture.close(); }
});
