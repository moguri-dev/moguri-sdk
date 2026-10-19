import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { createSshTarget } from "../tests/fixtures/ssh-target.ts";

const directory = await mkdtemp(join(tmpdir(), "moguri-ssh-spike-"));
const execute = promisify(execFile);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const started = performance.now();
let fixture;
const requests = [];
const provider = httpServer((request, response) => {
  requests.push(Number(request.headers["x-generated-worker-pid"]));
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ generated: true }));
});
try {
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
  const providerAddress = provider.address();
  assert.ok(providerAddress && typeof providerAddress !== "string");
  fixture = await createSshTarget(directory);
  const target = fixture.target, knownHosts = join(directory, "known-hosts");
  await writeFile(knownHosts, `[${target.host}]:${target.port} ${target.hostKey}\n`, { mode: 0o600 });
  const args = ["-T", "-F", "/dev/null", "-p", String(target.port), "-l", target.user,
    "-i", target.identityFile, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile="${knownHosts}"`,
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes",
    "-o", "ControlMaster=no", "-o", "ConnectTimeout=3", "127.0.0.1"];
  const code = `const response=await fetch("http://127.0.0.1:${providerAddress.port}/generated",{headers:{"x-generated-worker-pid":String(process.pid)},signal:AbortSignal.timeout(3000)});console.log(JSON.stringify({node:process.versions.node,pid:process.pid,body:await response.json()}));`;
  const command = `${quote(process.execPath)} --input-type=module -e ${quote(code)}`;
  const result = JSON.parse((await execute("ssh", [...args, command], { encoding: "utf8", timeout: 8000 })).stdout);
  assert.equal(result.body.generated, true);
  assert.notEqual(result.pid, process.pid);
  assert.deepEqual(requests, [result.pid]);
  await writeFile(knownHosts, `[${target.host}]:${target.port} ${fixture.incorrectHostKey}\n`);
  await assert.rejects(() => execute("ssh", [...args, command], { timeout: 5000 }));
  assert.equal(requests.length, 1);
  console.log(JSON.stringify({ status: "PASS", primitive: "Actual owned loopback OpenSSH, pinned host identity and inference HTTP originating in its worker process", node: result.node, requests: requests.length, ms: performance.now() - started, boundary: "SSH process on this generated loopback target; not SendBox containment or proof of an external Linux host" }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", primitive: "Actual owned loopback OpenSSH", error: error instanceof Error ? error.message : "SSH qualification failed", ms: performance.now() - started }, null, 2));
  process.exitCode = 1;
} finally {
  await fixture?.close();
  if (provider.listening) await new Promise((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
