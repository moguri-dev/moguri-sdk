import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const { values } = parseArgs({ options: { build: { type: "boolean" }, tag: { type: "string" } } });
const files = ["package.json", "package-lock.json", "dist/worker.mjs", "dist/remote-bridge.mjs", "dist/mcp-worker.mjs"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const payload = {
  version: JSON.parse(await readFile("package.json", "utf8")).version,
  base: "docker.io/library/node@sha256:2928a235e5af9997b97f8fbe5718cfd40676fc9190b619effc0c0249c41bb4e4",
  files: {},
};
for (const file of files) payload.files[file] = hash(await readFile(file));
await mkdir(".native", { recursive: true, mode: 0o700 });
const context = await mkdtemp(join(resolve(".native"), "worker-image-"));
await mkdir(join(context, "dist"));
for (const file of files) await cp(file, join(context, file));
await cp("scripts/worker-image/Containerfile", join(context, "Containerfile"));
await writeFile(join(context, "payload.json"), JSON.stringify(payload, null, 2), { mode: 0o600 });
const tag = values.tag ?? `docker.io/library/moguri-worker:${payload.version}-${payload.files["dist/worker.mjs"].slice(0, 12)}`;
if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,200}$/.test(tag)) throw new Error("Use a safe local workload image tag. This script never publishes it.");
if (!values.build) {
  console.log(JSON.stringify({ status: "PREPARED", context, tag, payload, qualification: "No build/VM/native SendBox qualification has run." }, null, 2));
} else {
  const started = performance.now();
  const child = spawn("container", ["build", "--no-cache", "--platform", "linux/arm64", "--cpus", "2", "--memory", "2G", "--progress", "plain", "--file", join(context, "Containerfile"), "--tag", tag, context], { stdio: "inherit" });
  const cancel = () => child.kill("SIGTERM");
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }); }
  finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
  if (code !== 0) {
    console.error(JSON.stringify({ status: "FAIL", stage: "No-cache Linux worker image build", context, tag, code, ms: performance.now() - started, qualification: "Sandbox/Remote-Linux remain unqualified; no fallback." }, null, 2));
    process.exitCode = 1;
  } else {
    const images = JSON.parse(execFileSync("container", ["image", "inspect", tag], { encoding: "utf8" }));
    const digest = images[0]?.index?.digest;
    if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Built image did not report an immutable manifest digest; readiness was not claimed.");
    const name = images[0]?.name;
    if (typeof name !== "string") throw new Error("Built image did not report its local repository identity.");
    const image = `${name.replace(/:[^/:]+$/, "")}@${digest}`;
    execFileSync("container", ["image", "tag", tag, image], { stdio: "inherit" });
    const immutable = JSON.parse(execFileSync("container", ["image", "inspect", image], { encoding: "utf8" }));
    if (immutable[0]?.index?.digest !== digest) throw new Error("The immutable local image alias did not verify. No runtime readiness was claimed.");
    const receipt = { status: "PASS", primitive: "No-cache Linux arm64 workload, locked dependencies, compiled native PTY and exact worker payload", context, tag, image, digest, payload, ms: performance.now() - started, qualification: "Image primitive only. Genuine SendBox VM/control/containment and Remote-Linux qualification remain separate." };
    await writeFile(join(context, "qualification.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(receipt, null, 2));
  }
}
