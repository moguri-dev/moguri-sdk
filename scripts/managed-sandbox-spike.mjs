import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { resolveCname } from "node:dns/promises";
import { build } from "esbuild";
import { readNativeCompletion } from "../apps/service/src/native-evidence.ts";
import { sandboxHostEnvironment } from "../apps/service/src/sandbox-runtime.ts";
import { sandboxRunConfiguration, sandboxProviderDestination } from "../apps/service/src/sandbox-policy.ts";
import { captureNativeSource } from "../apps/service/src/native-staging.ts";
import { PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { resolveSandboxNetwork } from "../apps/service/src/sandbox-network.ts";

const { values } = parseArgs({ options: { workload: { type: "string" }, archive: { type: "string" }, installation: { type: "string" }, network: { type: "boolean" } } });
if (process.platform !== "darwin" || process.arch !== "arm64" || !values.workload || !values.archive || !values.installation) {
  throw new Error("Use Node --import tsx with explicit current workload, pinned SendBox archive and reviewed root-owned guest installation receipts.");
}
const started = performance.now(), env = sandboxHostEnvironment();
const sha = async (path, algorithm = "sha256") => {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
const run = (program, args, options = {}) => execFileSync(program, args, {
  env, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024, ...options,
});
const workload = JSON.parse(await readFile(values.workload, "utf8"));
assert.equal(workload.status, "PASS"); assert.equal(workload.payload.protocol, PROTOCOL_VERSION);
assert.equal(await sha(values.archive), "ab9508dffa9f3299621248d6cff8efb8fd84b44556f630b6e343329ab1eafb3e");
await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
const directory = await realpath(await mkdtemp(".native/qualification/managed-sandbox-"));
const report = { status: "RUNNING", primitive: "App-managed native distribution prerequisites", directory, protocol: PROTOCOL_VERSION,
  personalCredentials: false, modelCalls: 0, realProfileChanges: false, gates: {} };
try {
  const entries = run("/usr/bin/tar", ["-tzf", resolve(values.archive)]).trim().split("\n");
  assert.ok(entries.length < 5000 && entries.every((path) => path.startsWith("sendbox-0.2.3-macos-arm64/") &&
    !path.split("/").includes("..") && !path.includes("\0")));
  run("/usr/bin/tar", ["-xzf", resolve(values.archive), "-C", directory]);
  const root = await realpath(join(directory, "sendbox-0.2.3-macos-arm64"));
  const executable = join(root, "sendbox"), bundlePath = join(root, "guest/aarch64/bundle"), trustRootPath = join(root, "guest/aarch64/release-public.key");
  const qualification = { release: "0.2.3",
    hostSha256: "2c0a6f0d01930037dc5b7d34f85dd9a58583ef2f93ac92dbf2f503691eee5484",
    keySha256: "998a6a606edb6afa7f8db6ea64949e39acfec30f70bbfdfc37c47391e5b85a88",
    manifestSha256: "4465bb324c4753ac621e82bd2ca30a7bb6e4e071c8521da4f10a1eb99b719030",
    workerDigest: workload.payload.files["dist/worker.mjs"], bridgeDigest: workload.payload.files["dist/remote-bridge.mjs"],
    trustRootId: "external-release-root", minimumReleaseSequence: 7, allowedDomains: [], allowCopilot: false,
    resources: { cpus: 2, memoryMb: 4096, diskMb: 8192 } };
  for (const [path, expected] of [[executable, qualification.hostSha256], [trustRootPath, qualification.keySha256],
    [join(bundlePath, "manifest.json"), qualification.manifestSha256]]) assert.equal(await sha(path), expected);
  assert.equal(run(executable, ["--version"]).trim(), "sendbox 0.2.3");
  assert.equal((await stat(executable)).uid, process.getuid());
  report.gates.userOwnedPinnedRelease = { status: "PASS", release: qualification.release, archiveBytes: (await stat(values.archive)).size,
    canonicalUserOwned: true, hostExecutableFromBundle: true };
  const signedManifest = JSON.parse(JSON.parse(await readFile(join(bundlePath, "manifest.json"), "utf8")).payload);
  assert.ok(signedManifest.artifacts.every((artifact) => artifact.uid === 0 && artifact.gid === 0));
  report.gates.userOwnedGuestBundle = { status: "EXPECTED-REFUSAL",
    diagnostic: "Released 0.2.3 signed guest artifacts require root:root ownership. A verified administrator-approved side-by-side installation is required; ownership is not relaxed." };
  const installation = JSON.parse(await readFile(values.installation, "utf8"));
  for (const [path, expected] of [[join(installation.bundle, "manifest.json"), qualification.manifestSha256], [installation.key, qualification.keySha256]]) {
    assert.equal(await sha(path), expected); assert.equal((await stat(path)).uid, 0);
  }

  const archive = join(directory, "worker.oci.tar"), exportStarted = performance.now();
  run("container", ["image", "save", "--output", archive, workload.image], { timeout: 180_000 });
  const archiveBytes = (await stat(archive)).size, archiveSha512 = await sha(archive, "sha512");
  run("container", ["image", "load", "--input", archive], { timeout: 180_000 });
  const imported = JSON.parse(run("container", ["image", "inspect", workload.image]));
  assert.equal(imported[0]?.index?.digest, workload.digest);
  report.gates.ociDistribution = { status: "PASS", archiveBytes, archiveSha512, image: workload.image,
    ms: performance.now() - exportStarted, qualification: "Verified archive import, not a fresh host or inference claim; no shared image was removed." };

  const workspace = join(directory, "workspace"); await mkdir(workspace, { mode: 0o700 });
  let config = { executable, configPath: null, image: workload.image, bundlePath: installation.bundle, trustRootPath: installation.key, qualification };
  let networkCode = "";
  if (values.network) {
    const resolved = await resolveSandboxNetwork({ ...config, qualification: { ...qualification, allowCopilot: true,
      allowedDomains: ["github.com", "api.github.com"] } }, ["https://api.individual.githubcopilot.com"], AbortSignal.timeout(20_000));
    config = resolved.configuration; report.providerScope = resolved.scope;
    const helpers = await build({ stdin: { contents: `export {fetchNativePage} from ${JSON.stringify(resolve("apps/service/src/web-page.ts"))};export {probeSocksDomain} from ${JSON.stringify(resolve("apps/service/src/proxy-probe.ts"))};`,
      resolveDir: process.cwd(), sourcefile: "generated-managed-native-network.ts" }, bundle: true, write: false, format: "cjs", platform: "node", target: "node26", packages: "external" });
    await writeFile(join(workspace, "generated-native-network.cjs"), `module.paths.unshift("/opt/moguri/node_modules");\n${helpers.outputFiles[0].text}`, { mode: 0o600 });
    networkCode = `(async()=>{const{fetchNativePage,probeSocksDomain}=require("/workspace/generated-native-network.cjs");const page=await fetchNativePage("https://github.com",AbortSignal.timeout(20000));if(page.source!=="untrusted-web"||!page.text.length)throw Error("Approved GitHub page was unavailable");const denied=await probeSocksDomain(process.env.ALL_PROXY,"google.com",443,AbortSignal.timeout(12000));if(denied.classification!=="policy-denied")throw Error("Unapproved Google destination was not denied by policy");const metadata=await fetch("https://api.individual.githubcopilot.com/models",{redirect:"error",signal:AbortSignal.timeout(10000)});const status=metadata.status;await metadata.body?.cancel();if(![400,401,403].includes(status))throw Error("Unexpected credential-free provider status");const proof={githubReadable:true,googlePolicyDenied:true,googleSocksReply:denied.reply,preparedProviderHttp:status,credentials:false,modelCalls:0};fs.writeFileSync("/workspace/generated-network-proof.json",JSON.stringify(proof));console.log(JSON.stringify(proof));})().catch(error=>{console.error(error.code??"GENERATED_NATIVE_NETWORK_FAILED");process.exitCode=1;});`;
  }
  const name = `mg-dist-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const policy = sandboxRunConfiguration(config, name, workspace, ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"]);
  policy.policy.commands.allowlist = ["/usr/local/bin/node -e *"];
  const policyPath = join(directory, "sendbox.json"); await writeFile(policyPath, JSON.stringify(policy), { mode: 0o600 });
  const program = `const fs=require("node:fs");const s=fs.readFileSync("/proc/self/status","utf8");if(process.getuid()===0||!/^NoNewPrivs:\\s*1$/m.test(s)||!/^Seccomp:\\s*2$/m.test(s)||!/^CapEff:\\s*0+$/m.test(s)||process.versions.node!=="26.12.0")throw Error("Generated guest controls differ");fs.writeFileSync("/workspace/generated-distribution-witness.txt",${JSON.stringify(randomUUID())});const pty=require("/opt/moguri/node_modules/node-pty");const child=pty.spawn("/bin/sh",["-c","printf GENERATED_BUNDLED_PTY_READY"],{cwd:"/workspace",env:{PATH:"/usr/bin:/bin"}});let output="";child.onData(value=>output+=value);child.onExit(value=>{if(value.exitCode!==0||output!=="GENERATED_BUNDLED_PTY_READY")throw Error("Generated native dependency failed");console.log("GENERATED_BUNDLED_RUNTIME_READY");});${networkCode}`;
  const command = { program: "/usr/local/bin/node", arguments: ["-e", program] }, launched = Date.now();
  report.nativeLaunch = { name, workspace, image: workload.image, command, createdAfter: Math.floor(launched / 1000) - 2 };
  await writeFile(join(directory, "intent.json"), JSON.stringify(report.nativeLaunch), { flag: "wx", mode: 0o600 });
  const output = run(executable, ["run", "--json", "--runtime", "apple", "--config", policyPath, "--image", workload.image, "--bundle", config.bundlePath,
    "--trust-root", config.trustRootPath, "--trust-root-id", qualification.trustRootId, "--minimum-release-sequence", "7", "--", command.program, ...command.arguments]);
  await writeFile(join(directory, "native-output.jsonl"), output, { mode: 0o600 });
  const frames = output.trim().split("\n").map((line) => JSON.parse(line)), result = frames.find((frame) => frame.event === "result");
  assert.equal(result?.ok, true); assert.equal(result.exit_code, 0); assert.match(result.session_id, /^[a-f0-9]{32}$/);
  assert.ok(frames.filter((frame) => frame.event === "output").some((frame) =>
    Buffer.from(frame.data, frame.encoding).toString("utf8").includes("GENERATED_BUNDLED_RUNTIME_READY")));
  report.nativeLaunch.sessionId = result.session_id;
  const evidence = await readNativeCompletion({ stateRoot: join(homedir(), ".sendbox/run"), sessionId: result.session_id,
    workspace, image: workload.image, command, createdAfter: Math.floor(launched / 1000) - 2, createdBefore: Math.ceil(Date.now() / 1000) + 2 });
  const inventory = JSON.parse(run("container", ["ls", "--all", "--format", "json"]));
  assert.equal(inventory.some((entry) => entry.configuration.id === `${name}-${result.session_id}`), false);
  report.gates.bundledActualGuest = { status: "PASS", node: "26.12.0", nativePty: true, bundledHostExecutable: true, rootOwnedGuest: true,
    nativeSessionId: result.session_id, signedPlan: evidence.planDigest, ownedGuestAbsent: true, ms: Date.now() - launched };
  if (values.network) {
    const proof = JSON.parse((await evidence.read("generated-network-proof.json")).content.toString("utf8"));
    assert.equal(proof.githubReadable, true); assert.equal(proof.googlePolicyDenied, true); assert.equal(proof.credentials, false);
    report.gates.nativePublicNetwork = { status: "PASS", ...proof };
  }
  const component = join(directory, "sendbox-0.2.3.pkg"), expanded = join(directory, "expanded");
  run("/usr/bin/pkgbuild", ["--root", root, "--ownership", "recommended", "--install-location", "/opt/moguri/sendbox/0.2.3",
    "--identifier", "dev.moguri.sendbox.runtime.0.2.3", "--version", "0.2.3", component]);
  run("/usr/sbin/pkgutil", ["--expand", component, expanded]);
  assert.doesNotMatch(await readFile(join(expanded, "PackageInfo"), "utf8"), /<scripts>/);
  const ownership = run("/usr/bin/lsbom", ["-p", "fug", join(expanded, "Bom")]).trim().split("\n").map((line) => line.split("\t"));
  assert.ok(ownership.every((entry) => entry[1] === "0" && entry[2] === "0"));
  report.gates.versionedNoScriptInstaller = { status: "PASS", archiveBytes: (await stat(component)).size,
    packageSha512: await sha(component, "sha512"), path: "/opt/moguri/sendbox/0.2.3", rootOwnedPayload: true,
    installationScripts: false, administratorDialogOpened: false, qualification: "Actual package/BOM inspection, not a privileged installation claim." };

  const source = join(directory, "generated-source"); await mkdir(source, { mode: 0o700 });
  const paths = Array.from({ length: 201 }, (_, index) => `generated-${index}.txt`);
  for (const path of paths) await writeFile(join(source, path), "Generated repository fixture.\n");
  await assert.rejects(() => captureNativeSource(source, paths, { denied: [], readOnly: [] }, AbortSignal.timeout(5000)), /200-file/);
  report.gates.manualProjectBoundary = { status: "EXPECTED-REFUSAL", files: 201,
    diagnostic: "The existing per-file 200-file preview cannot implement full automatic project workspaces. A separately bounded metadata/copy contract is required." };
  const canonicalOnly = { ...config, qualification: { ...qualification, allowCopilot: true, allowedDomains: ["api.githubcopilot.com"] } };
  assert.throws(() => sandboxProviderDestination(canonicalOnly, "https://api.individual.githubcopilot.com"), /outside the approved native host scope/);
  const host = "api.individual.githubcopilot.com";
  report.gates.providerEndpoint = { status: "EXPECTED-REFUSAL", host,
    cnames: await resolveCname(host), diagnostic: "A canonical API-only fixed scope is not the actual prepared provider endpoint; inference has not reached any requested website." };
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; report.failure = error instanceof Error ? error.message : "Managed Sandbox primitive failed.";
  if (error?.stdout) {
    await writeFile(join(directory, "failure-stdout.jsonl"), error.stdout, { mode: 0o600 });
    for (const line of String(error.stdout).trim().split("\n")) {
      const frame = JSON.parse(line);
      if (frame.event === "output") console.error(Buffer.from(frame.data, frame.encoding).toString("utf8"));
      else console.error(JSON.stringify(frame));
    }
  }
  if (error?.stderr) { await writeFile(join(directory, "failure-stderr.txt"), error.stderr, { mode: 0o600 }); console.error(String(error.stderr)); }
  process.exitCode = 1;
} finally {
  report.ms = performance.now() - started;
  await writeFile(join(directory, "qualification.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
