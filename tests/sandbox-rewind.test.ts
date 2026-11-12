import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CheckpointWorkspaceSchema, parse, type BudgetEntry, type CheckpointWorkspace, type ModelFailure, type RewindFileDecision } from "../packages/protocol/src/index.ts";
import { SandboxWorkspaces } from "../apps/service/src/sandbox-workspaces.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { nativeRepositoryDirectory, validateNativePrivateEntries, type NativePrivateEntry } from "../apps/service/src/native-staging.ts";
import { retainedModelRequest } from "../apps/service/src/model-recovery.ts";
import { resolveSandboxNetwork } from "../apps/service/src/sandbox-network.ts";
import { privateSource, sandboxFixtureGit as git, sandboxRewindFixture, sandboxSignedFixture } from "./fixtures/sandbox-rewind.ts";

const signal = () => AbortSignal.timeout(30_000);
const file = (workspace: CheckpointWorkspace, path: string) => workspace.roots.flatMap((root) => root.files).find((file) => file.path === path);
const text = (workspace: CheckpointWorkspace, path: string) => Buffer.from(file(workspace, path)!.content, "base64").toString("utf8");
const decisions = (target: CheckpointWorkspace, paths: string[], choice: RewindFileDecision["choice"] = "restore-checkpoint"): RewindFileDecision[] =>
  paths.map((path) => ({ root: target.roots.find((root) => root.files.some((file) => file.path === path))?.binding.root ?? target.roots[0]!.binding.root, path, choice }));

for (const changed of [false, true]) test(`signed terminal capture ${changed ? "rejects a changed" : "accepts the exact reviewed"} selected-provider network specialization`, async () => {
  const f = await sandboxRewindFixture();
  try {
    const config = f.configuration(); config.qualification!.allowCopilot = true; f.configure(config);
    const before = await f.before(), stage = f.state.sandboxWorkspaces![0]!.stage!, original = await privateSource(stage);
    await writeFile(join(stage.workspace, "file.txt"), "Generated signed provider-scoped result.\n");
    const network = await resolveSandboxNetwork(f.configuration(), ["https://api.generated.invalid"], signal(),
      { addresses: async () => ["1.1.1.1"], aliases: async () => [] });
    const signed = await sandboxSignedFixture(f, before.capture.turnId!, original, await privateSource(stage), false, network);
    if (changed) {
      signed.execution.networkScope!.allowedDomains = [...signed.execution.networkScope!.allowedDomains, "unreviewed.invalid"];
      f.commit([{ event_type: "sandbox.execution_recorded", profile_id: "default", session_id: f.session.id, payload: { execution: signed.execution } }]);
    }
    const capture = () => f.read(f.capture("after", before.checkpoint.id, before.capture.turnId!));
    if (changed) await assert.rejects(capture, /reviewed native base|scope/i);
    else assert.equal(text(await capture(), "file.txt"), "Generated signed provider-scoped result.\n");
  } finally { await f.close(); }
});

test("Sandbox BEFORE retains actual idle queue ownership and exact stage before turn/model admission, then reuses that stage", async () => {
  const f = await sandboxRewindFixture();
  try {
    const identity = f.identity(), savedDraft = structuredClone(f.session.draft), originalQueue = structuredClone(f.session.queue);
    const before = await f.before(), workspace = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === f.session.sandboxWorkspaceId)!;
    assert.equal(f.session.turnId, null); assert.equal(workspace.preparation?.kind, "turn-admission");
    assert.equal(workspace.preparation?.version, 4); assert.equal(f.identity(), identity);
    assert.notEqual(before.workspace.roots[0]!.binding.root, f.projects[0]!.path);
    assert.equal(text(before.workspace, "file.txt"), "Generated original 0.\n");
    assert.deepEqual(f.session.draft, savedDraft); assert.deepEqual(f.session.queue, originalQueue);
    assert.equal(f.state.budgetEntries.length, 0); assert.equal(f.state.sandboxExecutions!.length, 0);
    assert.equal(f.store.events().some((event) => ["turn.started", "model.started", "tool.started"].includes(event.event_type)), false);
    await assert.rejects(() => f.workspaces.prepareAutomatic(f.session.id, before.capture.turnId!, signal()), /actual admitted turn|consumed/i);
    const captured = f.state.checkpointCaptures.find((entry) => entry.id === before.capture.id)!;
    f.commit([{ event_type: "checkpoint.capture_recorded", profile_id: "default", session_id: f.session.id,
      payload: { capture: { ...captured, revision: captured.revision + 1, status: "consumed", consumedByEventId: randomUUID() } } }]);
    f.session.turnId = before.capture.turnId;
    const prepared = await f.workspaces.prepareAutomatic(f.session.id, before.capture.turnId!, signal());
    assert.equal(prepared.id, workspace.id); assert.deepEqual(prepared.stage, workspace.stage);
    assert.equal(f.state.sandboxWorkspaces!.length, 1);
    await writeFile(join(f.projects[0]!.path, "file.txt"), "Generated external Local edit.");
    assert.equal(await readFile(join(workspace.stage!.workspace, "file.txt"), "utf8"), "Generated original 0.\n");
  } finally { await f.close(); }
});

for (const kind of ["empty", "group"] as const) test(`Sandbox BEFORE captures the complete ${kind} scope without a Local/first-root fallback`, async () => {
  const f = await sandboxRewindFixture(kind);
  try {
    const before = await f.before();
    if (kind === "empty") {
      assert.equal(before.workspace.roots.length, 1); assert.equal(before.workspace.roots[0]!.key, "sandbox-private");
      assert.equal(before.workspace.bytes, 0); assert.deepEqual(before.workspace.roots[0]!.files, []);
      assert.equal(f.state.sandboxWorkspaces![0]!.sourceRoot, null);
    } else {
      assert.deepEqual(before.workspace.roots.map((root) => root.key), f.projects.map((project) => project.id));
      for (const [index, project] of f.projects.entries()) assert.equal(text(before.workspace, `${nativeRepositoryDirectory(project.id)}/file.txt`), `Generated original ${index}.\n`);
    }
    assert.ok(before.workspace.roots.every((root) => root.binding.root.includes("/native-stages/")));
  } finally { await f.close(); }
});

test("private control capture retains its genuine owner without consuming held ordinary input or pretending a turn already started", async () => {
  const f = await sandboxRewindFixture();
  try {
    f.session.queue[0]!.held = true;
    const turnId = randomUUID(), source = { kind: "control" as const, id: turnId, digest: frameDigest({ purpose: "generated-private-role", turnId }) };
    const capture = f.capture("before", randomUUID(), turnId, source); await f.read(capture);
    const workspace = f.state.sandboxWorkspaces![0]!;
    assert.equal(workspace.preparation?.version, 4);
    if (workspace.preparation?.version === 4) assert.deepEqual(workspace.preparation.source, source);
    assert.equal(f.session.turnId, null); assert.equal(f.session.queue[0]!.held, true); assert.equal(f.session.messages.length, 0);
    assert.equal(f.state.budgetEntries.length, 0);
    await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated reviewed current private source.\n");
    const reviewed = structuredClone(workspace), nextTurnId = randomUUID();
    const next = f.capture("before", randomUUID(), nextTurnId,
      { kind: "control", id: nextTurnId, digest: frameDigest({ purpose: "generated-reviewed-compound", nextTurnId }) });
    const current = await f.read(next);
    assert.equal(f.session.sandboxWorkspaceId, reviewed.id);
    assert.equal(current.boundary?.workspaceId, reviewed.id); assert.equal(current.boundary?.inputDigest, reviewed.inputDigest);
    assert.deepEqual(f.state.sandboxWorkspaces, [reviewed]);
    assert.equal(text(current, "file.txt"), "Generated reviewed current private source.\n");
    const canonical = f.state.checkpointCaptures.find((capture) => capture.id === next.id)!;
    await f.workspaces.validateCheckpointCapture(f.session.id, canonical, current, signal(), () => {});
    await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated later unreviewed private edit.\n");
    await assert.rejects(() => f.workspaces.validateCheckpointCapture(f.session.id, canonical, current, signal(), () => {}), /changed|bytes|file set/i);
    assert.equal(f.session.turnId, null); assert.equal(f.session.queue[0]!.held, true); assert.equal(f.state.budgetEntries.length, 0);
  } finally { await f.close(); }
});

for (const mutation of ["none", "bytes", "file-set", "Git", "stage-inode", "policy", "root", "held", "abort"] as const) {
  test(`captured Sandbox admission validation is read-only and ${mutation === "none" ? "rechecks the exact original selection" : `rejects changed ${mutation}`}`, async () => {
    const f = await sandboxRewindFixture();
    try {
      const before = await f.before(), canonical = f.state.checkpointCaptures.find((capture) => capture.id === before.capture.id)!;
      const stage = f.state.sandboxWorkspaces![0]!.stage!, events = f.store.events().length;
      if (mutation === "bytes") await writeFile(join(stage.workspace, "file.txt"), "Generated mutation while capture waited.");
      if (mutation === "file-set") await writeFile(join(stage.workspace, "added.txt"), "Generated concurrent path.");
      if (mutation === "Git") git(stage.workspace, ["init", "--quiet", "--initial-branch=generated"]);
      if (mutation === "stage-inode") { await rename(stage.workspace, `${stage.workspace}-retained`); await mkdir(stage.workspace, { mode: 0o700 }); }
      if (mutation === "policy") f.state.policy.revision++;
      if (mutation === "root") { await rename(f.projects[0]!.path, `${f.projects[0]!.path}-retained`); await mkdir(f.projects[0]!.path, { mode: 0o700 }); }
      if (mutation === "held") f.session.queue[0]!.held = true;
      const validation = () => f.workspaces.validateCheckpointCapture(f.session.id, canonical, before.workspace,
        mutation === "abort" ? AbortSignal.abort() : signal(), mutation === "policy" ? () => { throw new Error("Generated current policy guard."); } : () => {});
      if (mutation === "none") await validation();
      else await assert.rejects(validation, /changed|owner|queue|source|original|private|policy|abort/i);
      assert.equal(f.store.events().length, events); assert.equal(f.state.sandboxWorkspaces!.length, 1);
      assert.equal(f.session.turnId, null); assert.equal(f.state.budgetEntries.length, 0);
    } finally { await f.close(); }
  });
}

test("canonical capture, exact complete unheld queue, cancellation and parent policy/source checks fail before filesystem admission", async () => {
  for (const mutation of ["missing", "held", "queue-bytes", "phase", "profile", "policy", "root", "abort"] as const) {
    const f = await sandboxRewindFixture();
    try {
      const capture = f.capture("before");
      if (mutation === "missing") f.state.checkpointCaptures = [];
      if (mutation === "held") f.session.queue[0]!.held = true;
      if (mutation === "queue-bytes") f.session.queue[0]!.attachments.push({ kind: "paste_file", id: randomUUID(), name: "generated.txt", digest: "1".repeat(64), bytes: 0 } as never);
      if (mutation === "phase") capture.phase = "current";
      if (mutation === "profile") capture.profileId = "other-generated";
      if (mutation === "policy") f.state.policy.revision++;
      if (mutation === "root") {
        await rename(f.projects[0]!.path, `${f.projects[0]!.path}-original`); await mkdir(f.projects[0]!.path, { mode: 0o700 });
      }
      await assert.rejects(() => f.read(capture, mutation === "abort" ? AbortSignal.abort() : signal()), /capture|queue|source|policy|owner|abort|changed|complete/i);
      assert.equal(f.state.sandboxWorkspaces!.length, 0); assert.equal(f.session.sandboxWorkspaceId, null);
      assert.equal(f.state.budgetEntries.length, 0);
    } finally { await f.close(); }
  }
});

test("legacy Sandbox constructors still work, but new methods require canonical capture and actual-user rewind lookups", async () => {
  const f = await sandboxRewindFixture();
  try {
    const adapter = new SandboxWorkspaces(f.store, f.root, { assertReady: f.configuration }, { ...f.host, capture: undefined, rewind: undefined });
    const before = f.capture("before");
    await assert.rejects(() => adapter.captureCheckpoint(f.session.id, before, signal(), () => {}), /retained capture|owner/i);
    assert.equal(f.state.sandboxWorkspaces!.length, 0); await adapter.close();
    const actual = await f.before(), current = await f.current(), plan = decisions(actual.workspace, ["file.txt"]);
    const operation = f.operation(actual.checkpoint, actual.workspace, current, plan);
    await assert.rejects(() => adapter.prepareCheckpointRewind(f.session.id, operation.id, actual.checkpoint.id, current, actual.workspace, plan, signal(), () => {}), /canonical.*missing/i);
    assert.equal(f.state.sandboxWorkspaces!.length, 1);
    assert.equal(frameDigest(f.workspaces.checkpointIdentity(f.session)), frameDigest(adapter.checkpointIdentity(f.session)));
  } finally { await f.close(); }
});

for (const kind of ["empty", "group"] as const) test(`reviewed ${kind} Sandbox restore uses a fresh exact private stage and retains unrelated current files`, async () => {
  const f = await sandboxRewindFixture(kind);
  try {
    const before = await f.before(), original = f.state.sandboxWorkspaces![0]!.stage!, paths = kind === "empty" ? ["generated.txt"] :
      f.projects.map((project) => `${nativeRepositoryDirectory(project.id)}/file.txt`);
    for (const path of paths) await writeFile(join(original.workspace, path), "Generated current changed private file.");
    const unrelated = kind === "empty" ? "unrelated.txt" : `${nativeRepositoryDirectory(f.projects[0]!.id)}/unrelated.txt`;
    await writeFile(join(original.workspace, unrelated), "Generated unrelated private data.");
    const current = await f.current(), chosen = decisions(before.workspace, paths), record = f.operation(before.checkpoint, before.workspace, current, chosen, paths);
    const result = await f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, signal(), () => {});
    f.commit(result.events); const next = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === result.workspaceId)!.stage!;
    if (kind === "empty") await assert.rejects(() => lstat(join(next.workspace, "generated.txt")), /ENOENT/);
    else for (const [index, path] of paths.entries()) assert.equal(await readFile(join(next.workspace, path), "utf8"), `Generated original ${index}.\n`);
    assert.equal(await readFile(join(next.workspace, unrelated), "utf8"), "Generated unrelated private data.");
    assert.equal(await readFile(join(original.workspace, paths[0]!), "utf8"), "Generated current changed private file.");
  } finally { await f.close(); }
});

test("Sandbox restore is binary/mode exact, preserves inert private Git pointers and linked/ignored data, and never executes configuration", async () => {
  const f = await sandboxRewindFixture();
  try {
    await f.before(); const original = f.state.sandboxWorkspaces![0]!.stage!, root = original.workspace;
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 0xff, 0x80, 0x13])); await chmod(join(root, "binary.dat"), 0o751);
    const before = await f.before();
    git(root, ["init", "--quiet", "--initial-branch=generated"]); git(root, ["add", "--", "file.txt"]);
    git(root, ["commit", "--quiet", "-m", "Generated retained pointer history"]);
    await rename(join(root, ".git"), join(root, "private-git-data")); await writeFile(join(root, ".git"), "gitdir: private-git-data\n");
    const index = await readFile(join(root, "private-git-data", "index")), head = git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(join(root, "ignored.txt"), "Generated ignored external contents.");
    await symlink("ignored.txt", join(root, "linked.txt"));
    await writeFile(join(root, "binary.dat"), Buffer.from([0x41, 0x42])); await chmod(join(root, "binary.dat"), 0o640);
    const current = await f.current();
    assert.ok(current.roots[0]!.excluded.includes("private-git-data")); assert.ok(current.roots[0]!.excluded.includes("linked.txt"));
    assert.equal(current.roots[0]!.files.some((file) => file.path.startsWith("private-git-data/")), false);
    const chosen = decisions(before.workspace, ["binary.dat"]), record = f.operation(before.checkpoint, before.workspace, current, chosen, ["binary.dat"]);
    const result = await f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, signal(), () => {});
    f.commit(result.events); const next = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === result.workspaceId)!.stage!.workspace;
    assert.deepEqual(await readFile(join(next, "binary.dat")), Buffer.from([0, 0xff, 0x80, 0x13]));
    assert.equal((await lstat(join(next, "binary.dat"))).mode & 0o777, 0o751);
    assert.deepEqual(await readFile(join(next, "private-git-data", "index")), index); assert.equal(git(next, ["rev-parse", "HEAD"]), head);
    assert.equal(await readFile(join(next, "ignored.txt"), "utf8"), "Generated ignored external contents.");
    assert.equal((await lstat(join(next, "linked.txt"))).isSymbolicLink(), true);
  } finally { await f.close(); }
});

test("nested Git data and fixed native /workspace pointers remain private and byte-exact through fresh-stage restoration", async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), root = f.state.sandboxWorkspaces![0]!.stage!.workspace, nested = join(root, "nested");
    await mkdir(nested, { mode: 0o700 }); await writeFile(join(nested, "generated.txt"), "Generated nested working file.");
    git(nested, ["init", "--quiet", "--initial-branch=generated"]); git(nested, ["add", "--", "generated.txt"]);
    git(nested, ["commit", "--quiet", "-m", "Generated retained nested history"]);
    await rename(join(nested, ".git"), join(nested, "private-git-data"));
    await writeFile(join(nested, ".git"), "gitdir: /workspace/nested/private-git-data\n");
    const index = await readFile(join(nested, "private-git-data", "index"));
    await writeFile(join(root, "file.txt"), "Generated external chosen conflict.");
    const current = await f.current();
    assert.ok(current.roots[0]!.excluded.includes("nested/private-git-data"));
    assert.equal(current.roots[0]!.files.some((file) => file.path.startsWith("nested/private-git-data/")), false);
    assert.equal(text(current, "nested/generated.txt"), "Generated nested working file.");
    const chosen = decisions(before.workspace, ["file.txt"]), record = f.operation(before.checkpoint, before.workspace, current, chosen);
    const result = await f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, signal(), () => {});
    f.commit(result.events); const next = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === result.workspaceId)!.stage!.workspace;
    assert.equal(await readFile(join(next, "nested", ".git"), "utf8"), "gitdir: /workspace/nested/private-git-data\n");
    assert.deepEqual(await readFile(join(next, "nested", "private-git-data", "index")), index);
    assert.equal(await readFile(join(next, "nested", "generated.txt"), "utf8"), "Generated nested working file.");
  } finally { await f.close(); }
});

test("complete Sandbox capture refuses resource overflow and treats excluded paths as unknown, never as absent restore content", async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), root = f.state.sandboxWorkspaces![0]!.stage!.workspace;
    await writeFile(join(root, "oversized.bin"), Buffer.alloc(2 * 1024 * 1024 + 1, 0x81));
    await assert.rejects(() => f.current(), /complete.*2,000 files|2 MiB|subset/i);
    await rm(join(root, "oversized.bin")); await writeFile(join(root, ".gitignore"), "file.txt\n");
    const current = await f.current();
    assert.equal(file(current, "file.txt"), undefined); assert.ok(current.roots[0]!.excluded.includes("file.txt"));
    const chosen = decisions(before.workspace, ["file.txt"]), record = f.operation(before.checkpoint, before.workspace, current, chosen);
    await assert.rejects(() => f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, signal(), () => {}), /excluded.*not absent|excluded dependency/i);
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "Generated original 0.\n");
    assert.equal(f.state.sandboxWorkspaces!.length, 1);
  } finally { await f.close(); }
});

test("private metadata/path sets have an aggregate bound independent of zero-byte regular-file data", () => {
  const entries: NativePrivateEntry[] = [], parts: string[] = [];
  for (let index = 0; index < 40; index++) {
    parts.push("g".repeat(80)); entries.push({ path: parts.join("/"), type: "directory", mode: 0o700 });
  }
  for (let index = 0; index < 5200; index++) entries.push({ path: `${parts.join("/")}/${index}.txt`, type: "regular",
    mode: 0o600, digest: frameDigest("generated-empty"), bytes: 0 });
  assert.throws(() => validateNativePrivateEntries(entries), /metadata exceeds 16 MiB.*No paths/i);
});

test("private rewind preserves external/untracked/staged Git state and binary/mode bytes, never touches the original checkout, and publishes binding only through returned events", async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), originalId = f.session.sandboxWorkspaceId!, original = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === originalId)!.stage!;
    const root = original.workspace;
    const accounting: BudgetEntry[] = (["settled", "unknown"] as const).map((status) => ({ id: randomUUID(), sessionId: f.session.id,
      ownerSessionId: f.session.id, projectId: f.session.projectId, folderId: null, turnId: before.capture.turnId, modelId: "generated-model",
      providerId: "generated-provider", apiModelId: null, role: "solver", env: "Sandbox", createdAt: new Date().toISOString(), imported: false,
      status, inputEstimate: 10, outputLimit: 32, reservedTokens: 42, reportedTokens: status === "settled" ? 42 : null,
      reservedUsdMicros: 100, estimatedUsdMicros: status === "settled" ? 70 : null, rate: null, requestMs: 1,
      outcome: status === "settled" ? "completed" : "unknown", diagnostic: null }));
    f.state.budgetEntries = structuredClone(accounting);
    git(root, ["init", "--quiet", "--initial-branch=generated"]);
    git(root, ["add", "--", "file.txt", "keep.txt"]); git(root, ["commit", "--quiet", "-m", "Generated retained history"]);
    await writeFile(join(root, "unrelated-staged.txt"), "Generated external staged bytes.\n"); git(root, ["add", "--", "unrelated-staged.txt"]);
    await writeFile(join(root, "untracked.txt"), "Generated external untracked bytes.\n");
    await writeFile(join(root, "file.txt"), "Generated current external conflict.\n"); await chmod(join(root, "file.txt"), 0o751);
    await writeFile(join(root, "keep.txt"), "Generated keep-current conflict.\n");
    await mkdir(join(root, "node_modules"), { mode: 0o700 }); await writeFile(join(root, "node_modules", "generated.bin"), Buffer.from([0, 0xff, 0x80]));
    await writeFile(join(root, ".env"), "GENERATED_PRIVATE_NOT_CONTEXT=1");
    const hook = join(root, ".git", "hooks", "post-checkout");
    await mkdir(join(root, ".git", "hooks"), { recursive: true, mode: 0o700 });
    await writeFile(hook, "#!/bin/sh\nexit 91\n", { mode: 0o700 });
    const head = git(root, ["rev-parse", "HEAD"]), index = await readFile(join(root, ".git", "index"));
    const current = await f.current(), plan = decisions(before.workspace, ["file.txt"]).concat(decisions(before.workspace, ["keep.txt"], "keep-current"));
    const retainedWriter = await open(join(root, "file.txt"), "r+");
    assert.equal(current.roots[0]!.git!.head, head);
    assert.ok(current.roots[0]!.excluded.includes(".git")); assert.ok(current.roots[0]!.excluded.includes("node_modules"));
    assert.equal(JSON.stringify(current).includes("GENERATED_PRIVATE_NOT_CONTEXT"), false);
    const record = f.operation(before.checkpoint, before.workspace, current, plan, ["file.txt", "keep.txt"]);
    const result = await f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, plan, signal(), () => {});
    assert.equal(f.session.sandboxWorkspaceId, originalId); assert.equal(f.state.sandboxWorkspaces!.find((workspace) => workspace.id === result.workspaceId)!.status, "preparing");
    const ready = result.events.find((event) => event.event_type === "sandbox.workspace_recorded")!;
    assert.equal(ready.event_type, "sandbox.workspace_recorded");
    if (ready.event_type !== "sandbox.workspace_recorded") return;
    const next = ready.payload.workspace.stage!.workspace;
    assert.notEqual(next, root); assert.equal(await readFile(join(next, "file.txt"), "utf8"), "Generated original 0.\n");
    assert.equal((await lstat(join(next, "file.txt"))).mode & 0o777, file(before.workspace, "file.txt")!.mode);
    assert.equal(await readFile(join(next, "keep.txt"), "utf8"), "Generated keep-current conflict.\n");
    assert.equal(await readFile(join(next, "untracked.txt"), "utf8"), "Generated external untracked bytes.\n");
    assert.equal(await readFile(join(next, "unrelated-staged.txt"), "utf8"), "Generated external staged bytes.\n");
    assert.deepEqual(await readFile(join(next, "node_modules", "generated.bin")), Buffer.from([0, 0xff, 0x80]));
    assert.equal(await readFile(join(next, ".env"), "utf8"), "GENERATED_PRIVATE_NOT_CONTEXT=1");
    assert.equal(await readFile(join(next, ".git", "hooks", "post-checkout"), "utf8"), "#!/bin/sh\nexit 91\n");
    assert.equal(git(next, ["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(next, ".git", "index")), index);
    assert.equal(git(next, ["show", "HEAD:file.txt"]), "Generated original 0.");
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "Generated current external conflict.\n");
    assert.equal(await readFile(join(f.projects[0]!.path, "file.txt"), "utf8"), "Generated original 0.\n");
    assert.equal(result.results[0]!.files[0]!.backupDigest, file(current, "file.txt")!.digest);
    assert.equal(await readFile(result.results[0]!.files[0]!.backup!, "utf8"), "Generated current external conflict.\n");
    f.commit(result.events); assert.equal(f.session.sandboxWorkspaceId, result.workspaceId);
    await retainedWriter.write(Buffer.from("Generated late writer"), 0, Buffer.byteLength("Generated late writer"), 0); await retainedWriter.close();
    assert.match(await readFile(join(root, "file.txt"), "utf8"), /^Generated late writer/);
    assert.equal(await readFile(join(next, "file.txt"), "utf8"), "Generated original 0.\n");
    assert.equal(f.identity(), before.capture.identityDigest); assert.deepEqual(f.state.budgetEntries, accounting);
    const inspection = await f.workspaces.inspectCheckpointRewind(f.session.id, record.id);
    assert.equal(inspection.stageBound, true); assert.equal(inspection.effects[0]!.backupDigest, file(current, "file.txt")!.digest);
    await assert.rejects(() => f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, plan, signal(), () => {}), /replay|already retained/i);
  } finally { await f.close(); }
});

test("CURRENT retains signed rollback work and external private edits, and next BEFORE restages that exact tree without paid/tool replay", async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), workspace = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === f.session.sandboxWorkspaceId)!;
    const original = await privateSource(workspace.stage!);
    await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated signed worker modification.\n");
    await writeFile(join(workspace.stage!.workspace, "worker-only.txt"), "Generated signed worker addition.\n");
    git(workspace.stage!.workspace, ["init", "--quiet", "--initial-branch=generated"]);
    git(workspace.stage!.workspace, ["add", "--", "file.txt"]); git(workspace.stage!.workspace, ["commit", "--quiet", "-m", "Generated retained worker history"]);
    const head = git(workspace.stage!.workspace, ["rev-parse", "HEAD"]), index = await readFile(join(workspace.stage!.workspace, ".git", "index"));
    const signed = await sandboxSignedFixture(f, before.capture.turnId!, original, await privateSource(workspace.stage!), true);
    await rename(workspace.stage!.workspace, join(workspace.stage!.directory, "retained-actual-after"));
    await mkdir(workspace.stage!.workspace, { mode: 0o700 });
    for (const entry of original.entries) if (entry.type === "regular") await writeFile(join(workspace.stage!.workspace, entry.path), await original.read(entry.path), { mode: entry.mode });
    await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated external edit after rollback.\n");
    await writeFile(join(workspace.stage!.workspace, "external-only.txt"), "Generated external addition after rollback.\n");
    f.commit(f.workspaces.invalidate(workspace.id, "Generated verified rollback replacement."));
    const current = await f.current(), repeated = await f.current();
    assert.equal(text(current, "file.txt"), "Generated external edit after rollback.\n");
    assert.equal(text(current, "worker-only.txt"), "Generated signed worker addition.\n");
    assert.equal(text(current, "external-only.txt"), "Generated external addition after rollback.\n");
    assert.equal(current.boundary!.afterId, signed.afterId); assert.equal(current.digest, repeated.digest);
    assert.equal(current.roots[0]!.git!.head, head);
    const following = await f.before(), ready = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === f.session.sandboxWorkspaceId)!;
    assert.notEqual(ready.id, workspace.id); assert.equal(ready.preparation?.kind, "turn-admission");
    assert.equal(text(following.workspace, "file.txt"), "Generated external edit after rollback.\n");
    assert.equal(text(following.workspace, "worker-only.txt"), "Generated signed worker addition.\n");
    assert.equal(text(following.workspace, "external-only.txt"), "Generated external addition after rollback.\n");
    assert.deepEqual(await readFile(join(ready.stage!.workspace, ".git", "index")), index);
    assert.equal(git(ready.stage!.workspace, ["rev-parse", "HEAD"]), head);
    assert.equal(f.identity(), before.capture.identityDigest); assert.equal(f.state.sandboxExecutions!.length, 1);
    assert.equal(f.state.budgetEntries.length, 0);
    assert.ok(await lstat(join(workspace.stage!.directory, "retained-actual-after")));
  } finally { await f.close(); }
});

test("reviewed private restore maps stable logical roots across legitimate stage replacement, not historical directory/inode aliases", async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), initial = f.state.sandboxWorkspaces![0]!, original = await privateSource(initial.stage!);
    await writeFile(join(initial.stage!.workspace, "file.txt"), "Generated signed work before stage replacement.");
    await sandboxSignedFixture(f, before.capture.turnId!, original, await privateSource(initial.stage!), true);
    await rename(initial.stage!.workspace, join(initial.stage!.directory, "retained-actual-after"));
    await mkdir(initial.stage!.workspace, { mode: 0o700 });
    for (const entry of original.entries) if (entry.type === "regular") await writeFile(join(initial.stage!.workspace, entry.path), await original.read(entry.path), { mode: entry.mode });
    f.commit(f.workspaces.invalidate(initial.id, "Generated owned rollback."));
    const next = f.capture("before"); await f.read(next);
    const orphan = f.state.checkpointCaptures.find((capture) => capture.id === next.id)!;
    f.commit([{ event_type: "checkpoint.capture_recorded", profile_id: "default", session_id: f.session.id,
      payload: { capture: { ...orphan, revision: orphan.revision + 1, status: "partial", diagnostic: "Generated original turn was not admitted." } } }]);
    const current = await f.current();
    assert.notEqual(current.roots[0]!.binding.root, before.workspace.roots[0]!.binding.root);
    assert.equal(current.roots[0]!.key, before.workspace.roots[0]!.key);
    const chosen = decisions(current, ["file.txt"]), record = f.operation(before.checkpoint, before.workspace, current, chosen, ["file.txt"], "current");
    const result = await f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, signal(), () => {});
    f.commit(result.events);
    const restored = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === result.workspaceId)!.stage!;
    assert.equal(await readFile(join(restored.workspace, "file.txt"), "utf8"), "Generated original 0.\n");
    assert.equal(await readFile(join(current.roots[0]!.binding.root, "file.txt"), "utf8"), "Generated signed work before stage replacement.");
    assert.equal(f.identity(), before.capture.identityDigest);
  } finally { await f.close(); }
});

test("retry BEFORE keeps the actual failure/signed snapshot owner and exact Git/mode bytes, then transfers only the unchanged stage to the real retry attempt", async () => {
  const f = await sandboxRewindFixture();
  try {
    f.state.settings.values.interactions.nativeRetryRestaging = true; f.session.controls.modelId = "generated-model";
    const before = await f.before(), initial = f.state.sandboxWorkspaces![0]!, original = await privateSource(initial.stage!);
    await writeFile(join(initial.stage!.workspace, "file.txt"), "Generated original signed retry bytes.\n"); await chmod(join(initial.stage!.workspace, "file.txt"), 0o751);
    git(initial.stage!.workspace, ["init", "--quiet", "--initial-branch=generated"]); git(initial.stage!.workspace, ["add", "--", "file.txt"]);
    git(initial.stage!.workspace, ["commit", "--quiet", "-m", "Generated retained retry history"]);
    const head = git(initial.stage!.workspace, ["rev-parse", "HEAD"]), index = await readFile(join(initial.stage!.workspace, ".git", "index"));
    const signed = await sandboxSignedFixture(f, before.capture.turnId!, original, await privateSource(initial.stage!), true);
    const request = retainedModelRequest({ version: 2, profileId: "default", sessionId: f.session.id, turnId: before.capture.turnId!,
      sourceStepId: randomUUID(), modelId: "generated-model", modelBindingDigest: "1".repeat(64), boundaryDigest: "2".repeat(64),
      controls: f.session.controls, authorizationRevision: 0, endpoint: "https://generated.invalid", api: "generated",
      systemPrompt: "Generated immutable original.", tools: [], toolCatalog: [], maxTokens: 32, contextWindow: 8192,
      loadedTools: [], instructionSources: [], mode: "agent", folders: { denied: [], readOnly: [] }, context: [],
      nativeOrigin: { executionId: signed.execution.id, workspaceId: initial.id, inputDigest: initial.inputDigest, root: initial.stage!.workspace } });
    const now = new Date().toISOString(), failure: ModelFailure = { id: randomUUID(), revision: 0, profileId: "default", sessionId: f.session.id,
      projectId: f.session.projectId, turnId: before.capture.turnId!, sourceStepId: request.sourceStepId, requestDigest: f.store.putBlob(JSON.stringify(request)),
      promptSequence: 1, failedAt: now, updatedAt: now, retryable: true, lastRetryable: true, status: "pending", attemptId: null,
      attemptStepId: null, attemptCount: 0, diagnostic: "Generated original retry failure." };
    f.commit([{ event_type: "model.failure_recorded", profile_id: "default", session_id: f.session.id, payload: { failure } }]);
    await writeFile(join(initial.stage!.workspace, "file.txt"), "Generated external private bytes stay in original stage.");
    const attemptId = randomUUID(), capture = f.capture("before", randomUUID(), failure.turnId,
      { kind: "retry", id: attemptId, digest: failure.requestDigest! });
    const captured = await f.read(capture), prepared = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === f.session.sandboxWorkspaceId)!;
    assert.equal(f.session.turnId, null); assert.equal(prepared.preparation?.version, 4);
    assert.equal(text(captured, "file.txt"), "Generated original signed retry bytes.\n"); assert.equal(file(captured, "file.txt")!.mode, 0o751);
    assert.equal(captured.boundary!.executionId, signed.execution.id); assert.equal(captured.boundary!.afterId, signed.afterId);
    assert.equal(await readFile(join(initial.stage!.workspace, "file.txt"), "utf8"), "Generated external private bytes stay in original stage.");
    assert.equal(f.workspaces.retrySource(f.session, f.state.modelFailures[0]!, request).id, signed.execution.id);
    const pending = f.state.checkpointCaptures.find((entry) => entry.id === capture.id)!;
    await f.workspaces.validateCheckpointCapture(f.session.id, pending, captured, signal(), () => {});
    const retrying: ModelFailure = { ...failure, revision: 1, status: "retrying", attemptId, attemptCount: 1 };
    f.commit([{ event_type: "model.failure_recorded", profile_id: "default", session_id: f.session.id, payload: { failure: retrying } },
      { event_type: "checkpoint.capture_recorded", profile_id: "default", session_id: f.session.id,
        payload: { capture: { ...pending, revision: pending.revision + 1, status: "consumed", consumedByEventId: randomUUID() } } }]);
    f.session.turnId = failure.turnId;
    const actual = await f.workspaces.prepareRetry(f.session.id, retrying, request, signal());
    assert.equal(actual.preparation?.version, 4); assert.equal(actual.preparation?.kind, "turn-admission");
    assert.equal(actual.id, prepared.id); assert.deepEqual(actual.preparation, prepared.preparation);
    assert.deepEqual(actual.stage, prepared.stage); assert.equal(actual.inputDigest, prepared.inputDigest);
    assert.equal(git(actual.stage!.workspace, ["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(actual.stage!.workspace, ".git", "index")), index);
    f.workspaces.retryCurrent(f.session, retrying, request);
    assert.equal(f.state.sandboxExecutions!.length, 1); assert.equal(f.state.budgetEntries.length, 0);
    await assert.rejects(() => f.read(f.capture("after", capture.checkpointId, failure.turnId)), /previous retry|selected private workspace|actual terminal owner/i);
  } finally { await f.close(); }
});

for (const mutation of ["unknown-cleanup", "missing-result", "wrong-input", "wrong-signer", "wrong-build", "missing-signed-after"] as const) {
  test(`AFTER/current refuses ${mutation} without capturing today's files or launching a replacement`, async () => {
    const f = await sandboxRewindFixture();
    try {
      const before = await f.before(), workspace = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === f.session.sandboxWorkspaceId)!;
      const original = await privateSource(workspace.stage!); await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated signed terminal bytes.");
      const signed = await sandboxSignedFixture(f, before.capture.turnId!, original, await privateSource(workspace.stage!), false);
      const execution = f.state.sandboxExecutions![0]!;
      if (mutation === "unknown-cleanup") execution.cleanup = "acknowledged";
      if (mutation === "missing-result") execution.resultDigest = null;
      if (mutation === "wrong-input") execution.inputDigest = "0".repeat(64);
      if (mutation === "wrong-signer") execution.signerFingerprint = "0".repeat(64);
      if (mutation === "wrong-build") execution.workerDigest = "0".repeat(64);
      if (mutation === "missing-signed-after") await rm(join(signed.root, "snapshots", "manifests", `${signed.afterId}.json`));
      await assert.rejects(() => f.read(f.capture("after", before.checkpoint.id, before.capture.turnId)), /native|original|snapshot|result|owner|verified/i);
      await assert.rejects(() => f.current(), /native|original|snapshot|result|owner|verified|cleanup/i);
      assert.equal(f.state.sandboxWorkspaces!.length, 1); assert.equal(f.state.sandboxExecutions!.length, 1);
    } finally { await f.close(); }
  });
}

for (const mutation of ["source-root", "native-build", "folder-policy", "external-file", "unconfirmed-guest", "not-user", "forged-decisions", "missing-target"] as const) {
  test(`reviewed Sandbox restore rejects ${mutation} before private publication and preserves original state`, async () => {
    const f = await sandboxRewindFixture();
    try {
      const before = await f.before(), workspace = f.state.sandboxWorkspaces![0]!, originalId = f.session.sandboxWorkspaceId;
      await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated external original conflict.");
      const current = await f.current(), chosen = decisions(before.workspace, ["file.txt"]);
      const record = f.operation(before.checkpoint, before.workspace, current, chosen);
      if (mutation === "source-root") {
        await rename(f.projects[0]!.path, `${f.projects[0]!.path}-original`); await mkdir(f.projects[0]!.path, { mode: 0o700 });
      }
      if (mutation === "native-build") { const config = f.configuration(); config.qualification!.workerDigest = "9".repeat(64); f.configure(config); }
      if (mutation === "folder-policy") f.projectSettings.get(f.projects[0]!.id)!.readOnlyFolders.push("file.txt");
      if (mutation === "external-file") await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated newer external edit.");
      if (mutation === "unconfirmed-guest") f.state.sandboxExecutions!.push({ sessionId: f.session.id, cleanup: "unconfirmed" } as never);
      if (mutation === "not-user") (f.state.rewinds[0] as unknown as { actor: string }).actor = "model";
      if (mutation === "missing-target") f.state.checkpoints = [];
      const supplied = mutation === "forged-decisions" ? decisions(before.workspace, ["file.txt"], "keep-current") : chosen;
      await assert.rejects(() => f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, supplied, signal(), () => {}),
        /schema|policy|review|owner|source|original|changed|root|native|canonical|read.only|current|cleanup/i);
      assert.equal(f.session.sandboxWorkspaceId, originalId); assert.equal(f.state.sandboxWorkspaces!.length, 1);
      assert.equal(await readFile(join(workspace.stage!.workspace, "file.txt"), "utf8"), mutation === "external-file" ? "Generated newer external edit." : "Generated external original conflict.");
      assert.equal(f.state.budgetEntries.length, 0);
    } finally { await f.close(); }
  });
}

test("a native rewind rejected before private preparation remains inspectable after restart without fabricating effects or success", async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), originalId = f.session.sandboxWorkspaceId!;
    const stage = f.state.sandboxWorkspaces![0]!.stage!;
    await writeFile(join(stage.workspace, "file.txt"), "Generated current external work stays untouched.");
    const current = await f.current(), chosen = decisions(before.workspace, ["file.txt"]);
    const record = f.operation(before.checkpoint, before.workspace, current, chosen);
    const configuration = f.configuration(); configuration.qualification!.workerDigest = "9".repeat(64); f.configure(configuration);
    await assert.rejects(() => f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id,
      current, before.workspace, chosen, signal(), () => {}), /native|changed|source|original/);
    f.commit([{ event_type: "rewind.recorded", profile_id: "default", session_id: f.session.id,
      payload: { record: { ...record, revision: 1, status: "partial", quarantined: true, diagnostic: "Generated pre-copy refusal." } } }]);
    await f.restart();
    const events = f.store.events().length;
    const inspected = await f.workspaces.inspectCheckpointRewind(f.session.id, record.id);
    assert.equal(inspected.status, "not-prepared");
    assert.deepEqual(inspected.effects, []);
    assert.equal(inspected.stageBound, false);
    assert.equal(f.store.events().length, events);
    assert.equal(f.state.rewinds[0]?.status, "partial");
    assert.equal(f.state.rewinds[0]?.quarantined, true);
    assert.equal(f.session.sandboxWorkspaceId, originalId);
    assert.equal(f.state.sandboxWorkspaces!.length, 1);
    assert.equal(await readFile(join(stage.workspace, "file.txt"), "utf8"), "Generated current external work stays untouched.");
    await assert.rejects(() => f.workspaces.inspectCheckpointRewind(f.session.id, randomUUID()), /exact retained|missing/);
    f.state.sandboxWorkspaces!.push({ ...f.state.sandboxWorkspaces![0]!, id: randomUUID(), sessionId: randomUUID(),
      preparation: { version: 5, kind: "checkpoint-rewind", operationId: record.id, checkpointId: before.checkpoint.id,
        priorWorkspaceId: originalId, currentDigest: current.digest, targetDigest: before.workspace.digest, backupStageId: randomUUID(),
        backupSourceDigest: current.digest, restoreSourceDigest: before.workspace.digest, identityDigest: record.identityDigest,
        sourceDigest: current.boundary!.sourceDigest, policyDigest: current.digest } });
    await assert.rejects(() => f.workspaces.inspectCheckpointRewind(f.session.id, record.id), /conflicting ownership/);
  } finally { await f.close(); }
});

for (const failure of ["cancel", "concurrent-file", "copy", "persist"] as const) test(`Sandbox ${failure} failure retains original and partial new stages; restart inspects but never copies/binds/replays`, async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), originalId = f.session.sandboxWorkspaceId!, original = f.state.sandboxWorkspaces![0]!.stage!;
    await writeFile(join(original.workspace, "file.txt"), "Generated current retained conflict.");
    const current = await f.current(), chosen = decisions(before.workspace, ["file.txt"]), record = f.operation(before.checkpoint, before.workspace, current, chosen);
    const abort = new AbortController(); let attempted = false;
    f.onCommit((events) => {
      const intent = events.find((event) => event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.preparation?.version === 5 &&
        event.payload.workspace.status === "preparing");
      if (!intent || intent.event_type !== "sandbox.workspace_recorded") return;
      attempted = true;
      if (failure === "cancel") abort.abort();
      if (failure === "concurrent-file") writeFileSync(join(original.workspace, "file.txt"), "Generated concurrent writer retained.");
      if (failure === "copy") {
        const owner = intent.payload.workspace.preparation!;
        if (owner.version === 5) {
          const path = join(f.root, "native-stage-root", "native-stages", "default", owner.backupStageId);
          mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, "generated-retained-poison"), "Generated exact collision.");
        }
      }
    });
    if (failure === "persist") {
      const prepared = await f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, abort.signal, () => {});
      assert.equal(f.session.sandboxWorkspaceId, originalId);
      f.store.db.exec("CREATE TRIGGER generated_sandbox_rewind_failure BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'Generated completion persistence failure'); END");
      assert.throws(() => f.commit(prepared.events), /persistence failure/); f.store.db.exec("DROP TRIGGER generated_sandbox_rewind_failure");
    } else await assert.rejects(() => f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, abort.signal, () => {}), /abort|changed|partial|original|EEXIST/i);
    f.onCommit(); assert.equal(attempted, true); assert.equal(f.session.sandboxWorkspaceId, originalId);
    const pending = f.state.sandboxWorkspaces!.find((workspace) => workspace.preparation?.version === 5)!;
    assert.ok(["preparing", "partial"].includes(pending.status));
    const originalEvents = f.store.events().length;
    await f.restart(); f.commit(f.workspaces.recover());
    const recovered = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === pending.id)!;
    assert.equal(recovered.status, "partial"); assert.equal(f.session.sandboxWorkspaceId, originalId);
    assert.equal(f.state.budgetEntries.length, 0); assert.equal(f.state.sandboxExecutions!.length, 0);
    assert.ok(f.store.events().length >= originalEvents);
    assert.ok((await readdir(join(f.root, "native-stage-root", "native-stages", "default"))).includes(original.turnId));
    await assert.rejects(() => f.workspaces.prepareCheckpointRewind(f.session.id, record.id, before.checkpoint.id, current, before.workspace, chosen, signal(), () => {}), /already retained|replay/);
    if (failure !== "copy") {
      const inspect = await f.workspaces.inspectCheckpointRewind(f.session.id, record.id);
      assert.equal(inspect.stageBound, false); assert.equal(inspect.status, "partial");
      assert.equal((await f.workspaces.inspectCheckpointRewind(f.session.id, record.id)).digest, inspect.digest);
    }
    assert.equal(await readFile(join(original.workspace, "file.txt"), "utf8"), failure === "concurrent-file" ?
      "Generated concurrent writer retained." : "Generated current retained conflict.");
  } finally { await f.close(); }
});

test("signed actual AFTER differs from rolled-back host bytes, supports binary regular files, and remains forensic after allowed-env hardening", async () => {
  const f = await sandboxRewindFixture();
  try {
    const before = await f.before(), workspace = f.state.sandboxWorkspaces!.find((workspace) => workspace.id === f.session.sandboxWorkspaceId)!;
    const original = await privateSource(workspace.stage!);
    await writeFile(join(workspace.stage!.workspace, "file.txt"), "Generated actual worker after.\n");
    await writeFile(join(workspace.stage!.workspace, "generated.bin"), Buffer.from([0, 0xff, 0x80, 0x41])); await chmod(join(workspace.stage!.workspace, "generated.bin"), 0o751);
    const after = await privateSource(workspace.stage!), signed = await sandboxSignedFixture(f, before.capture.turnId!, original, after, true);
    await rename(workspace.stage!.workspace, join(workspace.stage!.directory, "retained-actual-after"));
    await mkdir(workspace.stage!.workspace, { mode: 0o700 });
    for (const entry of original.entries) if (entry.type === "regular") await writeFile(join(workspace.stage!.workspace, entry.path), await original.read(entry.path), { mode: entry.mode });
    f.state.policy = { revision: f.state.policy.revision + 1, allowedEnvs: ["Remote"] };
    const capture = f.capture("after", before.checkpoint.id, before.capture.turnId), captured = await f.read(capture);
    assert.equal(text(captured, "file.txt"), "Generated actual worker after.\n");
    assert.deepEqual(Buffer.from(file(captured, "generated.bin")!.content, "base64"), Buffer.from([0, 0xff, 0x80, 0x41]));
    assert.equal(file(captured, "generated.bin")!.mode, 0o751);
    assert.equal(Object.hasOwn(file(captured, "file.txt")!, "identity"), false);
    assert.equal(captured.boundary!.afterId, signed.afterId); assert.equal(captured.boundary!.resultDigest, signed.execution.resultDigest);
    assert.equal(await readFile(join(workspace.stage!.workspace, "file.txt"), "utf8"), "Generated original 0.\n");
    parse(CheckpointWorkspaceSchema, captured);
  } finally { await f.close(); }
});
