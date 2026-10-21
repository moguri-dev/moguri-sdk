import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import * as cacache from "cacache";

const require = createRequire(import.meta.url);
const root = await mkdtemp(join(tmpdir(), "moguri-workspace-spike-"));
try {
  const started = performance.now();
  const pkg = join(root, "source", "package");
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "generated-cache-spike", version: "1.0.0", scripts: { postinstall: "node -e \"require('node:fs').writeFileSync('UNSAFE_SCRIPT_RAN','bad')\"" } }));
  await writeFile(join(pkg, "index.js"), "module.exports = 'generated cache fixture';");
  const tarball = join(root, "generated.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", join(root, "source"), "package"]);
  const data = await readFile(tarball);
  const integrity = `sha512-${createHash("sha512").update(data).digest("base64")}`;
  const url = "https://registry.npmjs.org/generated-cache-spike/-/generated-cache-spike-1.0.0.tgz";
  const cache = join(root, "npm");
  const key = `make-fetch-happen:request-cache:${url}`;
  const options = { integrity, metadata: { time: Date.now(), url, reqHeaders: {}, resHeaders: { "cache-control": "public, max-age=31536000, immutable", "content-type": "application/octet-stream" }, options: { compress: true } } };
  await cacache.put(join(cache, "_cacache"), key, data, options);
  const first = await cacache.get.info(join(cache, "_cacache"), key);
  await cacache.put(join(cache, "_cacache"), key, data, options);
  assert.equal((await cacache.get.info(join(cache, "_cacache"), key)).integrity, first.integrity);
  await assert.rejects(() => cacache.put(join(cache, "_cacache"), "generated-tamper", Buffer.from("bad"), options));
  for (const name of ["branch-a", "branch-b"]) {
    const project = join(root, name); await mkdir(project);
    await writeFile(join(project, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies: { "generated-cache-spike": "1.0.0" } }));
    await writeFile(join(project, "package-lock.json"), JSON.stringify({ name, version: "1.0.0", lockfileVersion: 3, packages: { "": { name, version: "1.0.0", dependencies: { "generated-cache-spike": "1.0.0" } }, "node_modules/generated-cache-spike": { version: "1.0.0", resolved: url, integrity, hasInstallScript: true } } }));
    execFileSync("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache], { cwd: project, stdio: "pipe" });
    assert.equal(await readFile(join(project, "node_modules/generated-cache-spike/index.js"), "utf8"), "module.exports = 'generated cache fixture';");
  }
  const pnpm = join(dirname(require.resolve("pnpm/package.json")), "bin", "pnpm.mjs");
  const pnpmStore = join(root, "pnpm-store");
  execFileSync(process.execPath, [pnpm, "store", "add", tarball, "--store-dir", pnpmStore, "--ignore-scripts", "--ignore-pnpmfile", "--offline"], { cwd: root, stdio: "pipe" });
  const pnpmProject = join(root, "pnpm-branch"); await mkdir(pnpmProject);
  await writeFile(join(pnpmProject, "package.json"), JSON.stringify({ name: "generated-pnpm-branch", version: "1.0.0", dependencies: { "generated-cache-spike": "1.0.0" } }));
  await writeFile(join(pnpmProject, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      generated-cache-spike:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n  generated-cache-spike@1.0.0:\n    resolution: {integrity: ${integrity}}\nsnapshots:\n  generated-cache-spike@1.0.0: {}\n`);
  let requests = 0;
  const mirror = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/generated-cache-spike/-/generated-cache-spike-1.0.0.tgz") { response.writeHead(404).end(); return; }
    requests++; response.setHeader("content-type", "application/octet-stream"); response.end(data);
  });
  await new Promise((resolve) => mirror.listen(0, "127.0.0.1", resolve));
  try {
    const port = mirror.address().port;
    await promisify(execFile)(process.execPath, [pnpm, "install", "--frozen-lockfile", "--registry", `http://127.0.0.1:${port}`, "--ignore-scripts", "--ignore-pnpmfile", "--trust-lockfile", "--store-dir", pnpmStore, "--config.manage-package-manager-versions=false"], { cwd: pnpmProject, env: { ...process.env, XDG_CACHE_HOME: join(root, "xdg-cache"), XDG_DATA_HOME: join(root, "xdg-data") } });
    assert.equal(requests, 1);
    assert.equal(await readFile(join(pnpmProject, "node_modules/generated-cache-spike/index.js"), "utf8"), "module.exports = 'generated cache fixture';");
  } finally { await new Promise((resolve) => mirror.close(resolve)); }
  console.log(JSON.stringify({ spike: "content-addressed npm reuse across branches and pnpm approved-artifact mirror", status: "PASS", bytes: data.length, elapsedMs: performance.now() - started, integrity: "verified; tampering rejected", scripts: "never executed", pnpm: "native offline hydration alone fails; scoped local verified-artifact mirror passes" }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
