import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as cacache from "cacache";
import { DependencyCache } from "../apps/service/src/dependency-cache.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { nativeDependencyFixtures } from "./fixtures/native-dependencies.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("generated Python, Cargo and Go caches are consumed by native managers, reused and never built", { timeout: ciTime(60_000) }, async () => {
  let data: Awaited<ReturnType<typeof nativeDependencyFixtures>>, url = "", downloads = 0, audits = 0, advisory: unknown = {};
  const server = createServer((request, response) => {
    const path = request.url;
    if (path === `/pypi/${data.python.name}/${data.python.version}/json`) { response.end(JSON.stringify({ info: { name: data.python.name, version: data.python.version }, urls: [{ filename: data.python.filename, url: `${url}/wheels/${data.python.filename}`, packagetype: "bdist_wheel", digests: { sha256: data.python.sha256 } }] })); return; }
    if (path === `/wheels/${data.python.filename}`) { downloads++; response.end(data.python.bytes); return; }
    if (path === `/cargo/ge/ne/${data.cargo.name}`) { response.end(JSON.stringify({ name: data.cargo.name, vers: data.cargo.version, deps: [], cksum: data.cargo.sha256, features: {}, yanked: false }) + "\n"); return; }
    if (path === `/crates/${data.cargo.name}/${data.cargo.name}-${data.cargo.version}.crate`) { downloads++; response.end(data.cargo.bytes); return; }
    const go = `/go/${data.go.name}/@v/${data.go.version}`;
    if (path === `${go}.mod`) { downloads++; response.end(data.go.mod); return; }
    if (path === `${go}.info`) { downloads++; response.end(JSON.stringify({ Version: data.go.version, Time: "2026-01-01T00:00:00Z" })); return; }
    if (path === `${go}.zip`) { downloads++; response.end(data.go.bytes); return; }
    if (path === `/go/${data.go.name}/@v/v0.9.0.mod`) { downloads++; response.end(data.go.mod); return; }
    if (path === `/go/${data.go.name}/@v/v0.9.0.info`) { downloads++; response.end(JSON.stringify({ Version: "v0.9.0", Time: "2025-01-01T00:00:00Z" })); return; }
    if (path === `/go/${data.go.name}/@v/list`) { response.end(data.go.version + "\n"); return; }
    response.writeHead(404).end("Not a generated dependency.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string"); url = `http://127.0.0.1:${address.port}`;
  const fixture = await setupFixture({ platform: { cache: { allowLoopback: true, nativeSources: { pypi: url, pythonFiles: `${url}/wheels/`, cargoIndex: `${url}/cargo/`, cargoArchives: `${url}/crates/`, goProxy: `${url}/go/` },
    fetch: async (resource, init) => {
      if (String(resource).includes("api.osv.dev")) { audits++; const body = JSON.parse(String(init?.body)); return Response.json({ results: body.queries.map(() => advisory) }); }
      return fetch(resource, init);
    } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    data = await nativeDependencyFixtures(join(fixture.directory, "native-fixtures"));
    await writeFile(join(fixture.project, "requirements.txt"), `${data.python.name}==${data.python.version} --hash=sha256:${data.python.sha256}\n`);
    await writeFile(join(fixture.project, "Cargo.toml"), `[package]\nname="generated-consumer"\nversion="1.0.0"\nedition="2021"\n[dependencies]\n${data.cargo.name}="=${data.cargo.version}"\n`);
    await writeFile(join(fixture.project, "Cargo.lock"), `version = 4\n\n[[package]]\nname = "${data.cargo.name}"\nversion = "${data.cargo.version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${data.cargo.sha256}"\n\n[[package]]\nname = "generated-consumer"\nversion = "1.0.0"\ndependencies = ["${data.cargo.name}"]\n`);
    await mkdir(join(fixture.project, "src")); await writeFile(join(fixture.project, "src/lib.rs"), "pub fn generated() { panic!(\"No project build is authorized\"); }\n");
    await mkdir(join(fixture.directory, ".cargo")); await writeFile(join(fixture.directory, ".cargo/config.toml"), "GENERATED INVALID AMBIENT CARGO CONFIG MUST NEVER BE READ\n");
    await writeFile(join(fixture.project, "go.mod"), `module generated.invalid/consumer\n\ngo 1.20\n\nrequire ${data.go.name} ${data.go.version}\n`);
    const home = join(fixture.directory, "generated-home"); await mkdir(home);
    await promisify(execFile)("go", ["mod", "download", "-json", "all"], { cwd: fixture.project, env: { PATH: process.env.PATH, HOME: home, TMPDIR: fixture.directory, GOENV: "off", GOWORK: "off", GOTOOLCHAIN: "local", GOTELEMETRY: "off", GOFLAGS: "-modcacherw", GOPROXY: `${url}/go`, GOSUMDB: "off", GOMODCACHE: join(fixture.directory, "initial-modules"), GOPATH: join(home, "gopath"), GOCACHE: join(home, "go-cache") } });
    const sums = (await readFile(join(fixture.project, "go.sum"), "utf8")).trim().split("\n");
    const modSum = sums.map((line) => line.split(" ")).find((parts) => parts[1] === `${data.go.version}/go.mod`)?.[2]; assert.ok(modSum);
    await writeFile(join(fixture.project, "go.sum"), [...sums, `${data.go.name} v0.9.0/go.mod ${modSum}`].sort().join("\n") + "\n");
    downloads = 0;
    for (const manager of ["python", "cargo", "go"] as const) {
      const { plan } = await sdk.cache.inspect(fixture.session().projectId, manager);
      assert.equal(plan.mode, "cache-only"); assert.equal(plan.readiness?.ready, true, plan.readiness?.diagnostic ?? "");
      const first = await sdk.cache.prepare(plan.projectId, manager, plan.digest, true), result = await sdk.jobs.wait(first.id!);
      assert.equal(result.status, "completed", result.error ?? "");
      assert.ok(await readFile(join(plan.cachePath!, "reviewed-plan.json"), "utf8"));
      const env = { PATH: process.env.PATH, HOME: home, TMPDIR: fixture.directory, PIP_CONFIG_FILE: "/dev/null", GOENV: "off", GOWORK: "off", GOTOOLCHAIN: "local", GOTELEMETRY: "off", GOFLAGS: "", GOPROXY: "off", GOSUMDB: "off", GOMODCACHE: join(plan.cachePath!, "modules"), GOPATH: join(home, "gopath"), GOCACHE: join(home, "go-cache"), CARGO_HOME: join(plan.cachePath!, "cargo-home"), CARGO_NET_OFFLINE: "true" };
      if (manager === "python") await promisify(execFile)("python3", ["-I", "-m", "pip", "--isolated", "--disable-pip-version-check", "download", "--no-index", "--find-links", join(plan.cachePath!, "wheels"), "--only-binary=:all:", "--require-hashes", "--no-cache-dir", "--dest", join(fixture.directory, "offline-wheel-consumer"), "-r", join(fixture.project, "requirements.txt")], { cwd: fixture.project, env });
      else if (manager === "cargo") await promisify(execFile)("cargo", ["fetch", "--offline", "--locked", "--manifest-path", join(fixture.project, "Cargo.toml")], { cwd: "/", env });
      else await promisify(execFile)("go", ["mod", "download", "-json", "all"], { cwd: fixture.project, env });
      const before = downloads, second = await sdk.cache.prepare(plan.projectId, manager, plan.digest, true);
      const reused = await sdk.jobs.wait(second.id!);
      assert.equal(reused.status, "completed", reused.error ?? ""); assert.equal(downloads, before);
      assert.equal(sdk.getState().snapshot?.dependencyCaches.find((receipt) => receipt.manager === manager)?.reused, manager === "go" ? 2 : 1);
      await assert.rejects(() => sdk.cache.install(plan.projectId, manager, plan.digest, true), /cache|build|prepare/);
    }
    assert.equal(downloads, 7);
    assert.equal(audits, 6);
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "python");
    assert.deepEqual(await readFile(join(plan.cachePath!, "wheels", data.python.filename)), data.python.bytes);
    advisory = { vulns: [{ id: "GENERATED-NATIVE-NEW-ADVISORY" }] };
    const denied = await sdk.cache.prepare(plan.projectId, "python", plan.digest, true);
    assert.match((await sdk.jobs.wait(denied.id!)).error!, /Known vulnerabilities/); assert.equal(downloads, 7);
    advisory = {};
    const content = join(fixture.directory, "state/dependency-cache/native-archives/_cacache"), objects = await cacache.ls(content);
    const wheel = Object.entries(objects).find(([, value]) => value.metadata?.source === `${url}/wheels/${data.python.filename}`);
    assert.ok(wheel);
    await writeFile((await cacache.get.info(content, wheel[0]))!.path, "GENERATED TAMPERED WHEEL");
    const corrupt = await sdk.cache.prepare(plan.projectId, "python", plan.digest, true);
    assert.match((await sdk.jobs.wait(corrupt.id!)).error!, /SHA-512|integrity/); assert.equal(downloads, 7);
    const go = (await sdk.cache.inspect(plan.projectId, "go")).plan;
    const oldMod = Object.entries(objects).find(([, value]) => value.metadata?.source === `${url}/go/${data.go.name}/@v/v0.9.0.mod`);
    assert.ok(oldMod);
    await cacache.put(content, oldMod[0], data.go.mod + "// generated changed non-selected metadata\n", { algorithms: ["sha512"], metadata: oldMod[1].metadata });
    const wrongOldMod = await sdk.cache.prepare(plan.projectId, "go", go.digest, true);
    assert.match((await sdk.jobs.wait(wrongOldMod.id!)).error!, /checksum mismatch|SECURITY ERROR/); assert.equal(downloads, 7);
    await cacache.put(content, oldMod[0], data.go.mod, { algorithms: ["sha512"], metadata: oldMod[1].metadata });
    const module = Object.entries(objects).find(([, value]) => value.metadata?.source === `${url}/go/${data.go.name}/@v/${data.go.version}.zip`);
    assert.ok(module);
    const changed = await nativeDependencyFixtures(join(fixture.directory, "tampered-native-fixtures"), "generated-different-pinned-bytes");
    await cacache.put(content, module[0], changed.go.bytes, { algorithms: ["sha512"], metadata: module[1].metadata });
    const wrongH1 = await sdk.cache.prepare(plan.projectId, "go", go.digest, true);
    assert.match((await sdk.jobs.wait(wrongH1.id!)).error!, /checksum mismatch|SECURITY ERROR/); assert.equal(downloads, 7);
    const project = fixture.service.controller.snapshot().projects.find((entry) => entry.id === plan.projectId)!;
    const absent = new DependencyCache(fixture.service.store, join(fixture.directory, "absent-runtime"), { nativeTools: { python: join(fixture.directory, "NOT_AN_INSTALLED_PYTHON") } });
    try {
      const unavailable = await absent.inspect(project, "python");
      assert.equal(unavailable.readiness?.ready, false);
      await assert.rejects(() => absent.prepare(project, "python", unavailable.digest, AbortSignal.timeout(5000), () => {}), /Install.*native/);
    } finally { absent.close(); }
    await writeFile(join(fixture.project, "requirements.txt"), "generated-source-package @ git+https://generated.invalid/private\n");
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "python"), /exact|hash/);
    await writeFile(join(fixture.project, "go.mod"), (await readFile(join(fixture.project, "go.mod"), "utf8")) + "\nreplace generated.invalid/cache-module => ../outside\n");
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "go"), /replace|escape/);
  } finally {
    sdk.disconnect(); await fixture.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
