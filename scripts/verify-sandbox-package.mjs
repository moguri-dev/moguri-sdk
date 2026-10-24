import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSandboxDistribution } from "../apps/service/src/sandbox-distribution.ts";
import { PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Packaged native setup verification requires macOS arm64.");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const app = resolve(process.argv[2] ?? `release/builds.noindex/${version}/Moguri-darwin-arm64/Moguri.app`);
const resources = join(app, "Contents", "Resources"), runtime = join(resources, "app"), started = performance.now();
const definition = await readSandboxDistribution(join(resources, "moguri-native"), AbortSignal.timeout(60_000));
for (const [name, expected] of [["worker", definition.distribution.worker.workerDigest],
  ["remote-bridge", definition.distribution.worker.bridgeDigest], ["mcp-worker", definition.distribution.worker.mcpWorkerDigest]]) {
  assert.equal(createHash("sha256").update(await readFile(join(runtime, "dist", `${name}.mjs`))).digest("hex"), expected);
}
await mkdir(".moguri", { recursive: true });
const directory = await mkdtemp(resolve(".moguri/packaged-sandbox-")), expanded = join(directory, "installer-metadata");
try {
  const installer = join(definition.root, definition.distribution.vendor.installer.path);
  execFileSync("/usr/sbin/pkgutil", ["--expand", installer, expanded], { encoding: "utf8", timeout: 30_000 });
  const info = await readFile(join(expanded, "PackageInfo"), "utf8");
  assert.doesNotMatch(info, /<scripts>/);
  assert.ok(info.includes(`/opt/moguri/sendbox/${definition.distribution.vendor.version}`));
  const owners = execFileSync("/usr/bin/lsbom", ["-p", "fug", join(expanded, "Bom")], { encoding: "utf8", timeout: 10_000 });
  assert.ok(owners.trim().split("\n").every((line) => { const fields = line.split("\t"); return fields[1] === "0" && fields[2] === "0"; }));
  const script = `
    import assert from 'node:assert/strict';
    import { startService } from ${JSON.stringify(pathToFileURL(join(runtime, "dist", "runtime.mjs")).href)};
    globalThis.fetch = async () => { throw new Error("Generated packaged discovery cannot access a real account or network."); };
    const provider = {state:{status:"disconnected",models:[],login:null,diagnostic:null},onChange:()=>{},refresh:async()=>{},login:()=>{throw Error("No generated login.");},
      cancel:async()=>{},logout:async()=>{},prepare:async()=>{throw Error("No generated model.");}};
    const service = await startService({stateDir:${JSON.stringify(join(directory, "state"))},retentionKey:Buffer.alloc(32,77),provider,
      platform:{sandbox:{setup:{automatic:false}}}});
    try {
      const setup=service.controller.sandboxSetup.status();
      assert.equal(setup.supported,true);assert.equal(setup.bundledVersion,${JSON.stringify(definition.distribution.vendor.version)});
      assert.equal(service.connection.protocolVersion,${PROTOCOL_VERSION});
      assert.equal(service.controller.snapshot().provider.models.length,0);
      assert.equal(service.store.events().some(event=>event.event_type==="model.started"),false);
      console.log(JSON.stringify({status:"PASS",primitive:"Actual packaged Node/service discovers bundled Sandbox without path injection, model, network or keychain access",
        node:process.versions.node,protocol:service.connection.protocolVersion,bundledVersion:setup.bundledVersion}));
    }finally{await service.close();}
  `;
  const output = execFileSync(join(runtime, "node_modules", "node", "bin", "node"), ["--input-type=module"], {
    input: script, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME },
  });
  console.log(output.trim());
  console.log(JSON.stringify({ status: "PASS", primitive: "Exact packaged native distribution and root-owned no-script side-by-side installer",
    protocol: PROTOCOL_VERSION, image: definition.distribution.worker.image, installerBytes: definition.distribution.vendor.installer.bytes,
    imageArchiveBytes: definition.distribution.worker.archive.bytes, ms: performance.now() - started,
    administratorDialogOpened: false, personalCredentials: false, applicationExecuted: false }));
} finally { await rm(directory, { recursive: true, force: true }); }
