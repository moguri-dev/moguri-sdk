import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { nativeDependencyFixtures } from "../tests/fixtures/native-dependencies.ts";

const execute = promisify(execFile);
const scratch = join(process.cwd(), ".cache-spike-scratch");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(scratch, "native-"));
const started = performance.now();
const fixture = await nativeDependencyFixtures(root);
const server = createServer((request, response) => {
  const path = request.url;
  if (path === `/wheels/${fixture.python.filename}`) { response.end(fixture.python.bytes); return; }
  if (path === "/cargo/config.json") { response.end(JSON.stringify({ dl: `${url}/crates/{crate}/{version}/download` })); return; }
  if (path === `/cargo/ge/ne/${fixture.cargo.name}`) {
    response.end(JSON.stringify({ name: fixture.cargo.name, vers: fixture.cargo.version, deps: [], cksum: fixture.cargo.sha256, features: {}, yanked: false }) + "\n"); return;
  }
  if (path === `/crates/${fixture.cargo.name}/${fixture.cargo.version}/download`) { response.end(fixture.cargo.bytes); return; }
  const go = `/go/${fixture.go.name}/@v/`;
  if (path === `${go}${fixture.go.version}.mod`) { response.end(fixture.go.mod); return; }
  if (path === `${go}${fixture.go.version}.info`) { response.end(JSON.stringify({ Version: fixture.go.version, Time: "2026-01-01T00:00:00Z" })); return; }
  if (path === `${go}${fixture.go.version}.zip`) { response.end(fixture.go.bytes); return; }
  if (path === `${go}list`) { response.end(fixture.go.version + "\n"); return; }
  response.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}`;
const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: join(root, "home"), TMPDIR: root, NO_COLOR: "1" };
await mkdir(env.HOME, { recursive: true });
const measurements: Record<string, unknown>[] = [];
try {
  const pythonStart = performance.now();
  const python = join(root, "python"); await mkdir(python);
  await writeFile(join(python, "requirements.txt"), `${fixture.python.name}==${fixture.python.version} --hash=sha256:${fixture.python.sha256}\n`);
  const wheels = join(python, "wheels"); await mkdir(wheels);
  await writeFile(join(wheels, fixture.python.filename), fixture.python.bytes);
  await execute("python3", ["-I", "-m", "pip", "--isolated", "--disable-pip-version-check", "download", "--no-index", "--find-links", wheels, "--require-hashes", "--only-binary=:all:", "--no-input", "--dest", join(python, "download"), "-r", "requirements.txt"], { cwd: python, env });
  assert.deepEqual(await readFile(join(python, "download", fixture.python.filename)), fixture.python.bytes);
  measurements.push({ adapter: "python", status: "PASS", elapsedMs: Math.round(performance.now() - pythonStart), mode: "native pip hash-locked binary-wheel cache; dependency code not imported" });
  const cargoStart = performance.now();
  const cargo = join(root, "cargo"); await mkdir(join(cargo, "src"), { recursive: true });
  await writeFile(join(cargo, "src/lib.rs"), "");
  await writeFile(join(cargo, "Cargo.toml"), `[package]\nname="generated-consumer"\nversion="1.0.0"\nedition="2021"\n[dependencies]\n${fixture.cargo.name}="=${fixture.cargo.version}"\n`);
  await writeFile(join(cargo, "Cargo.lock"), `version = 4\n\n[[package]]\nname = "${fixture.cargo.name}"\nversion = "${fixture.cargo.version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${fixture.cargo.sha256}"\n\n[[package]]\nname = "generated-consumer"\nversion = "1.0.0"\ndependencies = ["${fixture.cargo.name}"]\n`);
  const cargoHome = join(root, "cargo-home"); await mkdir(cargoHome);
  await writeFile(join(cargoHome, "config.toml"), `[source.crates-io]\nreplace-with="generated"\n[source.generated]\nregistry="sparse+${url}/cargo/"\n`);
  const cargoCwd = parse(cargo).root;
  for (const name of ["config", "config.toml"]) assert.equal(await lstat(join(cargoCwd, ".cargo", name)).catch(() => null), null, "A root-level Cargo configuration prevents this isolated generated spike.");
  await execute("cargo", ["fetch", "--locked", "--manifest-path", join(cargo, "Cargo.toml")], { cwd: cargoCwd, env: { ...env, CARGO_HOME: cargoHome } });
  await execute("cargo", ["fetch", "--locked", "--offline", "--manifest-path", join(cargo, "Cargo.toml")], { cwd: cargoCwd, env: { ...env, CARGO_HOME: cargoHome } });
  measurements.push({ adapter: "cargo", status: "PASS", elapsedMs: Math.round(performance.now() - cargoStart), mode: "native locked archive cache and offline reuse; hostile build.rs never executed" });
  const goStart = performance.now();
  const go = join(root, "go"); await mkdir(go);
  await writeFile(join(go, "go.mod"), `module generated.invalid/consumer\n\ngo 1.20\n\nrequire ${fixture.go.name} ${fixture.go.version}\n`);
  const goEnv = { ...env, GOMODCACHE: join(root, "go-cache"), GOPATH: join(root, "gopath"), GOCACHE: join(root, "go-build-cache"), GOPROXY: `${url}/go`, GOSUMDB: "off", GOWORK: "off", GOENV: "off", GOTOOLCHAIN: "local", GOTELEMETRY: "off", GOFLAGS: "" };
  await execute("go", ["mod", "download", "-json", "all"], { cwd: go, env: goEnv });
  const sums = await readFile(join(go, "go.sum"), "utf8");
  assert.match(sums, /h1:/);
  await execute("go", ["mod", "download", "-json", "all"], { cwd: go, env: { ...goEnv, GOPROXY: "off" } });
  assert.equal(await readFile(join(go, "go.sum"), "utf8"), sums);
  measurements.push({ adapter: "go", status: "PASS", elapsedMs: Math.round(performance.now() - goStart), mode: "native module h1 verification, GOTOOLCHAIN=local and offline cache reuse; no build" });
  console.log(JSON.stringify({ status: "PASS", elapsedMs: Math.round(performance.now() - started), fixtures: "generated only; isolated HOME and loopback; no personal installs or credentials", measurements }, null, 2));
} finally {
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  await execute("go", ["clean", "-modcache"], { cwd: root, env: { ...env, GOMODCACHE: join(root, "go-cache"), GOENV: "off", GOTOOLCHAIN: "local", GOTELEMETRY: "off" } }).catch(() => {});
  await rm(root, { recursive: true, force: true });
  await rm(scratch, { recursive: false }).catch(() => {});
}
