import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { forkOwnedFixture } from "./owned-child.ts";
import { ciTime } from "./time-scale.ts";

export async function qualifyMyWork(packageRoot: string) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-my-work-recovery-")), root = join(directory, "checkout");
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args: string[]) => execFileSync("git", ["--no-pager", ...args], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let owner: ReturnType<typeof forkOwnedFixture> | undefined, sdk: MoguriSdk | undefined, safe = true;
  try {
    await mkdir(root); git(["init", "--initial-branch=main"]); git(["config", "user.name", "Generated inbox recovery"]);
    git(["config", "user.email", "generated@example.invalid"]); git(["config", "commit.gpgSign", "false"]);
    await writeFile(join(root, "fixture.txt"), "Generated inbox recovery.\n"); git(["add", "--", "fixture.txt"]); git(["commit", "--no-gpg-sign", "-m", "Generated inbox base"]);
    git(["remote", "add", "origin", "git@github.com:generated-owner/fixture.git"]); const head = git(["rev-parse", "HEAD"]);
    await writeFile(join(directory, "control.json"), JSON.stringify({ head, state: "running", blockInbox: true }));
    await writeFile(join(directory, "requests.log"), "");
    const installed: typeof import("../../packages/sdk/src/index.ts") = await import(pathToFileURL(join(packageRoot, "dist", "sdk", "index.mjs")).href);
    const begin = async () => {
      owner = forkOwnedFixture(resolve("tests/fixtures/pr-ci-child.ts"));
      const connection = await owner.ready({ directory, packageRoot, kind: "my-work" }, { timeoutMs: 15000 });
      if (!installed.isRecord(connection) || connection.protocolVersion !== installed.PROTOCOL_VERSION ||
        typeof connection.baseUrl !== "string" || typeof connection.wsUrl !== "string" || typeof connection.token !== "string" ||
        typeof connection.pid !== "number" || !Number.isSafeInteger(connection.pid) || connection.pid < 1) throw new Error("Generated inbox controller has no actual authenticated connection.");
      sdk = await new installed.MoguriSdk({ protocolVersion: connection.protocolVersion, baseUrl: connection.baseUrl, wsUrl: connection.wsUrl,
        token: connection.token, pid: connection.pid, ...(typeof connection.storeId === "string" ? { storeId: connection.storeId } : {}) }).ready();
      return sdk;
    };
    const first = await begin(), project = await first.projects.add(root);
    await first.sessions.create(project.id!, "Generated inbox recovery session", undefined, undefined, "checkout");
    const review = await first.myWork.previewSource({ env: "Local", projectId: project.id! });
    const source = await first.myWork.configure(review.preview, true), refresh = await first.myWork.refresh();
    const deadline = Date.now() + ciTime(5000);
    for (;;) {
      if ((await first.myWork.read(refresh.id!, { metadataOnly: true })).refresh.sources[0]?.observationDigest) break;
      if (Date.now() >= deadline) throw new Error("Generated inbox controller did not retain its first real page before dispatch interruption.");
      await delay(10);
    }
    await owner!.stop(); owner = undefined; first.disconnect(); sdk = undefined;
    const originalReads = await readFile(join(directory, "requests.log"), "utf8");
    await writeFile(join(directory, "control.json"), JSON.stringify({ head, state: "success", blockInbox: false }));
    const reopened = await begin(), retained = await reopened.myWork.read(refresh.id!);
    assert.equal(retained.refresh.status, "partial"); assert.equal(retained.refresh.cleanupUnconfirmed, true);
    assert.equal(retained.observations[0]!.pulls[0]!.item.headSha, head);
    const inbox = await reopened.myWork.query();
    assert.equal(inbox.entries.length, 1); assert.equal(inbox.entries[0]!.freshness, "partial");
    assert.equal(await readFile(join(directory, "requests.log"), "utf8"), originalReads);
    await assert.rejects(reopened.myWork.refresh(), /Inspect original partial refresh/);
    await reopened.myWork.inspect(refresh.id!, retained.refresh.revision, retained.refresh.inputDigest, true);
    const independent = await reopened.myWork.refresh([source.id!]), final = await reopened.myWork.wait(independent.id!, { timeoutMs: 5000 });
    assert.equal(final.refresh.status, "completed"); assert.notEqual(independent.id, refresh.id);
    assert.equal((await reopened.myWork.read(refresh.id!)).refresh.status, "partial");
    assert.equal((await reopened.myWork.query()).entries[0]!.pull.ci?.state, "success");
    assert.equal(reopened.getState().events.some((event) => event.event_type === "model.started"), false);
    return { protocol: installed.PROTOCOL_VERSION, originalRefreshId: refresh.id, independentRefreshId: independent.id,
      actualControllerSigkill: true, replayedReads: 0, paidInference: false };
  } finally {
    sdk?.disconnect();
    if (owner) try { await owner.stop(); } catch (error) { safe = false; throw error; }
    if (safe) await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await qualifyMyWork(resolve(process.argv[2] ?? "."))));
