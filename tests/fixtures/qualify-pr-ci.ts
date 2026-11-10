import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { forkOwnedFixture } from "./owned-child.ts";

export async function qualifyPrCi(packageRoot: string) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-pr-ci-")), root = join(directory, "checkout");
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args: string[]) => execFileSync("git", ["--no-pager", ...args], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let owner: ReturnType<typeof forkOwnedFixture> | undefined, sdk: MoguriSdk | undefined;
  let safe = true;
  try {
    await mkdir(root); git(["init", "--initial-branch=main"]); git(["config", "user.name", "Generated CI recovery"]);
    git(["config", "user.email", "generated@example.invalid"]); git(["config", "commit.gpgSign", "false"]);
    await writeFile(join(root, "fixture.txt"), "Generated CI fixture.\n"); git(["add", "--", "fixture.txt"]); git(["commit", "--no-gpg-sign", "-m", "Generated CI base"]);
    git(["remote", "add", "origin", "git@github.com:generated-owner/fixture.git"]);
    const head = git(["rev-parse", "HEAD"]);
    await writeFile(join(directory, "control.json"), JSON.stringify({ head, state: "running" }));
    await writeFile(join(directory, "requests.log"), "");
    const installed: typeof import("../../packages/sdk/src/index.ts") = await import(pathToFileURL(join(packageRoot, "dist", "sdk", "index.mjs")).href);
    const begin = async () => {
      owner = forkOwnedFixture(resolve("tests/fixtures/pr-ci-child.ts"));
      const connection = await owner.ready({ directory, packageRoot }, { timeoutMs: 15000 });
      if (!installed.isRecord(connection) || connection.protocolVersion !== installed.PROTOCOL_VERSION ||
        typeof connection.baseUrl !== "string" || typeof connection.wsUrl !== "string" || typeof connection.token !== "string" ||
        typeof connection.pid !== "number" || !Number.isSafeInteger(connection.pid) || connection.pid < 1) {
        throw new Error("The actual generated CI child returned no valid authenticated connection.");
      }
      sdk = await new installed.MoguriSdk({ protocolVersion: connection.protocolVersion, baseUrl: connection.baseUrl,
        wsUrl: connection.wsUrl, token: connection.token, pid: connection.pid,
        ...(typeof connection.storeId === "string" ? { storeId: connection.storeId } : {}) }).ready();
      return sdk;
    };
    const first = await begin();
    const project = await first.command({ type: "project.add", path: root });
    const session = await first.sessions.create(project.id!, "Generated CI recovery", undefined, undefined, "checkout");
    const scope = { env: "Local" as const, projectId: project.id!, sessionId: session.id! };
    const source = { kind: "pull" as const, repository: "generated-owner/fixture", account: "generated-owner", accountId: "generated-owner:42", number: 11 };
    const review = await first.github.previewCi(scope, source, { timeoutMs: 10000, pollMs: 100 });
    const started = await first.github.execute(review, review.document.confirmations, true);
    const deadline = Date.now() + 5000;
    for (;;) {
      if ((await first.github.read(started.id!)).ciObservation?.state === "running") break;
      if (Date.now() >= deadline) throw new Error("Actual CI child produced no complete running observation.");
      await delay(10);
    }
    await owner!.stop(); owner = undefined; first.disconnect(); sdk = undefined;
    const readsBefore = (await readFile(join(directory, "requests.log"), "utf8")).split("\n").filter((path) => path.includes("/check-runs?")).length;
    await writeFile(join(directory, "control.json"), JSON.stringify({ head, state: "success" }));
    const reopened = await begin(), retained = await reopened.github.read(started.id!);
    assert.equal(retained.operation.status, "partial");
    assert.equal(retained.operation.ci?.cleanupUnconfirmed, true);
    assert.equal(retained.ciObservation?.state, "running");
    assert.equal(retained.ciObservation?.target.headSha, head);
    assert.equal((await readFile(join(directory, "requests.log"), "utf8")).split("\n").filter((path) => path.includes("/check-runs?")).length, readsBefore);
    const originalEvents = reopened.getState().events;
    assert.equal(originalEvents.some((event) => event.event_type === "model.started"), false);
    const fresh = await reopened.github.previewCi(scope, source, { timeoutMs: 1000, pollMs: 50 });
    assert.ok(fresh.document.confirmations.some((text) => text.includes(started.id!)));
    const restarted = await reopened.github.execute(fresh, fresh.document.confirmations, true);
    assert.notEqual(restarted.id, started.id);
    assert.equal((await reopened.github.wait(restarted.id!, { timeoutMs: 5000 })).result?.ci?.state, "success");
    assert.equal((await reopened.github.read(started.id!)).operation.status, "partial");
    assert.equal(reopened.getState().events.some((event) => event.event_type === "model.started"), false);
    return { protocol: installed.PROTOCOL_VERSION, retainedWatchId: started.id, independentWatchId: restarted.id, actualControllerSigkill: true, paidInference: false };
  } finally {
    sdk?.disconnect();
    if (owner) try { await owner.stop(); } catch (error) { safe = false; throw error; }
    if (safe) await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await qualifyPrCi(resolve(process.argv[2] ?? "."))));
}
