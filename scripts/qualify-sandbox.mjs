import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { homedir, release } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs, promisify } from "node:util";
import { build } from "esbuild";
import {
  distributionConfiguration, inspectSandboxRelease, readSandboxDistribution, sandboxFileHash, SENDBOX_024,
} from "../apps/service/src/sandbox-distribution.ts";
import { sandboxHostEnvironment, verifySandboxArtifacts } from "../apps/service/src/sandbox-runtime.ts";
import { sandboxRunConfiguration } from "../apps/service/src/sandbox-policy.ts";
import { resolveSandboxNetwork } from "../apps/service/src/sandbox-network.ts";
import { captureNativeSource, materializeNativeStage } from "../apps/service/src/native-staging.ts";
import { readNativeCompletion, readNativeNetwork } from "../apps/service/src/native-evidence.ts";
import { defaultSandboxManagement, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { nativeApiFixture } from "../tests/fixtures/native-api.ts";
import { reviewNativeTools, waitFor } from "../tests/fixture.ts";
import { cacheRuntimeFiles } from "./build-cache.mjs";
import { APPLE_INIT } from "./prepare-apple-init.mjs";

const { values } = parseArgs({ options: {
  distribution: { type: "string" }, workload: { type: "string" }, archive: { type: "string" },
  "installation-root": { type: "string" }, provider: { type: "string", default: "https://api.individual.githubcopilot.com" },
} });
if (!values.distribution || !values.workload || !values.archive) {
  throw new Error("Use Node --import tsx scripts/qualify-sandbox.mjs --distribution DIRECTORY --workload IMAGE.json --archive PINNED.tar.gz. This never installs, authorizes macOS dialogs or uses personal inference.");
}
await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
const directory = await realpath(await mkdtemp(".native/qualification/current-sendbox-")), started = performance.now();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex"), env = sandboxHostEnvironment();
const write = (name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
const run = (program, argv, timeout = 30_000) => execFileSync(program, argv, {
  cwd: process.cwd(), env, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
});
const report = { format: "moguri-sandbox-qualification", version: 1, status: "RUNNING", startedAt: new Date().toISOString(),
  protocol: PROTOCOL_VERSION, source: { commit: run("git", ["rev-parse", "HEAD"]).trim(),
    diffSha256: hash(run("git", ["diff", "--binary", "HEAD", "--", "apps", "packages", "scripts", "tests", "package.json", "package-lock.json"])),
    status: run("git", ["status", "--porcelain", "--untracked-files=all", "--", "apps", "packages", "scripts", "tests", "package.json", "package-lock.json"]).trim(),
    harness: {} },
  host: { platform: process.platform, architecture: process.arch, kernel: release(), node: process.versions.node },
  personalCredentials: false, paidInference: false, administratorDialogOpened: false, sourceCheckoutMounted: false,
  qualification: "Exact development artifacts only; generated model accounting is not live billing, model quality, notarization or Linux release acceptance.",
  gates: {} };
for (const path of ["scripts/qualify-sandbox.mjs", "scripts/prepare-apple-init.mjs", "scripts/worker-image/qualification-network.mjs", "apps/service/src/native-evidence.ts",
  "tests/fixtures/native-api.ts", "tests/fixtures/native-target.ts", "tests/fixtures/native-provider.mjs", "tests/fixtures/native-group-provider.mjs",
  "tests/fixtures/native-retry-provider.mjs", "tests/fixtures/native-checkpoint-provider.mjs", "tests/fixtures/native-checkpoint.ts",
  "tests/native-retry-restaging.test.ts", "tests/native-checkpoint.test.ts", "tests/sandbox-managed-groups.test.ts", "tests/fixture.ts"]) {
  report.source.harness[path] = hash(await readFile(path));
}
const owned = [];
let configuration, distribution, workload, prepared;
const gate = async (name, dependencies, action) => {
  const blocked = dependencies.filter((dependency) => report.gates[dependency]?.status !== "PASS");
  if (blocked.length) { report.gates[name] = { status: "SKIP", blockedBy: blocked, diagnostic: "Prerequisite failed or was unavailable; no substitute execution." }; return; }
  const began = performance.now();
  try { report.gates[name] = { status: "PASS", ...await action(), ms: performance.now() - began }; }
  catch (error) {
    report.gates[name] = { status: error.code === "ENOENT" || error.code === "sandbox_host" ? "SKIP" : "FAIL",
      diagnostic: error.message, code: error.code ?? null, ms: performance.now() - began };
    if (report.gates[name].status === "SKIP") report.gates[name].action = name === "installedRuntime" ?
      "On Apple-silicon macOS, enable the exact bundled SendBox 0.2.4 setup and personally approve its side-by-side OS installation if needed; start Apple Containerization, then rerun this qualification. No approval or fallback was attempted." :
      "Supply the actual current distribution, workload and pinned public archive produced by npm run prepare:sandbox, then rerun explicitly.";
    console.error(`${name}: ${report.gates[name].status}: ${error.message}`);
  }
  await writeFile(join(directory, "progress.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
};
const inventory = () => JSON.parse(run("container", ["ls", "--all", "--format", "json"]));
function ownedGuests(owner) {
  return inventory().filter((entry) => {
    const config = entry.configuration;
    if (!config?.id?.startsWith(`${owner.name}-`)) return false;
    assert.equal(config.initProcess?.executable, "/opt/sendbox/bin/sendbox-guest", "A matching guest name is not ownership.");
    assert.equal(config.image?.reference, owner.image);
    assert.equal(config.image?.descriptor?.digest, owner.image.slice(owner.image.lastIndexOf("@") + 1));
    assert.ok(config.mounts?.some((mount) => mount.source === owner.workspace), "Guest mount differs from the original private stage.");
    if (owner.sessionId) assert.equal(config.id, `${owner.name}-${owner.sessionId}`);
    return true;
  });
}
const nativeInput = (owner) => ({ stateRoot: join(homedir(), ".sendbox/run"), sessionId: owner.sessionId,
  workspace: owner.workspace, image: owner.image, command: owner.command, createdAfter: owner.createdAfter,
  createdBefore: Math.ceil(Date.now() / 1000) + 2 });
function activeMeta(evidence, expectedDomains, launchedAt) {
  const gateway = evidence.report.gateways.workload, policy = gateway.configured_policy, meta = gateway.github_meta;
  assert.deepEqual(Object.keys(evidence.report.gateways), ["workload"]);
  assert.equal(policy.default_action, "deny"); assert.equal(policy.allow_dns, true);
  assert.deepEqual([...policy.allowed_domains].sort(), [...expectedDomains].sort());
  assert.deepEqual(policy.blocked_domains, []);
  assert.equal(meta.source, "https://api.github.com/meta"); assert.equal(meta.api_version, "2022-11-28");
  assert.equal(meta.state, "fresh"); assert.equal(meta.grants_active, true); assert.equal(meta.revision, 1);
  assert.equal(meta.last_error, null); assert.equal(meta.refresh_interval_seconds, 3600); assert.equal(meta.max_staleness_seconds, 86400);
  assert.ok(meta.last_success_unix_seconds >= Math.floor(launchedAt / 1000) - 2);
  assert.equal(meta.expires_unix_seconds, meta.last_success_unix_seconds + 86400);
  assert.ok(meta.expires_unix_seconds > Date.now() / 1000);
  assert.match(meta.published_scope.sha256, /^[a-f0-9]{64}$/);
  assert.ok(meta.published_scope.domains.length > 0 && meta.published_scope.networks.length > 0);
  return meta;
}

await gate("artifacts", [], async () => {
  const verified = await readSandboxDistribution(await realpath(resolve(values.distribution)), AbortSignal.timeout(60_000));
  distribution = verified.distribution;
  const { installer: _installer, ...vendor } = distribution.vendor;
  assert.deepEqual(vendor, SENDBOX_024, "Current qualification cannot silently use a historical release.");
  workload = JSON.parse(await readFile(values.workload, "utf8"));
  assert.equal(workload.status, "PASS"); assert.equal(workload.payload.protocol, PROTOCOL_VERSION);
  assert.equal(workload.payload.schemaVersion, 1);
  assert.equal(workload.payload.version, JSON.parse(await readFile("package.json", "utf8")).version);
  assert.equal(workload.image, distribution.worker.image);
  assert.equal(workload.digest, workload.image.slice(workload.image.lastIndexOf("@") + 1));
  const inputs = ["package.json", "package-lock.json", "dist/worker.mjs", "dist/remote-bridge.mjs", "dist/mcp-worker.mjs", "dist/data-worker.mjs", ...cacheRuntimeFiles], current = {};
  assert.deepEqual(Object.keys(workload.payload.files).sort(), [...inputs].sort());
  for (const path of inputs) {
    current[path] = hash(await readFile(path)); assert.equal(current[path], workload.payload.files[path], `Current payload changed: ${path}`);
  }
  const recipe = await readFile("scripts/worker-image/Containerfile", "utf8");
  current["scripts/worker-image/Containerfile"] = hash(recipe);
  assert.equal(current["scripts/worker-image/Containerfile"], workload.payload.recipeDigest);
  assert.equal(workload.payload.base, recipe.match(/^FROM (docker\.io\/library\/node@sha256:[a-f0-9]{64})$/m)?.[1]);
  assert.equal(hash(JSON.stringify(current)), distribution.worker.payloadDigest, "The complete distribution payload must match current compiled/dependency/recipe bytes.");
  for (const [file, field] of [["worker", "workerDigest"], ["remote-bridge", "bridgeDigest"], ["mcp-worker", "mcpWorkerDigest"]]) {
    assert.equal(hash(await readFile(`dist/${file}.mjs`)), distribution.worker[field]);
  }
  assert.equal(await sandboxFileHash(join(verified.root, "AppleContainerization.LICENSE"), "sha256"), APPLE_INIT.licenseSha256);
  const runtimeIndex = JSON.parse(run("tar", ["-xOf", join(verified.root, distribution.worker.archive.path), "index.json"]));
  assert.deepEqual(runtimeIndex.manifests.map((value) => value.digest).sort(), [workload.digest, APPLE_INIT.indexDigest].sort(),
    "Native qualification requires both exact runtime images in the actual reviewed archive.");
  assert.equal(await sandboxFileHash(resolve(values.archive), "sha256"), vendor.archiveSha256);
  const attestation = JSON.parse(run("gh", ["attestation", "verify", resolve(values.archive), "--repo", vendor.repository,
    "--signer-workflow", `${vendor.repository}/.github/workflows/release.yaml`, "--source-ref", "refs/tags/v0.2.4",
    "--source-digest", "5e83a179ed83ef2b3b184b60b7fef82105aa504c", "--deny-self-hosted-runners", "--format", "json"], 120_000));
  await write("release-attestation.json", attestation);
  configuration = distributionConfiguration(distribution, resolve(values["installation-root"] ?? "/opt/moguri/sendbox/0.2.4"));
  return { distributionDigest: verified.digest, vendor, image: workload.image, payload: workload.payload,
    ociArchive: distribution.worker.archive, installer: distribution.vendor.installer, appleInit: APPLE_INIT,
    attestationSource: "5e83a179ed83ef2b3b184b60b7fef82105aa504c", attestationSha256: hash(JSON.stringify(attestation)) };
});
await gate("installedRuntime", ["artifacts"], async () => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    const error = new Error("Physical qualification requires Apple-silicon macOS with Apple Containerization; no generated substitute.");
    error.code = "sandbox_host"; throw error;
  }
  const vendor = await inspectSandboxRelease(resolve(values["installation-root"] ?? "/opt/moguri/sendbox/0.2.4"),
    "0.2.4", SENDBOX_024.keySha256, SENDBOX_024.archiveSha256, AbortSignal.timeout(20_000));
  assert.deepEqual(vendor, SENDBOX_024);
  await verifySandboxArtifacts(configuration, directory, AbortSignal.timeout(20_000));
  const manifest = JSON.parse(JSON.parse(await readFile(join(configuration.bundlePath, "manifest.json"), "utf8")).payload);
  return { macOS: run("/usr/bin/sw_vers", ["-productVersion"]).trim(), macOSBuild: run("/usr/bin/sw_vers", ["-buildVersion"]).trim(),
    runtime: run("container", ["--version"]).trim(), daemon: run("container", ["system", "status"]).trim(),
    signedGuestArtifacts: manifest.artifacts, trustRootId: manifest.trust_root_id, releaseSequence: manifest.release_sequence };
});
await gate("providerScope", ["artifacts"], async () => {
  const fixture = await nativeApiFixture(configuration, { providerBaseUrl: values.provider });
  try {
    const selected = await fixture.provider.provider.prepare(fixture.provider.modelId, AbortSignal.timeout(20_000));
    assert.equal(selected.model.baseUrl, values.provider);
    prepared = await resolveSandboxNetwork(configuration, [selected.model.baseUrl], AbortSignal.timeout(20_000));
    return { selectedProvider: selected.model.provider, preparedResource: selected.model.baseUrl, scope: prepared.scope };
  } finally { await fixture.close(true); }
});
await gate("coldNetwork", ["installedRuntime", "providerScope"], async () => {
  const source = join(directory, "network-source"), state = join(directory, "network-stage");
  await mkdir(source, { mode: 0o700 }); await mkdir(state, { mode: 0o700 });
  await writeFile(join(source, "generated.txt"), `Generated native witness ${randomUUID()}\n`, { mode: 0o600 });
  const snapshot = await captureNativeSource(source, ["generated.txt"], { denied: [], readOnly: [] }, AbortSignal.timeout(5000));
  const stage = await materializeNativeStage(state, { profileId: "generated-qualification", sessionId: randomUUID(), turnId: randomUUID() }, snapshot, AbortSignal.timeout(5000));
  const fixture = await build({ entryPoints: ["scripts/worker-image/qualification-network.mjs"], bundle: true, write: false,
    format: "esm", platform: "node", target: "node26" });
  await writeFile(join(stage.workspace, "generated-network.mjs"), fixture.outputFiles[0].contents, { mode: 0o600 });
  await writeFile(join(stage.workspace, "generated-network-input.json"), JSON.stringify({ id: randomUUID(), protocol: PROTOCOL_VERSION,
    provider: report.gates.providerScope.preparedResource, providerHosts: [...new Set([...prepared.scope.providerHosts, ...prepared.scope.aliases.flatMap((alias) => alias.targets)])] }), { mode: 0o600 });
  const name = `mg-qual-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const command = { program: "/usr/local/bin/node", arguments: ["/workspace/generated-network.mjs"] };
  const owner = { name, workspace: stage.workspace, image: configuration.image, command, createdAfter: Math.floor(Date.now() / 1000) - 2 };
  assert.deepEqual(ownedGuests(owner), []); owned.push(owner);
  const policy = sandboxRunConfiguration(prepared.configuration, name, stage.workspace, ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"]);
  policy.policy.commands.allowlist = [`${command.program} ${command.arguments.join(" ")}`];
  const configPath = join(directory, "network-policy.json");
  await writeFile(configPath, JSON.stringify(policy), { flag: "wx", mode: 0o600 });
  await write("network-intent.json", owner);
  run(configuration.executable, ["policy", "validate", "--config", configPath]);
  const launchedAt = Date.now(), result = spawnSync(configuration.executable, ["run", "--json", "--runtime", "apple", "--config", configPath,
    "--image", configuration.image, "--bundle", configuration.bundlePath, "--trust-root", configuration.trustRootPath,
    "--trust-root-id", configuration.qualification.trustRootId, "--minimum-release-sequence", String(configuration.qualification.minimumReleaseSequence),
    "--", command.program, ...command.arguments], { env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(directory, "network-output.jsonl"), result.stdout ?? "", { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "network-stderr.txt"), result.stderr ?? "", { flag: "wx", mode: 0o600 });
  const terminal = (result.stdout ?? "").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((frame) => frame.event === "result");
  assert.equal(terminal.length, 1, "Original native result was not uniquely received; inspect retained intent/output.");
  owner.sessionId = terminal[0].session_id; assert.match(owner.sessionId, /^[a-f0-9]{32}$/);
  const evidence = await readNativeCompletion(nativeInput(owner));
  const proof = JSON.parse((await evidence.read("generated-network-proof.json", 128 * 1024)).content);
  await write("network-proof.json", proof);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Original cold network execution failed. Inspect network-proof.json and network-stderr.txt; no warm retry occurred.`);
  assert.equal(terminal[0].ok, true); assert.equal(evidence.exitCode, 0); assert.equal(proof.status, "PASS");
  const network = await readNativeNetwork(nativeInput(owner)), meta = activeMeta(network, prepared.scope.allowedDomains, launchedAt);
  assert.equal(meta.published_scope.sha256, proof.metaSha256, "The effective guest scope differs from the same-run official Meta response.");
  const cidrs = new BlockList(); let ipv4 = 0, ipv6 = 0;
  for (const value of meta.published_scope.networks) {
    const [address, bits] = value.split("/"), family = isIP(address), prefix = Number(bits);
    assert.ok(family && Number.isSafeInteger(prefix) && prefix > 0 && prefix <= (family === 4 ? 32 : 128));
    cidrs.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6"); if (family === 4) ipv4++; else ipv6++;
  }
  assert.ok(ipv4 && ipv6);
  assert.ok(cidrs.check(proof.delegatedAddress.address, "ipv4"));
  assert.equal(cidrs.check("1.1.1.1", "ipv4"), false);
  assert.ok(meta.published_scope.domains.some((rule) => rule === proof.delegatedDomain.host ||
    rule.startsWith("*.") && proof.delegatedDomain.host.endsWith(rule.slice(1))));
  await write("effective-network.json", network);
  assert.deepEqual(ownedGuests(owner), []);
  return { nativeSessionId: owner.sessionId, planDigest: evidence.planDigest, signerFingerprint: evidence.signerFingerprint,
    auditDigest: evidence.auditDigest, reportDigest: network.reportDigest, metaSha256: meta.published_scope.sha256,
    domains: meta.published_scope.domains.length, ipv4Cidrs: ipv4, ipv6Cidrs: ipv6, coldProviderMs: proof.coldProviderMs,
    controls: proof, ownedGuestAbsent: true, effectiveScope: "GitHub Meta domains and shared-cloud CIDRs; not exact-host-only" };
});
await gate("workerAccounting", ["installedRuntime", "providerScope"], async () => {
  const fixture = await nativeApiFixture(configuration, { providerBaseUrl: values.provider, distribution: resolve(values.distribution) }), { sdk, service, provider } = fixture;
  let retained;
  try {
    const settings = structuredClone(sdk.settings.get());
    settings.values.sandbox = configuration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), automaticUpdates: false };
    settings.values.budgets.rates = [{ modelId: provider.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2,
      effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await sdk.settings.update(settings.values, settings.revision);
    await reviewNativeTools(sdk);
    const setupReview = (await sdk.sandbox.setup.review()).review;
    assert.equal(setupReview.administratorRequired, false, "Generated qualification must reuse verified installed release files, never request an OS dialog.");
    const setup = await sdk.sandbox.setup.apply(setupReview), setupOutcome = await sdk.sandbox.setup.wait(setup.id);
    assert.equal(setupOutcome.operation.status, "completed", setupOutcome.operation.diagnostic ?? "The original managed setup did not complete.");
    const cli = JSON.parse((await promisify(execFile)(process.execPath, ["dist/cli.mjs", "sandbox", "status"], {
      cwd: process.cwd(), env: { ...env, MOGURI_STATE_DIR: fixture.state }, encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024,
    })).stdout);
    assert.equal(cli.sandbox.ready, true); assert.equal(cli.sandbox.release, configuration.qualification.release);
    assert.equal(cli.sandbox.image, configuration.image); assert.equal(cli.sandbox.workerDigest, configuration.qualification.workerDigest);
    const bound = await sdk.command({ type: "project.add", path: fixture.project }), created = await sdk.sessions.create(bound.id);
    const session = () => service.controller.snapshot().sessions.find((value) => value.id === created.id);
    await sdk.sessions.configure(created.id, { ...session().controls, env: "Sandbox", modelId: provider.modelId, autonomy: "Manual" });
    await sdk.command({ type: "draft.save", sessionId: created.id, expectedRevision: 0, text: "generated native write", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id, expectedRevision: 1, delivery: "queue" });
    const approved = new Set(), began = Date.now();
    while (Date.now() - began < 60_000) {
      const current = session(), approval = current.pendingApproval;
      if (approval && !approved.has(approval.id)) {
        assert.ok(["read_file", "write_file"].includes(approval.call.name)); assert.equal(approval.call.arguments.path, "fixture.txt");
        approved.add(approval.id);
        await sdk.command({ type: "approval.respond", sessionId: created.id, approvalId: approval.id, allow: true });
      }
      if (!current.turnId && ["completed", "failed", "partial"].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(session().status, "completed", session().lastError ?? "Original worker did not settle.");
    assert.equal(approved.size, 2); assert.equal(provider.requests.length, 0, "Controller inference fallback must not occur.");
    const execution = await waitFor(() => service.controller.snapshot().sandboxExecutions.find((value) => value.sessionId === created.id));
    retained = execution;
    assert.equal(execution.cleanup, "owned-guest-stopped"); assert.equal(execution.workerOutcome, "completed"); assert.equal(execution.cliExitCode, 0);
    const result = (await sdk.sandbox.result(execution.id)).result, calls = (await sdk.budgets.calls({ sessionId: created.id })).calls;
    const totals = (await sdk.budgets.status(created.id)).status.totals;
    assert.equal(result.journal.status, "verified"); assert.equal(calls.length, 4);
    assert.equal(calls.filter((call) => call.role === "solver").length, 3);
    assert.equal(calls.filter((call) => call.role === "title").length, 1);
    for (const call of calls) {
      assert.equal(call.status, "settled"); assert.equal(call.env, "Sandbox"); assert.ok(["solver", "title"].includes(call.role));
      assert.equal(call.reportedTokens, 42); assert.equal(call.inputTokens, 30); assert.equal(call.outputTokens, 12);
      assert.ok(call.reservedTokens > 0); assert.equal(call.estimatedUsdMicros, 54); assert.equal(call.rate.source, "user-estimate");
    }
    assert.equal(totals.calls, 4); assert.equal(totals.reportedTokens, 168); assert.equal(totals.unknownTokenCalls, 0);
    assert.equal(session().title, "Generated native topic summary"); assert.equal(session().titleSource, "model");
    const naming = sdk.sessions.titles(created.id)[0];
    assert.equal(naming.status, "completed"); assert.equal(naming.env, "Sandbox"); assert.ok(naming.actualInputDigest);
    assert.equal(totals.heldTokens, 0); assert.equal(totals.unpricedCalls, 0);
    assert.equal(totals.billedUsd, null); assert.equal(totals.providerReportedUsd, null);
    const events = service.controller.events(0), sessionEvents = events.filter((event) => event.session_id === created.id);
    const starts = sessionEvents.filter((event) => event.event_type === "model.started");
    assert.equal(events.filter((event) => event.event_type === "model.started").length, 4, "No hidden or unaccounted model role belongs in this fixture.");
    assert.equal(starts.length, 4); assert.equal(sessionEvents.filter((event) => event.event_type === "model.completed").length, 4);
    assert.deepEqual(starts.map((event) => event.step_id).sort(), calls.map((call) => call.id).sort());
    const decisions = sessionEvents.filter((event) => event.event_type === "tool.decided");
    assert.equal(decisions.length, 2); assert.ok(decisions.every((event) => event.payload.actor === "user" && event.payload.allow));
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated source original\n");
    assert.equal((await sdk.workspaces.file(created.id, "fixture.txt")).text, "generated native replacement\n");
    const proof = JSON.parse(result.files.find((file) => file.path === "generated-native-proof.json").text);
    assert.equal(proof.calls.length, 4); assert.equal(proof.calls.at(-1).tools.length, 0);
    assert.equal(proof.runId, execution.id); assert.ok(proof.pid > 0);
    const owner = { name: execution.launchName, sessionId: execution.nativeSessionId, workspace: execution.stage.workspace,
      image: execution.image, command: { program: execution.command[0], arguments: execution.command.slice(1) },
      createdAfter: execution.createdAfter };
    owned.push(owner);
    const network = await readNativeNetwork({ ...nativeInput(owner), planDigest: execution.planDigest, signerFingerprint: execution.signerFingerprint });
    const meta = activeMeta(network, execution.networkScope.allowedDomains, Date.parse(execution.createdAt));
    await write("worker-effective-network.json", network);
    await write("worker-events.json", events);
    await write("worker-result.json", result);
    await write("worker-accounting.json", { calls, totals });
    return { managedSetup: { id: setup.id, status: setupOutcome.operation.status, reviewDigest: setupReview.digest,
      distributionDigest: setupReview.distributionDigest, acceptance: setupOutcome.operation.acceptance },
      executionId: execution.id, nativeSessionId: execution.nativeSessionId, planDigest: execution.planDigest,
      signerFingerprint: execution.signerFingerprint, frameCursor: execution.lastSequence, guestGeneratedRequests: proof.calls.length,
      approvedTools: approved.size, starts: starts.length, totals, metaSha256: meta.published_scope.sha256,
      eventsSha256: hash(JSON.stringify(events)), resultSha256: hash(JSON.stringify(result)), scope: execution.networkScope,
      compiledCliReadiness: { ready: cli.sandbox.ready, release: cli.sandbox.release, image: cli.sandbox.image, workerDigest: cli.sandbox.workerDigest },
      sourceUnchanged: true, privateOutputVerified: true, ownedGuestAbsent: ownedGuests(owner).length === 0 };
  } finally {
    await fixture.close(false);
    const executions = service.controller.snapshot().sandboxExecutions;
    for (const execution of executions) if (!owned.some((owner) => owner.name === execution.launchName)) {
      owned.push({ name: execution.launchName, sessionId: execution.nativeSessionId, workspace: execution.stage.workspace, image: execution.image });
    }
    const intents = await readdir(join(fixture.state, "native-executions")).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    for (const id of intents) {
      const intent = JSON.parse(await readFile(join(fixture.state, "native-executions", id, "intent.json"), "utf8"));
      const binding = await readFile(join(fixture.state, "native-executions", id, "bootstrap-owner.json"), "utf8")
        .then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      const existing = owned.find((owner) => owner.name === intent.launchName);
      if (existing && binding) {
        if (existing.sessionId) assert.equal(existing.sessionId, binding.nativeSessionId, "Original guest ownership cannot be replaced during teardown.");
        existing.sessionId = binding.nativeSessionId;
      }
      else if (!existing) owned.push({ name: intent.launchName, sessionId: binding?.nativeSessionId ?? null,
        workspace: intent.stage.workspace, image: intent.config.image });
    }
    report.workerState = { directory: fixture.root, executionId: retained?.id ?? null, generatedOnly: true };
  }
});
await gate("groupedWorkspace", ["installedRuntime", "providerScope"], async () => {
  const installation = join(directory, "group-installation.json"), output = join(directory, "group-result.json");
  await write("group-installation.json", { executable: configuration.executable, bundle: configuration.bundlePath, key: configuration.trustRootPath,
    version: configuration.qualification.release, ...configuration.qualification });
  const childLog = join(directory, "group-test.log");
  let child;
  try {
    child = await promisify(execFile)(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", "tests/sandbox-managed-groups.test.ts"], {
      cwd: process.cwd(), env: { ...env, MOGURI_NATIVE_INSTALLATION: installation, MOGURI_NATIVE_WORKLOAD: resolve(values.workload),
        MOGURI_NATIVE_GROUP_REPORT: output, MOGURI_NATIVE_GROUP_PROVIDER: values.provider },
      encoding: "utf8", timeout: 150_000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    await writeFile(childLog, String(error.stdout ?? "") + String(error.stderr ?? "") + error.message, { flag: "wx", mode: 0o600 });
    throw error;
  }
  await writeFile(childLog, child.stdout + child.stderr, { flag: "wx", mode: 0o600 });
  for (const [key, count] of [["tests", 1], ["pass", 1], ["fail", 0], ["skipped", 0]]) {
    assert.match(child.stdout, new RegExp(`# ${key} ${count}(?:\\r?\\n|$)`), "Actual group execution cannot be substituted by a skipped/generated-only case.");
  }
  const result = JSON.parse(await readFile(output, "utf8")), execution = result.execution;
  assert.equal(result.status, "PASS"); assert.equal(result.ownedGuestAbsent, true);
  assert.equal(execution.workerDigest, configuration.qualification.workerDigest); assert.equal(execution.image, configuration.image);
  const owner = { name: execution.launchName, sessionId: execution.nativeSessionId, workspace: execution.stage.workspace,
    image: execution.image, command: { program: execution.command[0], arguments: execution.command.slice(1) }, createdAfter: execution.createdAfter };
  owned.push(owner);
  const network = await readNativeNetwork({ ...nativeInput(owner), planDigest: execution.planDigest, signerFingerprint: execution.signerFingerprint });
  const meta = activeMeta(network, execution.networkScope.allowedDomains, Date.parse(execution.createdAt));
  await write("group-effective-network.json", network); assert.deepEqual(ownedGuests(owner), []);
  return { executionId: execution.id, nativeSessionId: execution.nativeSessionId, planDigest: execution.planDigest, signerFingerprint: execution.signerFingerprint,
    repositories: execution.repositories, approvedTools: result.approvedTools, totals: result.totals, eventsSha256: hash(JSON.stringify(result.events)),
    resultSha256: hash(JSON.stringify(result.result)), directory: result.directory, explicitPublications: result.explicitPublications.map((record) =>
      ({ id: record.id, repositoryId: record.repositoryId, status: record.status, acceptance: record.acceptance })),
    scope: execution.networkScope, metaSha256: meta.published_scope.sha256, sourceCopiesVerified: true, ownedGuestAbsent: true };
});
await gate("snapshotRetryAndCheckpoints", ["installedRuntime", "groupedWorkspace"], async () => {
  const suites = ["tests/native-retry-restaging.test.ts", "tests/native-checkpoint.test.ts"], log = join(directory, "snapshot-retry-checkpoint-test.log");
  let child;
  try {
    child = await promisify(execFile)(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...suites], {
      cwd: process.cwd(), env: { ...env, MOGURI_NATIVE_INSTALLATION: join(directory, "group-installation.json"), MOGURI_NATIVE_WORKLOAD: resolve(values.workload) },
      encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    await writeFile(log, String(error.stdout ?? "") + String(error.stderr ?? "") + error.message, { flag: "wx", mode: 0o600 }); throw error;
  }
  await writeFile(log, child.stdout + child.stderr, { flag: "wx", mode: 0o600 });
  for (const [key, count] of [["tests", 5], ["pass", 5], ["fail", 0], ["skipped", 0]]) {
    assert.match(child.stdout, new RegExp(`# ${key} ${count}(?:\\r?\\n|$)`), "Private-snapshot retry and accepted-native-work checkpoints require actual current-image execution, not skips.");
  }
  return { suites, cases: 5, skipped: 0, logSha256: hash(child.stdout + child.stderr),
    snapshotOnly: true, explicitRetryPolicy: true, currentRootPolicy: true, originalUnknownChargesRetained: true,
    preparationStopRestartNoReplay: true, separatelyAcceptedNativeSource: true, publicationEnv: "Local", preservedSourceHeadIndex: true,
    partialUserInspectionNeverCompletesJob: true };
});
await gate("teardown", ["installedRuntime", "groupedWorkspace"], async () => {
  const remaining = [];
  for (const owner of owned) {
    assert.match(owner.sessionId ?? "", /^[a-f0-9]{32}$/, "Original guest identity is unconfirmed; a name or absent CLI is not exact teardown evidence.");
    const guests = ownedGuests(owner);
    for (const guest of guests) {
      if (guest.status === "running") run("container", ["stop", "--time", "5", guest.configuration.id], 15_000);
      run("container", ["delete", guest.configuration.id], 15_000);
      remaining.push(guest.configuration.id);
    }
    assert.deepEqual(ownedGuests(owner), [], "Original owned guest remains; private evidence must not be discarded.");
  }
  assert.deepEqual(remaining, [], "Qualification needed corrective guest cleanup; retained failure is not an ordinary teardown pass.");
  return { ownedLaunches: owned.map((owner) => ({ name: owner.name, sessionId: owner.sessionId ?? null })), ownedGuestAbsent: true,
    privateEvidenceRetained: true, sharedImagesRemoved: false };
});
report.status = Object.values(report.gates).every((value) => value.status === "PASS") ? "PASS" : "FAIL";
report.ms = performance.now() - started;
await write("qualification.json", report);
console.log(JSON.stringify({ ...report, directory }, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
