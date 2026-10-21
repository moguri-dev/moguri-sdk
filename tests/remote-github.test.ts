import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { remoteGithubFixture as setup } from "./fixtures/remote-github-service.ts";
import { generatedRepositoryMetadata } from "./fixtures/repository-info.ts";
import { waitFor } from "./fixture.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";

function ready(path: string) {
  return waitFor(() => { try { return Number(readFileSync(path, "utf8")); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; } });
}

test("reviewed provider-free Remote repository metadata uses the exact SSH account/root and retains its real lookup provenance", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await setup();
  try {
    const preview = (await f.sdk.repositories.preview(f.sessionId)).preview;
    assert.equal(preview.lookupBoundary, "remote-gh-cli"); assert.equal(preview.repository, "https://github.com/generated/example");
    assert.equal(preview.remote?.host, f.github.target.host); assert.equal(preview.remote?.port, f.github.target.port);
    assert.equal(preview.remote?.root, f.workspace); assert.equal(f.session().controls.modelId, null);
    assert.throws(() => readFileSync(f.github.calls, "utf8"), { code: "ENOENT" });
    const refresh = await f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await f.sdk.jobs.wait(refresh.id!)).status, "completed");
    const observation = (await f.sdk.repositories.state(f.sessionId)).observation!;
    assert.equal(observation.lookupBoundary, "remote-gh-cli"); assert.equal(observation.repository?.visibility, "private");
    assert.deepEqual(observation.remote, preview.remote);
    const calls = await f.github.records(); assert.equal(calls.length, 1); assert.equal(calls[0]!.home, f.github.home); assert.equal(calls[0]!.cwd, f.workspace);
    assert.deepEqual(calls[0]!.args, ["api", "--hostname", "github.com", "--method", "GET", "repos/generated/example"]);
    assert.throws(() => readFileSync(f.controllerGithub.marker, "utf8"), { code: "ENOENT" });
    assert.equal(JSON.stringify(f.service.store.events()).includes("GENERATED_PRIVATE_METADATA_SENTINEL"), false);
    assert.equal(JSON.stringify(f.service.store.events()).includes("generated-private-credential"), false);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("Remote CLI errors, malformed/mismatched responses and missing tools cannot become retained facts or another account", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const f = await setup();
  try {
    for (const mode of ["error", "malformed", "oversize", "success"] as const) {
      await f.github.configure(mode, { ...generatedRepositoryMetadata(), full_name: "generated/different" });
      const preview = (await f.sdk.repositories.preview(f.sessionId)).preview;
      const refresh = await f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true), job = await f.sdk.jobs.wait(refresh.id!);
      assert.notEqual(job.status, "completed"); assert.equal((await f.sdk.repositories.state(f.sessionId)).observation, null);
      assert.equal(JSON.stringify(job).includes("GENERATED_GH_PRIVATE_DIAGNOSTIC"), false);
    }
    await rename(join(f.github.bin, "gh"), join(f.github.bin, "gh-disabled"));
    const preview = (await f.sdk.repositories.preview(f.sessionId)).preview, refresh = await f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true);
    const missing = await f.sdk.jobs.wait(refresh.id!);
    assert.equal(missing.status, "failed"); assert.match(missing.error!, /unavailable.*selected execution host/i);
    assert.equal((await f.github.records()).length, 4); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a held Remote metadata result cannot cross changed env authority, and source review is never implicit account authorization", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await setup();
  try {
    await f.github.configure("gate");
    const preview = (await f.sdk.repositories.preview(f.sessionId)).preview, refresh = await f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true);
    await ready(f.github.ready); await f.sdk.sessions.env(f.sessionId, "Local"); await f.github.release();
    assert.notEqual((await f.sdk.jobs.wait(refresh.id!)).status, "completed");
    assert.equal(f.controller.snapshot().repositoryObservations.length, 0);
    await assert.rejects(() => f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true), /binding|changed/i);
    assert.equal((await f.github.records()).length, 1); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("stopping an admitted Remote metadata read retains unknown cleanup as partial and never replays the gh attempt", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await setup();
  try {
    await f.github.configure("hold");
    const preview = (await f.sdk.repositories.preview(f.sessionId)).preview, refresh = await f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true);
    const pid = await ready(f.github.ready); await f.sdk.jobs.cancel(refresh.id!);
    const job = await f.sdk.jobs.wait(refresh.id!); assert.equal(job.status, "partial"); assert.match(job.error!, /unconfirmed|partial/i);
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; } }, 8000);
    assert.equal((await f.sdk.repositories.state(f.sessionId)).observation, null);
    assert.equal((await f.github.records()).length, 1); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("concurrent refreshes admit one CLI request and a foreign profile never sees its private observation or source", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await setup();
  try {
    await f.github.configure("gate");
    const preview = (await f.sdk.repositories.preview(f.sessionId)).preview;
    const attempts = await Promise.allSettled([0, 1].map(() => f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true)));
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled"), rejected = attempts.find((attempt) => attempt.status === "rejected");
    assert.ok(accepted?.status === "fulfilled" && rejected?.status === "rejected");
    assert.match(String(rejected.reason), /pending|already owns/i);
    await ready(f.github.ready); await f.github.release();
    assert.equal((await f.sdk.jobs.wait(accepted.value.id!)).status, "completed");
    const profile = await f.sdk.profiles.create("Generated private metadata peer"); await f.sdk.profiles.wait(profile.id!);
    const peer = await new MoguriSdk(f.service.connection, undefined, profile.id!).ready();
    try {
      assert.equal(peer.getState().snapshot!.repositoryObservations.length, 0);
      await assert.rejects(() => peer.repositories.preview(f.sessionId), /profile|session/i);
      assert.equal(JSON.stringify(peer.getState().snapshot).includes(f.workspace), false);
    } finally { peer.disconnect(); }
    assert.equal((await f.github.records()).length, 1); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("actual Remote model admission uses the privately observed repository without another authenticated lookup or retroactive attribution", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await setup({ exposeModels: true });
  try {
    const preview = (await f.sdk.repositories.preview(f.sessionId)).preview, refresh = await f.sdk.repositories.refresh(f.sessionId, preview.bindingDigest, preview.revision, true);
    assert.equal((await f.sdk.jobs.wait(refresh.id!)).status, "completed");
    await f.select(); await f.send("Generated private repository accounting."); await f.terminal();
    const calls = (await f.sdk.budgets.calls({ sessionId: f.sessionId })).calls;
    assert.equal(calls.length, 1); assert.equal(calls[0]!.env, "Remote"); assert.equal(calls[0]!.repository?.visibility, "private");
    assert.equal(calls[0]!.repository?.fullName, "generated/example"); assert.equal(calls[0]!.repository?.publicOsiLicensed, false);
    assert.equal((await f.github.records()).length, 1); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
