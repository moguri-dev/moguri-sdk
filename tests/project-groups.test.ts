import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { approvalProject, DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";

async function groupForFixture(fixture: Awaited<ReturnType<typeof setupFixture>>, sdk: MoguriSdk) {
  const first = fixture.session().projectId!, path = join(fixture.directory, "second-repository"); await mkdir(path);
  const second = (await sdk.command({ type: "project.add", path })).id!;
  const projects = [first, second].map((projectId) => ({ projectId,
    revision: fixture.service.controller.snapshot().projectConfigurations.find((configuration) => configuration.projectId === projectId)?.revision ?? 0 }));
  const folder = await sdk.projects.group("Generated group", projects);
  return { first, second, path, folderId: folder.id! };
}
async function sendTo(sdk: MoguriSdk, sessionId: string, text: string) {
  await sdk.refresh();
  const session = sdk.getState().snapshot!.sessions.find((session) => session.id === sessionId)!;
  const editor = new DraftEditor(sdk, sessionId, session.draft);
  try { editor.edit(text); await editor.send("queue"); } finally { editor.dispose(); }
}

test("group color and exact ungrouping preserve every project, file and already captured session root", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId);
    const before = fixture.service.controller.snapshot(), folder = before.projectFolders.find((folder) => folder.id === group.folderId)!;
    const captured = before.sessions.find((session) => session.id === created.id)!.repositories;
    const members = before.projectConfigurations.filter((entry) => entry.folderId === folder.id).map(({ projectId, revision }) => ({ projectId, revision }));
    await sdk.projects.folder(folder.name, folder.order, folder.id, folder.revision, "#6366F1");
    const colored = fixture.service.controller.snapshot().projectFolders.find((entry) => entry.id === folder.id)!;
    assert.equal(colored.color, "#6366f1"); assert.equal(colored.revision, folder.revision + 1);
    await sdk.projects.folder(colored.name, colored.order, colored.id, colored.revision);
    const retainedColor = fixture.service.controller.snapshot().projectFolders.find((entry) => entry.id === folder.id)!;
    assert.equal(retainedColor.color, colored.color);
    assert.deepEqual(fixture.service.controller.snapshot().projectConfigurations, before.projectConfigurations);
    await assert.rejects(() => sdk.projects.ungroup(folder.id, members, folder.revision), { code: "revision_conflict" });
    await assert.rejects(() => sdk.projects.ungroup(folder.id, members.slice(0, 1), retainedColor.revision), { code: "project_group_changed" });
    await sdk.projects.ungroup(folder.id, members, retainedColor.revision);
    const after = fixture.service.controller.snapshot();
    assert.equal(after.projectFolders.some((entry) => entry.id === folder.id), false);
    for (const member of members) {
      const current = after.projectConfigurations.find((entry) => entry.projectId === member.projectId)!;
      assert.equal(current.folderId, null); assert.equal(current.revision, member.revision + 1);
      assert.ok(after.projects.some((project) => project.id === member.projectId));
    }
    assert.deepEqual(after.sessions.find((session) => session.id === created.id)!.repositories, captured);
    assert.ok((await sdk.workspaces.files(created.id!, ".", group.first)).entries.includes("fixture.txt"));
    assert.deepEqual((await sdk.workspaces.files(created.id!, ".", group.second)).entries, []);
    assert.throws(() => sdk.sessions.createFolder(folder.id), { code: "project_folder" });
    await assert.rejects(() => sdk.projects.folder("No resurrection", 0, folder.id, 0), { code: "group_missing" });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("ungrouping refuses concurrent membership and persistence failure without moving a subset or consuming its command receipt", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), before = fixture.service.controller.snapshot();
    const folder = before.projectFolders.find((entry) => entry.id === group.folderId)!;
    const members = before.projectConfigurations.filter((entry) => entry.folderId === folder.id).map(({ projectId, revision }) => ({ projectId, revision }));
    const first = before.projectConfigurations.find((entry) => entry.projectId === group.first)!;
    await sdk.projects.organize(group.first, { folderId: first.folderId, color: "#3b82f6", order: first.order }, first.revision);
    await assert.rejects(() => sdk.projects.ungroup(folder.id, members, folder.revision), { code: "revision_conflict" });
    const current = fixture.service.controller.snapshot(), commandId = "generated-atomic-folder-removal";
    const exact = current.projectConfigurations.filter((entry) => entry.folderId === folder.id).map(({ projectId, revision }) => ({ projectId, revision }));
    fixture.service.store.db.exec(`CREATE TRIGGER generated_folder_remove_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='project.folder_removed' BEGIN SELECT RAISE(ABORT,'generated persistence failure'); END;`);
    const command = { type: "project.ungroup" as const, folderId: folder.id, expectedRevision: folder.revision, projects: exact };
    await assert.rejects(() => sdk.command(command, commandId), /persist|failed|database/i);
    assert.deepEqual(fixture.service.controller.snapshot().projectFolders, current.projectFolders);
    assert.deepEqual(fixture.service.controller.snapshot().projectConfigurations, current.projectConfigurations);
    fixture.service.store.db.exec("DROP TRIGGER generated_folder_remove_failure");
    await sdk.command(command, commandId);
    assert.equal(fixture.service.controller.snapshot().projectFolders.some((entry) => entry.id === folder.id), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("ungrouping navigation cannot release a captured session's unconfirmed all-root ownership", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId);
    fixture.service.store.commit([{ event_type: "turn.finished", profile_id: sdk.profileId, session_id: created.id!, turn_id: "generated-unconfirmed-ungroup-turn",
      payload: { outcome: "partial", diagnostic: "Generated original unconfirmed group work." } }]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    const roots = fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!.repositories!;
    await sdk.projects.ungroup(group.folderId, [{ projectId: group.first, revision: 1 }, { projectId: group.second, revision: 1 }], 0);
    assert.ok(roots.every((repository) => fixture.service.controller.ownedLocalRoots().includes(repository.root.root)));
    await assert.rejects(() => sdk.sessions.delete(created.id!, true), /inspect|unconfirmed|root/i);
    await assert.rejects(() => sdk.projects.remove(group.second, true, 2), /folder session|captured|group/i);
    assert.deepEqual(fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!.repositories, roots);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("named grouping is atomic and a folder session edits and runs commands only in explicitly selected captured roots", { skip: process.platform !== "darwin" }, async () => {
  let first = "", second = "";
  const fixture = await setupFixture({ respond: (_request, index) => {
    if (index === 1) return { tool: { name: "read_file", args: { repository: first, path: "fixture.txt" } } };
    if (index === 2) return { tool: { name: "write_file", args: { repository: second, path: "generated.txt", text: "Generated second-repository edit.", expectedDigest: "absent" } } };
    if (index === 3) return { tool: { name: "run_command", args: { repository: second, command: "printf 'Generated grouped command\\n'", timeoutMs: 2000 } } };
    return { text: "Generated multi-repository result." };
  } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const grouped = await groupForFixture(fixture, sdk);
    first = grouped.first; second = grouped.second;
    const { path } = grouped, result = { id: grouped.folderId };
    const state = fixture.service.controller.snapshot();
    assert.equal(state.projectFolders.find((folder) => folder.id === result.id)?.name, "Generated group");
    assert.ok([first, second].every((id) => state.projectConfigurations.find((configuration) => configuration.projectId === id)?.folderId === result.id));
    const created = await sdk.sessions.createFolder(result.id!, "Generated folder work", { modelId: fixture.modelId, autonomy: "Autopilot" });
    const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    assert.equal(session().projectId, null);
    assert.deepEqual(session().repositories?.map((repository) => repository.projectId), [first, second]);
    await assert.rejects(() => sdk.workspaces.files(created.id!, "."), /select.*repository|repository.*required/i);
    await assert.rejects(() => sdk.terminal.open(created.id!, 80, 24), { code: "repository_required" });
    await assert.rejects(() => sdk.terminal.open(created.id!, 80, 24, undefined, fixture.directory), { code: "repository_scope" });
    assert.ok((await sdk.workspaces.files(created.id!, ".", first)).entries.includes("fixture.txt"));
    const editor = new DraftEditor(sdk, created.id!, session().draft);
    try { editor.edit("Generated work across the exact reviewed group."); await editor.send("queue"); } finally { editor.dispose(); }
    await waitFor(() => session().status === "completed" || session().status === "failed" || session().status === "partial");
    assert.equal(session().status, "completed");
    assert.equal(await readFile(join(path, "generated.txt"), "utf8"), "Generated second-repository edit.");
    assert.equal(session().pendingApproval, null);
    assert.match(JSON.stringify(fixture.requests[0]), /repository/);
    const results = session().messages.filter((message) => message.role === "tool");
    assert.ok(results.every((message) => message.outcome === "completed"), JSON.stringify(results));
    const source = JSON.parse(results[0]!.text);
    assert.equal(source.sourceRef.repository, first);
    assert.match(source.sourceRef.expectedDigest, /^[a-f0-9]{64}$/);
    assert.equal(fixture.requests.length, 4);
    await assert.rejects(() => sdk.sessions.configure(created.id!, { ...session().controls, env: "Remote" }, session().revision), { code: "repository_env" });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("folder membership and directory replacement cannot silently retarget an original group session", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId);
    await assert.rejects(() => sdk.workspaces.files(created.id!, ".", "generated-foreign-repository"), { code: "repository_scope" });
    await rename(group.path, `${group.path}-original`); await mkdir(group.path);
    await assert.rejects(() => sdk.workspaces.files(created.id!, ".", group.second), { code: "repository_changed" });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("unconfirmed group roots survive archive and cannot be forgotten or removed through a member project", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId);
    fixture.service.store.commit([{ event_type: "turn.finished", profile_id: sdk.profileId, session_id: created.id!, turn_id: "generated-lost-group-turn",
      payload: { outcome: "partial", diagnostic: "Generated original controller loss." } }]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    const captured = fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!.repositories!;
    const secondRoot = captured.find((repository) => repository.projectId === group.second)!.root.root;
    assert.ok(captured.every((repository) => fixture.service.controller.ownedLocalRoots().includes(repository.root.root)));
    await assert.rejects(() => sdk.sessions.delete(created.id!, true), /inspect|unconfirmed|root/i);
    await assert.rejects(() => sdk.projects.remove(group.second, true, 1), /folder session|captured|group/i);
    await sdk.command({ type: "session.archive", sessionId: created.id! });
    assert.ok(fixture.service.controller.ownedLocalRoots().includes(secondRoot));
    await sdk.command({ type: "session.restore", sessionId: created.id! });
    await sdk.command({ type: "session.resume", sessionId: created.id! });
    assert.equal(fixture.service.controller.ownedLocalRoots().includes(secondRoot), false);
    await sdk.sessions.delete(created.id!, true);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the shared CLI and TUI slash entry lists folders and creates the same explicit captured-root session as desktop", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk);
    const listed = await sdk.slash(fixture.sessionId, "/folder-chat", "cli");
    assert.equal(listed.kind, "text");
    if (listed.kind !== "text") throw new Error("Expected the shared folder inventory.");
    assert.match(listed.text, new RegExp(group.folderId));
    const opened = await sdk.slash(fixture.sessionId, `/folder-chat ${group.folderId}`, "tui");
    assert.equal(opened.kind, "session");
    if (opened.kind !== "session") throw new Error("Expected the shared folder session.");
    const session = fixture.service.controller.snapshot().sessions.find((session) => session.id === opened.sessionId)!;
    assert.deepEqual(session.repositories?.map((binding) => binding.projectId), [group.first, group.second]);
    assert.equal(session.projectId, null);
    assert.equal(session.controls.env, "Local");
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/folder-chat generated-foreign-folder", "cli"), /folder/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("shared folder grouping binds exact current projects and stale revisions cannot create a partial folder", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const path = join(fixture.directory, "generated-other-project"); await mkdir(path);
    const second = (await sdk.command({ type: "project.add", path })).id!, first = fixture.session().projectId!;
    const original = [first, second].map((projectId) => ({ projectId, revision: 0 }));
    const result = await sdk.slash(fixture.sessionId, `/folder-group ${JSON.stringify({ name: "Generated shared folder", projectIds: [first, second] })}`, "cli");
    assert.equal(result.kind, "text");
    const before = fixture.service.controller.snapshot();
    assert.equal(before.projectFolders.length, 1);
    assert.ok(original.every(({ projectId }) => before.projectConfigurations.find((configuration) => configuration.projectId === projectId)?.folderId === before.projectFolders[0]!.id));
    await assert.rejects(() => sdk.projects.group("Must not exist", original), { code: "revision_conflict" });
    const after = fixture.service.controller.snapshot();
    assert.deepEqual(after.projectFolders, before.projectFolders);
    assert.deepEqual(after.projectConfigurations, before.projectConfigurations);
    await assert.rejects(() => sdk.slash(fixture.sessionId, `/folder-group ${JSON.stringify({ name: "Foreign", projectIds: [first, "generated-foreign-project"] })}`, "tui"), /project/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("standalone SDK tools honor the selected group repository and Autopilot without acquiring an implicit root", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId, "Generated explicit tool job", { autonomy: "Autopilot" });
    const tool = (await sdk.tools.catalog(created.id!, "write_file")).tools.find((tool) => tool.name === "write_file")!;
    const request = await sdk.tools.execute(created.id!, tool.name, { repository: group.second, path: "generated-sdk.txt", text: "Generated explicit selected-root write.", expectedDigest: "absent" }, tool.schemaDigest);
    assert.equal((await sdk.jobs.wait(request.id!)).status, "completed");
    assert.equal(await readFile(join(group.path, "generated-sdk.txt"), "utf8"), "Generated explicit selected-root write.");
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.pendingApproval, null);
    await assert.rejects(() => sdk.tools.execute(created.id!, tool.name, { path: "must-not-write.txt", text: "Generated invalid root.", expectedDigest: "absent" }, tool.schemaDigest), { code: "repository_required" });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a folder approval remembers the actual selected member tool, not every repository in the folder", { skip: process.platform !== "darwin" }, async () => {
  let first = "", second = "";
  const fixture = await setupFixture({ respond: (_request, index) => {
    if (index <= 3) return { tool: { name: "read_file", args: { repository: index === 3 ? second : first, path: index === 1 ? "fixture.txt" : "generated-other.txt" } } };
    return { text: "Generated scoped approval result." };
  } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    const group = await groupForFixture(fixture, sdk); first = group.first; second = group.second;
    await writeFile(join(fixture.project, "generated-other.txt"), "Generated first-repository source.");
    await writeFile(join(group.path, "generated-other.txt"), "Generated second-repository source.");
    const created = await sdk.sessions.createFolder(group.folderId, "Generated scoped approvals", { modelId: fixture.modelId });
    const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    await sendTo(sdk, created.id!, "Generated member-specific tool approvals.");
    const original = await waitFor(() => session().pendingApproval);
    assert.equal(approvalProject(session(), original.call.arguments.repository), first);
    assert.equal(approvalProject(session(), "generated-foreign-member"), null);
    await sdk.refresh();
    await sdk.slash(created.id!, "/approve project tool", "tui");
    const other = await waitFor(() => session().pendingApproval?.call.arguments.repository === second && session().pendingApproval);
    assert.equal(other.call.arguments.path, "generated-other.txt");
    const grant = sdk.settings.get()!.values.permissions.remembered![0]!;
    assert.deepEqual(grant.scope, { kind: "project", projectId: first });
    assert.deepEqual(grant.target, { kind: "tool", tool: "read_file" });
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "tool.decided" && event.payload.actor === "delegation").length, 1);
    await sdk.approvals.respond(created.id!, other.id, false);
    await waitFor(() => session().status === "completed");
    assert.equal(fixture.requests.length, 4);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("overlapping folder and single-project writers wait for every captured root and cancellation releases only settled ownership", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), held = await sdk.sessions.createFolder(group.folderId, "Generated held folder", { modelId: fixture.modelId });
    await sendTo(sdk, held.id!, "generated slow multi-root writer");
    await waitFor(() => fixture.requests.length === 1);
    const roots = fixture.service.controller.snapshot().sessions.find((session) => session.id === held.id)!.repositories!.map((binding) => binding.root.root);
    assert.ok(roots.every((root) => fixture.service.controller.ownedLocalRoots().includes(root)));
    const single = await sdk.sessions.create(group.second, "Generated queued member", { modelId: fixture.modelId });
    const overlapping = await sdk.sessions.createFolder(group.folderId, "Generated queued folder", { modelId: fixture.modelId });
    await sendTo(sdk, single.id!, "Generated single-root work after exact owner.");
    await sendTo(sdk, overlapping.id!, "Generated overlapping folder work after exact owner.");
    await new Promise((resolve) => setTimeout(resolve, 75));
    for (const id of [single.id, overlapping.id]) {
      const session = fixture.service.controller.snapshot().sessions.find((session) => session.id === id)!;
      assert.equal(session.turnId, null); assert.equal(session.queue.length, 1);
    }
    assert.equal(fixture.requests.length, 1);
    await sdk.command({ type: "session.stop", sessionId: held.id! });
    await waitFor(() => [single.id, overlapping.id].every((id) => fixture.service.controller.snapshot().sessions.find((session) => session.id === id)?.status === "completed"));
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === held.id)?.status, "stopped");
    assert.equal(fixture.requests.length, 3);
    assert.ok(roots.every((root) => !fixture.service.controller.ownedLocalRoots().includes(root)));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("review workflows recognize an empty captured folder session as workspace context without borrowing a first project", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId, "Generated grouped review", { modelId: fixture.modelId });
    await sdk.workflows.start(created.id!, "review");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.status === "completed");
    assert.equal(fixture.requests.length, 1);
    const context = JSON.stringify(fixture.requests[0]?.messages);
    assert.ok(context.includes(group.first) && context.includes(group.second));
    assert.match(context, /reviewed-multi-repository-scope/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("fresh member folder restrictions apply only to that selected repository, including user-owned SDK tools", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId, "Generated member policy", { autonomy: "Autopilot" });
    await mkdir(join(group.path, "restricted")); await mkdir(join(fixture.project, "restricted"));
    const configuration = (await sdk.projects.configuration(group.second)).configuration;
    await sdk.projects.configure(group.second, { ...configuration.values, readOnlyFolders: ["restricted"] }, configuration.revision);
    assert.equal((await sdk.tools.catalog(created.id!, "run_command")).tools.some((tool) => tool.name === "run_command"), false,
      "A shell in the unrestricted member could otherwise cross into the restricted member.");
    const tool = (await sdk.tools.catalog(created.id!, "write_file")).tools.find((tool) => tool.name === "write_file")!;
    const args = { path: "restricted/generated.txt", text: "Generated selected-repository policy check.", expectedDigest: "absent" };
    await assert.rejects(() => sdk.tools.execute(created.id!, tool.name, { ...args, repository: group.second }, tool.schemaDigest), /read.only/i);
    const request = await sdk.tools.execute(created.id!, tool.name, { ...args, repository: group.first }, tool.schemaDigest);
    assert.equal((await sdk.jobs.wait(request.id!)).status, "completed");
    assert.equal(await readFile(join(fixture.project, args.path), "utf8"), args.text);
    await assert.rejects(() => readFile(join(group.path, args.path)), { code: "ENOENT" });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("even read-only captured Sandbox preparation leases every original root without granting a tool or model call", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), created = await sdk.sessions.createFolder(group.folderId), side = await sdk.sessions.side(created.id!);
    const session = fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)!;
    assert.equal(session.mode, "read-only");
    const controls = { ...session.controls, env: "Sandbox" as const }, item = { id: "generated-private-copy-input", text: "Generated preparation ownership only.", attachments: [], delivery: "queue" as const };
    fixture.service.store.commit([
      { event_type: "session.configured", profile_id: "default", session_id: session.id, payload: { controls } },
      { event_type: "queue.enqueued", profile_id: "default", session_id: session.id, payload: { item } },
      { event_type: "turn.started", profile_id: "default", session_id: session.id, turn_id: "generated-private-copy-turn",
        payload: { item, controls, policyRevision: fixture.service.controller.snapshot().policy.revision } },
    ]);
    fixture.service.controller.refreshProfile();
    assert.ok(session.repositories!.every((repository) => fixture.service.controller.ownedLocalRoots().includes(repository.root.root)));
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.service.controller.snapshot().sandboxExecutions!.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("folder side chats retain the original root set, inherited controls and parent history but never writer tools", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const group = await groupForFixture(fixture, sdk), parent = await sdk.sessions.createFolder(group.folderId, "Generated grouped parent", { modelId: fixture.modelId, autonomy: "Autopilot" });
    await sendTo(sdk, parent.id!, "Generated exact group parent history.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === parent.id)?.status === "completed");
    const child = await sdk.sessions.side(parent.id!);
    const original = fixture.service.controller.snapshot().sessions.find((session) => session.id === parent.id)!;
    const side = fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)!;
    assert.deepEqual(side.repositories, original.repositories);
    assert.equal(side.projectFolderId, original.projectFolderId);
    assert.deepEqual(side.controls, original.controls);
    assert.equal(side.mode, "read-only");
    const tools = (await sdk.tools.catalog(side.id)).tools;
    assert.equal(tools.some((tool) => ["write_file", "edit_file", "apply_patch", "run_command"].includes(tool.name)), false);
    await sendTo(sdk, side.id, "Generated group side question.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.status === "completed");
    assert.match(JSON.stringify(fixture.requests.at(-1)?.messages), /Generated exact group parent history/);
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});
