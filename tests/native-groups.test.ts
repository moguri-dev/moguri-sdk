import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, EventStore } from "../apps/service/src/store.ts";
import { defaultProjectConfiguration, defaultProjectSettings, projectEvents, type EventInput, type Project, type Session, type SandboxWorkspace } from "../packages/protocol/src/index.ts";
import { assertNativeGroupRestorePaths, SandboxWorkspaces, nativeWorkspaceDocument } from "../apps/service/src/sandbox-workspaces.ts";
import { sandboxConfiguration } from "../apps/service/src/sandbox-policy.ts";
import { sourceRootSync } from "../apps/service/src/repository-source.ts";
import {
  captureNativeTree, inspectNativeStage, materializeNativeGroup, nativeCompositeDigest, nativeRepositoryDirectory,
  NATIVE_TREE_MAX_BYTES, NATIVE_TREE_MAX_FILES, NATIVE_TREE_FILE_BYTES, type NativeSource,
} from "../apps/service/src/native-staging.ts";

async function groupFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-group-"))), state = join(root, "state");
  const projects = [join(root, "first"), join(root, "second")];
  for (const path of [state, ...projects]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(projects[0]!, "fixture.txt"), "Generated first source.\n");
  await writeFile(join(projects[1]!, "fixture.txt"), "Generated second source.\n");
  const sources = await Promise.all(projects.map((path) => captureNativeTree(path, { denied: [], readOnly: [] }, AbortSignal.timeout(10000))));
  const repositories = sources.map((source, index) => ({ projectId: `generated-${index}`, directory: nativeRepositoryDirectory(`generated-${index}`), source }));
  return { root, state, projects, sources, repositories, owner: { profileId: "default", sessionId: randomUUID(), turnId: randomUUID() },
    close: () => rm(root, { recursive: true, force: true }) };
}
function metadataSource(source: NativeSource, files: NativeSource["files"]): NativeSource {
  const value = { root: source.root, identity: source.identity, policy: source.policy, files, capture: "tree-v1" as const };
  return { ...value, digest: digest(JSON.stringify({ root: value.root, identity: value.identity, policy: value.policy,
    files: value.files.map(({ path, digest, bytes, mode }) => ({ path, digest, bytes, mode })), capture: value.capture })) };
}
async function workspaceFixture(onIntent?: (workspace: SandboxWorkspace) => void) {
  const fixture = await groupFixture(), store = new EventStore(":memory:"), folderId = randomUUID(), sessionId = fixture.owner.sessionId, turnId = randomUUID();
  const projects: Project[] = fixture.projects.map((path, index) => ({ id: `generated-${index}`, name: `Generated ${index}`, path }));
  const repositories = projects.map((project) => ({ projectId: project.id, name: project.name, root: sourceRootSync(project.path) }));
  const snapshot = () => ({ ...projectEvents(store.events()), profileId: "default" });
  const settings = snapshot().settings;
  const management = settings.values.sandboxManagement;
  if (!management) throw new Error("Generated factory management settings are unavailable.");
  const values = { ...settings.values, sandboxManagement: { ...management, enabled: true, automaticWorkspaces: true } };
  store.commit([{ event_type: "settings.updated", profile_id: "default", payload: { settings: values, revision: settings.revision + 1, permissionRevision: settings.permissionRevision } },
    ...projects.flatMap((project): EventInput[] => [{ event_type: "project.added", profile_id: "default", project_id: project.id, payload: { project } },
      { event_type: "project.configured", profile_id: "default", project_id: project.id, payload: { configuration: { ...defaultProjectConfiguration(project.id), folderId } } }]),
    { event_type: "project.folder_saved", profile_id: "default", payload: { folder: { id: folderId, name: "Generated native group", revision: 0, order: 0 } } }]);
  const controls = { env: "Sandbox" as const, modelId: null, autonomy: "Manual" as const, budget: { kind: "unlimited" as const } };
  const item = { id: randomUUID(), text: "Generated native group task.", attachments: [], delivery: "queue" as const };
  store.commit([{ event_type: "session.created", profile_id: "default", session_id: sessionId, payload: { title: "Generated group", projectFolderId: folderId, repositories, controls } },
    { event_type: "queue.enqueued", profile_id: "default", session_id: sessionId, payload: { item } },
    { event_type: "turn.started", profile_id: "default", session_id: sessionId, turn_id: turnId, payload: { item, controls, policyRevision: snapshot().policy.revision } }]);
  const config = sandboxConfiguration({ executable: "/generated/sendbox", configPath: null, image: `generated-worker@sha256:${"a".repeat(64)}`,
    bundlePath: "/generated/signed-manifest.json", trustRootPath: "/generated/trust.pem", qualification: { release: "0.2.4",
      hostSha256: "a".repeat(64), keySha256: "b".repeat(64), manifestSha256: "c".repeat(64), workerDigest: "d".repeat(64), bridgeDigest: "e".repeat(64),
      trustRootId: "generated-unit-root", minimumReleaseSequence: 8, allowedDomains: [], allowCopilot: false, resources: { cpus: 1, memoryMb: 1024, diskMb: 1024 } } });
  const session = () => snapshot().sessions.find((session) => session.id === sessionId)!;
  const workspaces = new SandboxWorkspaces(store, fixture.state, { assertReady: () => config }, { snapshot,
    project: (session: Session, selected?: string) => {
      const matches = session.repositories?.filter((binding) => binding.projectId === selected || binding.name === selected);
      if (!selected || matches?.length !== 1) throw new Error("Generated host requires one original explicit repository.");
      const binding = matches[0]!, project = projects.find((project) => project.id === binding.projectId)!;
      if (JSON.stringify(sourceRootSync(project.path)) !== JSON.stringify(binding.root)) throw new Error("Generated original root changed.");
      return project;
    },
    settings: (id) => {
      const value = snapshot().projectConfigurations.find((configuration) => configuration.projectId === id);
      return value ? { revision: value.revision, values: value.values } : { revision: 0, values: defaultProjectSettings() };
    },
    commit: (events) => { store.commit(events); for (const event of events) if (event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.status === "preparing") onIntent?.(event.payload.workspace); },
    closing: () => false,
  });
  return { ...fixture, store, workspaces, snapshot, session, sessionId, turnId, folderId, projects,
    close: async () => { await workspaces.close(); store.close(); await fixture.close(); } };
}

test("native groups copy exact distinct roots into one owned composite, not a common-parent or live checkout mount", async () => {
  const fixture = await groupFixture();
  try {
    const stage = await materializeNativeGroup(fixture.state, fixture.owner, fixture.repositories, AbortSignal.timeout(10000));
    assert.equal(stage.sourceDigest, nativeCompositeDigest(fixture.repositories)); await inspectNativeStage(stage);
    for (const [index, repository] of fixture.repositories.entries()) {
      assert.equal(await readFile(join(stage.workspace, repository.directory, "fixture.txt"), "utf8"), `Generated ${index ? "second" : "first"} source.\n`);
    }
    await writeFile(join(stage.workspace, fixture.repositories[1]!.directory, "fixture.txt"), "Generated private second-root change.\n");
    assert.equal(await readFile(join(fixture.projects[1]!, "fixture.txt"), "utf8"), "Generated second source.\n");
    assert.equal(await readFile(join(fixture.projects[0]!, "fixture.txt"), "utf8"), "Generated first source.\n");
  } finally { await fixture.close(); }
});

test("native group prefixes, original source sets and overlap cannot be relabelled or substituted", async () => {
  const fixture = await groupFixture();
  try {
    assert.throws(() => nativeCompositeDigest([{ ...fixture.repositories[0]!, directory: "../replacement" }, fixture.repositories[1]!]), /directory|mapping/i);
    assert.throws(() => nativeCompositeDigest([fixture.repositories[0]!, fixture.repositories[0]!]), /duplicate/i);
    assert.throws(() => nativeCompositeDigest([fixture.repositories[0]!, { ...fixture.repositories[1]!, source: fixture.sources[0]! }]), /overlap/i);
    const original = nativeCompositeDigest(fixture.repositories);
    assert.equal(nativeCompositeDigest([...fixture.repositories].reverse()), original);
    await writeFile(join(fixture.projects[1]!, "fixture.txt"), "Generated later source mutation.\n");
    await assert.rejects(() => materializeNativeGroup(fixture.state, fixture.owner, fixture.repositories, AbortSignal.timeout(10000)), /source changed/i);
    assert.equal(await readFile(join(fixture.projects[1]!, "fixture.txt"), "utf8"), "Generated later source mutation.\n");
  } finally { await fixture.close(); }
});

test("group limits bind the complete aggregate rather than resetting at each repository", async () => {
  const fixture = await groupFixture();
  try {
    const empty = { path: "generated.txt", text: null, digest: digest(""), bytes: 0, mode: 0o600 };
    const first = metadataSource(fixture.sources[0]!, Array.from({ length: NATIVE_TREE_MAX_FILES }, (_, index) => ({ ...empty, path: `generated-${index}.txt` })));
    const second = metadataSource(fixture.sources[1]!, [empty]);
    assert.throws(() => nativeCompositeDigest([{ ...fixture.repositories[0]!, source: first }, { ...fixture.repositories[1]!, source: second }]), /aggregate.*20,000|20,000.*aggregate/i);
    const half = NATIVE_TREE_MAX_BYTES / 2;
    const sized = (size: number) => Array.from({ length: Math.ceil(size / NATIVE_TREE_FILE_BYTES) }, (_, index) =>
      ({ ...empty, path: `generated-${index}.txt`, bytes: Math.min(NATIVE_TREE_FILE_BYTES, size - index * NATIVE_TREE_FILE_BYTES) }));
    assert.throws(() => nativeCompositeDigest([{ ...fixture.repositories[0]!, source: metadataSource(fixture.sources[0]!, sized(half)) },
      { ...fixture.repositories[1]!, source: metadataSource(fixture.sources[1]!, sized(half + 1)) }]), /aggregate.*256|256.*aggregate/i);
  } finally { await fixture.close(); }
});

test("cancelled composite materialization keeps its exact partial owner and never writes any source", async () => {
  const fixture = await groupFixture(), abort = new AbortController();
  let copied = 0;
  try {
    await assert.rejects(() => materializeNativeGroup(fixture.state, fixture.owner, fixture.repositories, abort.signal, () => { copied++; abort.abort(); }), /partial/i);
    assert.equal(copied, 1);
    const marker = JSON.parse(await readFile(join(fixture.state, "native-stages", "default", fixture.owner.turnId, "owner.json"), "utf8"));
    assert.equal(marker.sourceDigest, nativeCompositeDigest(fixture.repositories));
    assert.equal(await readFile(join(fixture.projects[0]!, "fixture.txt"), "utf8"), "Generated first source.\n");
    assert.equal(await readFile(join(fixture.projects[1]!, "fixture.txt"), "utf8"), "Generated second source.\n");
  } finally { await fixture.close(); }
});

test("managed native group input binds every original source and survives pure color/ungroup changes without retargeting", async () => {
  const fixture = await workspaceFixture();
  try {
    const workspace = await fixture.workspaces.prepareAutomatic(fixture.sessionId, fixture.turnId, AbortSignal.timeout(10000));
    assert.equal(workspace.sourceRoot, null); assert.equal(workspace.projectId, null); assert.equal(workspace.repositories?.length, 2);
    const input = nativeWorkspaceDocument(fixture.store.blob(workspace.inputDigest));
    assert.equal(input.version, 3);
    if (input.version !== 3) throw new Error("Generated group did not retain version-3 input.");
    assert.deepEqual(input.repositories.map((entry) => entry.binding.root.root), fixture.projects.map((project) => project.path));
    assert.equal(workspace.stage.sourceDigest, nativeCompositeDigest(input.repositories.map((entry) =>
      ({ projectId: entry.binding.projectId, directory: entry.directory, source: entry.workingSource }))));
    fixture.store.commit([...fixture.snapshot().projectConfigurations.map((configuration): EventInput => ({ event_type: "project.configured",
      profile_id: "default", project_id: configuration.projectId, payload: { configuration: { ...configuration, folderId: null, color: "#557799", revision: configuration.revision + 1 } } })),
    { event_type: "project.folder_removed", profile_id: "default", payload: { folderId: fixture.folderId, expectedRevision: 0 } }]);
    assert.equal((await fixture.workspaces.assert(fixture.session())).id, workspace.id);
    assert.equal(fixture.snapshot().budgetEntries.length, 0);
    for (const project of fixture.projects) assert.ok((await readFile(join(project.path, "fixture.txt"), "utf8")).startsWith("Generated "));
  } finally { await fixture.close(); }
});

test("managed group cancellation before copying retains partial intent and admits no worker or model", async () => {
  const abort = new AbortController(), fixture = await workspaceFixture(() => abort.abort());
  try {
    await assert.rejects(() => fixture.workspaces.prepareAutomatic(fixture.sessionId, fixture.turnId, abort.signal));
    const snapshot = fixture.snapshot();
    assert.ok(snapshot.sandboxWorkspaces); assert.ok(snapshot.sandboxExecutions);
    assert.equal(snapshot.sandboxWorkspaces[0]?.status, "partial"); assert.equal(fixture.session().sandboxWorkspaceId, null);
    assert.equal(snapshot.budgetEntries.length, 0); assert.equal(snapshot.sandboxExecutions.length, 0);
    for (const project of fixture.projects) assert.ok((await readFile(join(project.path, "fixture.txt"), "utf8")).startsWith("Generated "));
  } finally { await fixture.close(); }
});

test("group restoration refuses unassigned native work instead of silently dropping it from a replacement stage", async () => {
  const fixture = await workspaceFixture();
  try {
    const workspace = await fixture.workspaces.prepareAutomatic(fixture.sessionId, fixture.turnId, AbortSignal.timeout(10000));
    assert.ok(workspace.repositories);
    assert.doesNotThrow(() => assertNativeGroupRestorePaths(workspace.repositories!, [
      ...workspace.repositories!.map((repository) => `${repository.directory}/generated-retained.txt`), ".moguri/execution/generated/status.json",
    ]));
    assert.throws(() => assertNativeGroupRestorePaths(workspace.repositories!, ["unassigned-generated-output.txt"]), /outside.*captured repository/i);
    const source = fixture.store.blob(workspace.inputDigest), original = nativeWorkspaceDocument(source);
    assert.equal(original.version, 3);
    if (original.version !== 3) throw new Error("Generated group input was replaced.");
    original.repositories[0]!.directory = original.repositories[1]!.directory;
    assert.throws(() => nativeWorkspaceDocument(JSON.stringify(original)), /directory|mapping|duplicate/i);
  } finally { await fixture.close(); }
});
