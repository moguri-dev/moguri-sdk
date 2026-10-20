import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { DraftEditor, MoguriSdk, type Session } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";
import { startService } from "../apps/service/src/server.ts";

const mac = { skip: process.platform !== "darwin", timeout: 20_000 };
async function send(sdk: MoguriSdk, session: Session, text: string) {
  const editor = new DraftEditor(sdk, session.id, session.draft);
  try { editor.edit(text); await editor.send("queue"); } finally { editor.dispose(); }
}
test("suggestions preview stays scoped, excludes control chats and requires exact source review before any model call", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const phrase = "Use generated headless checks instead of opening a browser.";
    for (let index = 0; index < 2; index++) {
      const created = await sdk.sessions.create(null), session = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!;
      await sdk.command({ type: "session.configure", sessionId: session.id, expectedRevision: session.revision, controls: { ...session.controls, modelId: fixture.modelId } });
      await send(sdk, sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)!, phrase);
      await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === session.id)?.status === "completed");
    }
    await fixture.configure(); await fixture.send("Generated project-only guidance is not global."); await fixture.terminal();
    const current = await sdk.sessions.create(null);
    const preview = (await sdk.suggestions.preview(current.id!)).preview;
    assert.equal(preview.scope, "project-free"); assert.equal(preview.sources.length, 2);
    assert.equal(preview.repeated[0]?.count, 2);
    assert.ok(preview.sources.every((source) => source.projectId === null));
    assert.equal(fixture.requests.length, 3);
    await assert.rejects(() => sdk.suggestions.generate(current.id!, "0".repeat(64), false, true), /Source conversations changed/);
    const command = { type: "suggestions.generate" as const, sessionId: current.id!, expectedDigest: preview.digest, allProjects: false, confirmScope: true as const };
    assert.throws(() => fixture.service.controller.dispatch({ ...envelope(command), command: { ...command, confirmScope: false } }), /schema|valid/i);
    const all = (await sdk.suggestions.preview(current.id!, true)).preview;
    assert.equal(all.scope, "all-projects"); assert.equal(all.sources.length, 3);
    await assert.rejects(() => sdk.suggestions.preview(fixture.sessionId, true), /Cross-project/);
    const session = sdk.getState().snapshot!.sessions.find((value) => value.id === current.id)!;
    await sdk.command({ type: "session.configure", sessionId: session.id, expectedRevision: session.revision, controls: { ...session.controls, modelId: fixture.modelId } });
    const generated = await sdk.suggestions.generate(session.id, preview.digest, false, true);
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === generated.id)?.status === "completed");
    const meta = fixture.service.controller.snapshot().sessions.find((value) => value.id === generated.id)!;
    assert.equal(meta.kind, "metachat"); assert.equal(meta.controls.autonomy, "Manual");
    assert.equal(meta.usage.length, 1);
    assert.match(JSON.stringify(fixture.requests.at(-1)!.messages), /untrusted-prior-user-prompts/);
    assert.equal(JSON.stringify(fixture.requests.at(-1)!.messages).includes("Generated project-only guidance"), false);
    assert.equal((await sdk.suggestions.preview(session.id)).preview.sources.length, 2);
    await assert.rejects(() => sdk.configuration.propose(session.id, { target: "global", section: "instructions", value: phrase, reason: "Generated outside reference", evidence: ["generated-outside-evidence"] }), /outside/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("metachat has only read/propose authority and a real user must approve exact config risk", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const created = await sdk.metachat.create(fixture.session().projectId, fixture.sessionId);
    const current = () => sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!;
    await send(sdk, current(), "generated config proposal");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.status === "completed");
    await sdk.refresh();
    const proposal = sdk.getState().snapshot!.configurationProposals[0]!;
    assert.equal(proposal.actor, "model"); assert.equal(proposal.status, "pending"); assert.equal(proposal.projectId, null);
    assert.equal(sdk.settings.get()!.values.instructions, "");
    assert.deepEqual((fixture.requests[0]!.tools as { function: { name: string } }[]).map((tool) => tool.function.name), ["ask_user", "moguri_config"]);
    const review = await sdk.configuration.review(proposal.id);
    assert.equal(review.before, ""); assert.equal(review.spec.target, "global");
    await assert.rejects(() => sdk.configuration.decide(proposal.id, true, proposal.contentDigest, false), /Acknowledge/);
    await sdk.configuration.decide(proposal.id, true, proposal.contentDigest, true);
    assert.equal(sdk.settings.get()!.values.instructions, "Use generated headless checks instead of opening a browser.");
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "configuration.decided" && event.payload.actor === "user" && event.payload.approve));
    await send(sdk, current(), "generated config apply");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.messages.filter((message) => message.role === "user").length === 2 && !fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.turnId);
    assert.equal(sdk.settings.get()!.values.instructions.includes("unauthorized"), false);
    assert.equal(fixture.service.controller.snapshot().configurationProposals.length, 1);
    await sdk.refresh();
    await send(sdk, current(), "generated forbidden write");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.messages.filter((message) => message.role === "user").length === 3 && !fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)?.turnId);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started" && event.payload.call.name === "write_file"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("reviewed proposals reject concurrent stale bases and survive origin-session deletion; skills stay disabled", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const ids = await Promise.all(["Generated first guidance.", "Generated second guidance."].map((value) => sdk.configuration.propose(fixture.sessionId, { target: "global", section: "instructions", value, reason: "Generated concurrency review." })));
    const proposals = await Promise.all(ids.map((value) => sdk.configuration.review(value.id!)));
    const results = await Promise.allSettled(proposals.map((value) => sdk.configuration.decide(value.proposal.id, true, value.proposal.contentDigest, true)));
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
    assert.match(String(results.find((value) => value.status === "rejected")?.reason), /changed/);
    const skill = await sdk.configuration.propose(fixture.sessionId, { target: "skill", section: "generated-settings-skill", value: "---\nname: generated-settings-skill\ndescription: Generated review skill\n---\nUse generated headless checks.\n", reason: "Generated disabled install." });
    const review = await sdk.configuration.review(skill.id!);
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal((await sdk.configuration.review(skill.id!)).spec.section, "generated-settings-skill");
    await sdk.configuration.decide(skill.id!, true, review.proposal.contentDigest, true);
    assert.equal(sdk.getState().snapshot!.registry[0]?.enabled, false);
    assert.equal(sdk.getState().snapshot!.registry[0]?.source, "approved-proposal");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("repo instruction proposals use instruction-only sources and conflict-safe local writes without publishing", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(fixture.session().projectId, { ...configuration.values, deniedFolders: ["mcp.json"] }, configuration.revision);
    await writeFile(join(fixture.project, "AGENTS.md"), "Generated original guidance.\n");
    const created = await sdk.configuration.propose(fixture.sessionId, { target: "repo-instructions", section: "AGENTS.md", value: "Generated reviewed instructions.\n", reason: "Generated local instruction write." });
    const review = await sdk.configuration.review(created.id!);
    await writeFile(join(fixture.project, "AGENTS.md"), "Generated concurrent editor change.\n");
    await assert.rejects(() => sdk.configuration.decide(created.id!, true, review.proposal.contentDigest, true), /changed/);
    const next = await sdk.configuration.propose(fixture.sessionId, review.spec);
    const nextReview = await sdk.configuration.review(next.id!);
    await sdk.configuration.decide(next.id!, true, nextReview.proposal.contentDigest, true);
    assert.equal(await readFile(join(fixture.project, "AGENTS.md"), "utf8"), "Generated reviewed instructions.\n");
    assert.equal(fixture.service.controller.snapshot().jobs.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("schema-5 encrypted history migrates without changing identities, receipts or model controls", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated retained schema-five draft.", attachments: [] }, "generated-engagement-upgrade");
    const history = fixture.service.controller.events(0).map((event) => [event.seq, event.id]);
    sdk.disconnect(); await writeLegacyState(fixture.service, 5);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assertCurrentSchema(restarted.store);
    assert.deepEqual(restarted.controller.events(0).slice(0, history.length).map((event) => [event.seq, event.id]), history);
    assert.equal(restarted.controller.snapshot().sessions[0]?.draft.text, "Generated retained schema-five draft.");
    assert.equal(restarted.controller.snapshot().sessions[0]?.controls.modelId, fixture.modelId);
    assert.deepEqual(restarted.controller.snapshot().settings.values.notifications, { inApp: true, os: false, previewContent: false });
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id='generated-engagement-upgrade'").get());
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
test("Unicode source previews honor actual UTF-8/character bounds and retain only the exact approved evidence excerpts", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    for (let index = 0; index < 3; index++) {
      const created = await sdk.sessions.create(null), session = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!;
      await sdk.command({ type: "session.configure", sessionId: session.id, expectedRevision: session.revision, controls: { ...session.controls, modelId: fixture.modelId } });
      await send(sdk, sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)!, "\u{1f600}".repeat(5000));
      await waitFor(() => fixture.service.controller.snapshot().sessions.find((value) => value.id === session.id)?.status === "completed");
    }
    const current = await sdk.sessions.create(null);
    const preview = (await sdk.suggestions.preview(current.id!)).preview;
    assert.equal(preview.sources.reduce((bytes, source) => bytes + Buffer.byteLength(source.text), 0), 32768);
    assert.ok(preview.sources.every((source) => source.text.isWellFormed() && Array.from(source.text).length <= 4000));
    const source = preview.sources.at(-1)!;
    assert.ok(Array.from(source.text).length < 4000);
    const proposal = await sdk.configuration.propose(current.id!, { target: "global", section: "instructions", value: "Generated bounded evidence.", reason: "Generated exact source review.", evidence: [source.messageId] });
    assert.equal((await sdk.configuration.review(proposal.id!)).proposal.evidence[0]?.text, source.text);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("a local instruction write is reported as partial if its durable decision fails, never as a successful apply", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.configuration.propose(fixture.sessionId, { target: "repo-instructions", section: "AGENTS.md", value: "Generated partially recorded guidance.\n", reason: "Generated storage failure." });
    const review = await sdk.configuration.review(created.id!);
    fixture.service.store.db.exec("CREATE TRIGGER generated_decision_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='configuration.decided' BEGIN SELECT RAISE(ABORT,'Generated decision failure'); END");
    await assert.rejects(() => sdk.configuration.decide(created.id!, true, review.proposal.contentDigest, true), /written locally.*could not be recorded/);
    assert.equal(await readFile(join(fixture.project, "AGENTS.md"), "utf8"), "Generated partially recorded guidance.\n");
    assert.equal(fixture.service.controller.snapshot().configurationProposals[0]?.status, "pending");
    fixture.service.store.db.exec("DROP TRIGGER generated_decision_failure");
    await assert.rejects(() => sdk.configuration.decide(created.id!, true, review.proposal.contentDigest, true), /changed/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("instruction review cannot create even a parent directory inside a read-only project path", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const current = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(current.projectId, { ...current.values, readOnlyFolders: ["generated-readonly"], instructionsPath: "generated-readonly/AGENTS.md" }, current.revision);
    const created = await sdk.configuration.propose(fixture.sessionId, { target: "repo-instructions", section: "AGENTS.md", value: "Generated blocked instructions.", reason: "Generated no-directory side effect." });
    const review = await sdk.configuration.review(created.id!);
    await assert.rejects(() => sdk.configuration.decide(created.id!, true, review.proposal.contentDigest, true), /denied or read-only/);
    await assert.rejects(() => access(join(fixture.project, "generated-readonly")), /ENOENT/);
    assert.equal(fixture.service.controller.snapshot().configurationProposals[0]?.status, "pending");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("read acknowledgements and retained config recover without duplicate attention, while interrupted OAuth requires explicit reconnect", mac, async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("generated question"); await fixture.terminal(); await sdk.refresh();
    const question = sdk.getState().snapshot!.attention.find((entry) => entry.active)!;
    await sdk.attention.acknowledge([question.id]);
    const proposed = await sdk.configuration.propose(fixture.sessionId, { target: "global", section: "instructions", value: "Generated recovered guidance.", reason: "Generated retained config." });
    const raised = fixture.service.controller.events(0).filter((event) => event.event_type === "attention.raised").length;
    fixture.service.store.commit([{ event_type: "mcp.oauth_changed", profile_id: "default", payload: { authorization: { id: "generated-interrupted-oauth", serverId: "generated-interrupted", projectId: null, sessionId: fixture.sessionId, state: "exchanging", expiresAt: Date.now() + 600_000, authorizationUrlReady: true, diagnostic: null } } }]);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(sdk.getState().snapshot!.attention.find((entry) => entry.id === question.id)?.acknowledged, true);
    assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "attention.raised").length, raised);
    assert.equal((await sdk.configuration.review(proposed.id!)).spec.value, "Generated recovered guidance.");
    const auth = await sdk.mcp.oauthStatus("generated-interrupted-oauth");
    assert.equal(auth.authorization.state, "failed"); assert.equal(auth.url, null); assert.equal(auth.authorization.authorizationUrlReady, false);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
test("stopping a metachat during source lookup cannot persist a late model proposal", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const projects = fixture.service.controller.platform.sessions.projects;
  const original = projects.instructionSource.bind(projects);
  let release!: () => void, entered = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  projects.instructionSource = async (project) => { entered = true; await gate; return original(project); };
  try {
    await fixture.configure();
    const created = await sdk.metachat.create(fixture.session().projectId, fixture.sessionId);
    await send(sdk, sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!, "generated repo config proposal");
    await waitFor(() => entered);
    await sdk.command({ type: "session.stop", sessionId: created.id! });
    release();
    await waitFor(() => { const session = fixture.service.controller.snapshot().sessions.find((value) => value.id === created.id); return session && !session.turnId && ["stopped", "partial"].includes(session.status); });
    assert.equal(fixture.service.controller.snapshot().configurationProposals.length, 0);
    assert.equal(fixture.requests.length, 1);
  } finally { release(); projects.instructionSource = original; sdk.disconnect(); await fixture.close(); }
});
