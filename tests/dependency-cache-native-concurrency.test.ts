import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { nativeDependencyFixtures } from "./fixtures/native-dependencies.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("native cache publication serializes concurrent plans and cancels pending work without source-build fallback", { timeout: ciTime(30_000) }, async () => {
  let data: Awaited<ReturnType<typeof nativeDependencyFixtures>>, mode: "ready" | "hold" | "sdist" = "ready", downloads = 0, aborted = false;
  const release: (() => void)[] = [];
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url, init) => {
    if (String(url).includes("api.osv.dev")) return Response.json({ results: [{}] });
    if (String(url).includes("pypi.org/pypi/")) return Response.json({ info: { name: data.python.name, version: data.python.version }, urls: [{ filename: mode === "sdist" ? "generated-source.tar.gz" : data.python.filename, url: `https://files.pythonhosted.org/generated/${data.python.filename}`, packagetype: mode === "sdist" ? "sdist" : "bdist_wheel", digests: { sha256: data.python.sha256 } }] });
    assert.equal(String(url), `https://files.pythonhosted.org/generated/${data.python.filename}`);
    downloads++;
    if (mode === "hold") return new Promise<Response>((resolve, reject) => {
      release.push(() => resolve(new Response(new Uint8Array(data.python.bytes))));
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("Generated native cache cancellation")); }, { once: true });
    });
    return new Response(new Uint8Array(data.python.bytes));
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    data = await nativeDependencyFixtures(join(fixture.directory, "native-sources"));
    await writeFile(join(fixture.project, "requirements.txt"), `${data.python.name}==${data.python.version} --hash=sha256:${data.python.sha256}\n`);
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "python");
    mode = "hold";
    const first = await sdk.cache.prepare(plan.projectId, "python", plan.digest, true), second = await sdk.cache.prepare(plan.projectId, "python", plan.digest, true);
    await waitFor(() => release.length === 2);
    for (const done of release.splice(0)) done();
    const results = await Promise.all([sdk.jobs.wait(first.id!), sdk.jobs.wait(second.id!)]);
    assert.ok(results.every((result) => result.status === "completed"), results.map((result) => result.error).join("\n"));
    const retained = sdk.getState().snapshot!.dependencyCaches.find((receipt) => receipt.manager === "python")!;
    await rm(join(fixture.directory, "state/dependency-cache/native-archives"), { recursive: true, force: true });
    const cancelled = await sdk.cache.prepare(plan.projectId, "python", plan.digest, true);
    await waitFor(() => release.length === 1);
    await sdk.jobs.cancel(cancelled.id!);
    assert.equal((await sdk.jobs.wait(cancelled.id!)).status, "cancelled"); assert.equal(aborted, true);
    assert.equal(sdk.getState().snapshot!.dependencyCaches.find((receipt) => receipt.manager === "python")?.checkedAt, retained.checkedAt);
    assert.equal(downloads, 3);
    assert.deepEqual(await readdir(join(fixture.directory, "state/dependency-cache/native-runtime")), []);
    mode = "sdist";
    const source = await sdk.cache.prepare(plan.projectId, "python", plan.digest, true);
    assert.match((await sdk.jobs.wait(source.id!)).error!, /binary-wheel.*Sandbox|Source distributions/);
    assert.equal(downloads, 3);
  } finally { for (const done of release) done(); sdk.disconnect(); await fixture.close(); }
});
