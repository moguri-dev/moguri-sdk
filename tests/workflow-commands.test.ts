import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DraftEditor, MoguriSdk, slashCommands } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("the shared catalogue contains every requested command with project suggestions as the default", () => {
  for (const name of ["impeccable", "continue", "suggestions", "orchestrate", "spawn", "spar", "critique", "roast-me"]) {
    assert.equal(slashCommands.filter((command) => command.name === name).length, 1);
  }
  assert.match(slashCommands.find((command) => command.name === "suggestions")!.description, /project/);
});

for (const client of ["desktop", "tui", "cli"] as const) test(`${client} queues held presets and runs them headlessly only when reached`, { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  const editor = new DraftEditor(sdk, f.sessionId, f.session().draft);
  try {
    await f.configure(); await sdk.refresh();
    await sdk.attachments.file(f.sessionId, join(f.project, "fixture.txt"));
    await sdk.refresh(); editor.receive(f.session().draft);
    editor.edit("/impeccable Generated actual UI task."); await editor.flush();
    await sdk.commands.submit(f.sessionId, { client, expectedDraftRevision: f.session().draft.revision, held: true });
    assert.equal(f.requests.length, 0); assert.equal(f.session().queue[0]?.held, true);
    assert.equal(f.session().queue[0]?.attachments.length, 1); assert.equal(f.session().draft.attachments.length, 0);
    await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated newer unsent input.", attachments: [] });
    await sdk.command({ type: "session.resume", sessionId: f.sessionId });
    await waitFor(() => f.session().status === "completed" && f.requests.length === 1);
    const start = f.service.controller.events(0).find((event) => event.event_type === "turn.started");
    assert.equal(start?.event_type === "turn.started" && start.payload.item.workflow?.kind, "impeccable");
    assert.match(JSON.stringify(f.requests), /beautiful|visual direction/);
    assert.match(JSON.stringify(f.requests), /generated original/);
    assert.equal(f.session().draft.text, "Generated newer unsent input.");
  } finally { editor.dispose(); sdk.disconnect(); await f.close(); }
});

for (const kind of ["critique", "roast-me", "pr-tour"] as const) test(`${kind} denies an actual model write rather than relying on prompt wording`, { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "write_file", args: { path: "fixture.txt", text: "Generated forbidden critique edit.", expectedDigest: "absent" } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.refresh(); await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    const original = await readFile(join(f.project, "fixture.txt"), "utf8");
    await sdk.workflows.start(f.sessionId, kind, "Generated proposal with material edge cases."); await f.terminal();
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), original);
    assert.equal(f.session().pendingApproval, null);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.ok(f.service.controller.events(0).some((event) => event.event_type === "tool.completed" && event.payload.outcome === "denied"));
  } finally { sdk.disconnect(); await f.close(); }
});

test("prompt-free continuation needs a real original task and never invents an answer to a pending question", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await f.configure(); await sdk.refresh();
    await assert.rejects(() => sdk.workflows.start(f.sessionId, "continue"), { code: "workflow_continue" });
    await f.send("generated provider failure in original unfinished task."); await f.terminal();
    assert.equal(f.session().status, "failed");
    const failed = f.service.controller.events(0).findLast((event) => event.event_type === "turn.finished")!;
    await sdk.workflows.start(f.sessionId, "continue"); await f.terminal();
    assert.equal(f.requests.length, 2);
    assert.match(JSON.stringify(f.requests.at(-1)), /unfinished task/);
    assert.match(JSON.stringify(f.requests.at(-1)), /inspect its original receipt|unknown tool/);
    const resume = f.service.controller.events(0).findLast((event) => event.event_type === "session.resumed");
    assert.deepEqual(resume?.event_type === "session.resumed" && resume.payload.continuation, { sourceTurnId: failed.turn_id, finishedSequence: failed.seq, actor: "user" });
    await assert.rejects(() => sdk.workflows.start(f.sessionId, "continue", "Generated replacement"), { code: "workflow_continue" });
    sdk.disconnect(); await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    assert.equal(reopened.controller.snapshot().sessions.find((session) => session.id === f.sessionId)?.status, "completed");
    assert.equal(f.requests.length, 2, "reopen must not replay the failed model or continuation");
    assert.ok(reopened.controller.events(0).some((event) => event.id === resume?.id));
  } finally { sdk.disconnect(); await reopened?.close(); await f.close(); }
});

test("spar asks an actual owned question, rejects implicit continuation and requires a separate tool approval after the real answer", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ respond: (request) => {
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const results = messages.filter((value) => typeof value === "object" && value !== null && "role" in value && value.role === "tool");
    if (!results.length) return { tool: { name: "ask_user", args: { question: "Which generated outcome matters?", choices: ["Generated accessibility", "Generated density"], allowFreeform: false } } };
    if (results.length === 1) return { tool: { name: "write_file", args: { path: "generated-spar.txt", text: "Generated agreed implementation.", expectedDigest: "absent" } } };
    return { text: "Generated work follows the actual answer." };
  } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await reviewNativeTools(f, ["write_file"]); await f.configure(); await sdk.refresh();
    await sdk.workflows.start(f.sessionId, "spar", "Generated idea needing user clarification.");
    const question = await waitFor(() => f.service.controller.snapshot().questions.find((question) => question.status === "open"));
    await assert.rejects(() => sdk.workflows.start(f.sessionId, "continue"), { code: "workflow_user_input" });
    assert.equal(f.requests.length, 1); assert.equal(question.answer, null);
    await sdk.questions.answer(question.id, question.choices[0]!, question.revision);
    const approval = await waitFor(() => f.session().pendingApproval);
    assert.equal(approval.call.name, "write_file");
    await assert.rejects(() => readFile(join(f.project, "generated-spar.txt")), { code: "ENOENT" });
    assert.equal(f.service.controller.snapshot().questions.find((value) => value.id === question.id)?.answer?.actor, "user");
    await sdk.approvals.respond(f.sessionId, approval.id, true); await f.terminal();
    assert.equal(await readFile(join(f.project, "generated-spar.txt"), "utf8"), "Generated agreed implementation.");
    assert.equal(f.session().controls.autonomy, "Manual");
    assert.match(JSON.stringify(f.requests.at(-1)), /Generated accessibility/);
  } finally { sdk.disconnect(); await f.close(); }
});

test("suggestions defaults to reviewed sources from the actual project and excludes another project before confirmed generation", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated owned project source."); await f.terminal(); await sdk.refresh();
    const foreign = join(f.directory, "generated-foreign-project"); await mkdir(foreign);
    const opened = await sdk.projects.add(foreign), other = await sdk.sessions.create(opened.id!);
    const session = sdk.getState().snapshot!.sessions.find((session) => session.id === other.id)!;
    await sdk.sessions.configure(session.id, { ...session.controls, modelId: f.modelId });
    await sdk.command({ type: "draft.save", sessionId: session.id, expectedRevision: 0, text: "Generated excluded foreign project source.", attachments: [] });
    await sdk.commands.submit(session.id, { client: "cli", expectedDraftRevision: 1 });
    await waitFor(() => f.service.controller.snapshot().sessions.find((value) => value.id === session.id)?.status === "completed");
    const target = await sdk.sessions.create(f.session().projectId);
    await sdk.sessions.configure(target.id!, { ...f.session().controls });
    const preview = (await sdk.suggestions.preview(target.id!)).preview, before = f.requests.length;
    assert.ok(preview.sources.length); assert.ok(preview.sources.every((source) => source.projectId === f.session().projectId));
    const result = await sdk.slash(target.id!, "/suggestions", "cli");
    assert.equal(result.kind, "text");
    if (result.kind === "text") { assert.match(result.text, /Generated owned project source/); assert.doesNotMatch(result.text, /excluded foreign project source/); }
    assert.equal(f.requests.length, before, "source preview cannot silently start a model");
    const generated = await sdk.suggestions.generate(target.id!, preview.digest, false, true);
    await waitFor(() => f.service.controller.snapshot().sessions.find((session) => session.id === generated.id)?.status === "completed");
    assert.doesNotMatch(JSON.stringify(f.requests.at(-1)), /excluded foreign project source/);
    assert.match(JSON.stringify(f.requests.at(-1)), /Generated owned project source/);
  } finally { sdk.disconnect(); await f.close(); }
});

test("spawn assignment creation, original prompt and draft consumption are one transaction and retain actual user origin", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.refresh(); await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "/spawn Generated original child task.", attachments: [] });
    const command = { type: "session.spawn.prompt" as const, sessionId: f.sessionId, prompt: "Generated original child task.", expectedDraftRevision: f.session().draft.revision };
    const id = "generated-atomic-spawn";
    f.service.store.db.exec("CREATE TRIGGER generated_spawn_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='queue.enqueued' BEGIN SELECT RAISE(ABORT,'Generated atomic spawn failure'); END;");
    await assert.rejects(() => sdk.command(command, id), /failed|no success/i);
    assert.equal(f.service.controller.snapshot().sessions.length, 1);
    assert.equal(f.session().draft.text, "/spawn Generated original child task."); assert.equal(f.requests.length, 0);
    f.service.store.db.exec("DROP TRIGGER generated_spawn_failure");
    const result = await sdk.command(command, id);
    await waitFor(() => f.service.controller.snapshot().sessions.find((session) => session.id === result.id)?.status === "completed");
    const child = f.service.controller.snapshot().sessions.find((session) => session.id === result.id)!;
    assert.equal(child.controls.autonomy, "Manual"); assert.equal(child.controls.automaticApprovals, false);
    assert.equal(child.createdParentSessionId, f.sessionId);
    assert.ok(child.messages.some((message) => message.role === "notice" && message.text.includes(command.prompt)), "delegated tasks must not be impersonated as a new child-user answer");
    assert.equal(f.session().draft.text, ""); assert.equal(f.requests.length, 1);
    f.service.store.db.prepare("DELETE FROM receipts WHERE id=?").run(id);
    assert.equal((await sdk.command(command, id)).id, child.id); assert.equal(f.requests.length, 1);
    assert.ok(f.service.controller.snapshot().coordinationMessages.some((message) => message.kind === "task" && message.origin.actor === "user" && message.toSessionId === child.id));
    assert.ok(f.service.controller.snapshot().coordinationMessages.some((message) => message.kind === "result" && message.fromSessionId === child.id));
  } finally { sdk.disconnect(); await f.close(); }
});

test("continue never clears an actual dispatched partial command or replays its effect", { skip: process.platform !== "darwin", timeout: ciTime(10000) }, async (t) => {
  const f = await setupFixture({ toolCall: { name: "run_command", args: { command: "printf 'Generated partial output.' > generated-partial.txt", timeoutMs: 1000 } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  const commit = f.service.store.commit.bind(f.service.store);
  let lost = false;
  t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
    if (!lost && args[0].some((event) => event.event_type === "tool.completed" && event.payload.call.name === "run_command")) {
      lost = true; throw new Error("Generated lost command completion receipt.");
    }
    return commit(...args);
  });
  try {
    await f.configure(); await sdk.refresh(); await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await f.send("Generated dispatched partial effect."); await f.terminal();
    assert.equal(lost, true);
    assert.ok(["partial", "failed"].includes(f.session().status));
    const calls = f.requests.length, resumes = f.service.controller.events(0).filter((event) => event.event_type === "session.resumed").length;
    await assert.rejects(() => sdk.workflows.start(f.sessionId, "continue"), { code: "workspace_unconfirmed" });
    assert.equal(f.requests.length, calls);
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "session.resumed").length, resumes);
    assert.equal(await readFile(join(f.project, "generated-partial.txt"), "utf8"), "Generated partial output.");
  } finally { sdk.disconnect(); await f.close(); }
});

test("the actual user orchestration spawns, dispatches, yields its writer and integrates a child without enabling global tool-less subagents", { skip: process.platform !== "darwin", timeout: ciTime(15000) }, async () => {
  const f = await setupFixture({ respond: (request) => {
    const messages = Array.isArray(request.messages) ? request.messages.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null) : [];
    if (messages.some((message) => message.role === "user" && String(message.content).includes("Generated bounded orchestrated child task."))) return { text: "Generated actual child result." };
    const tools = messages.filter((message) => message.role === "tool");
    if (!tools.length) return { tool: { name: "session_control", args: { action: "spawn", kind: "agent", title: "Generated orchestrated child" } } };
    const born: unknown = JSON.parse(String(tools[0]!.content));
    if (typeof born !== "object" || born === null || !("id" in born) || typeof born.id !== "string") throw new Error("Generated actual child identity was not returned.");
    if (tools.length === 1) return { tool: { name: "session_control", args: { action: "dispatch", targetSessionId: born.id, text: "Generated bounded orchestrated child task." } } };
    if (tools.length === 2) return { tool: { name: "wait_session", args: { targetSessionId: born.id, timeoutMs: 5000 } } };
    return { text: "Generated integrated actual child result." };
  } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.refresh(); await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    assert.equal(sdk.settings.get()?.values.subagents.enabled, false);
    await sdk.workflows.start(f.sessionId, "orchestrate", "Generated owned multi-session goal."); await f.terminal();
    const child = f.service.controller.snapshot().sessions.find((session) => session.createdParentSessionId === f.sessionId);
    assert.ok(child); assert.equal(child.title, "Generated orchestrated child");
    assert.equal(child.status, "completed");
    assert.match(f.session().messages.findLast((message) => message.role === "assistant")?.text ?? "", /integrated actual child result/);
    assert.equal(sdk.settings.get()?.values.subagents.enabled, false);
    assert.ok(f.service.controller.snapshot().coordinationLinks.some((link) => link.childId === child.id && link.origin.actor === "model"));
  } finally { sdk.disconnect(); await f.close(); }
});

test("stopping an actual orchestration propagates to its running child without deleting it or reporting success", { skip: process.platform !== "darwin", timeout: ciTime(15000) }, async () => {
  const f = await setupFixture({ respond: (request) => {
    const messages = Array.isArray(request.messages) ? request.messages : [];
    if (JSON.stringify(messages).includes("<delegated-session-task>") && JSON.stringify(messages).includes("Generated held child task.")) return { hold: true };
    const results = messages.filter((value) => typeof value === "object" && value !== null && "role" in value && value.role === "tool");
    if (!results.length) return { tool: { name: "session_control", args: { action: "spawn", kind: "agent", title: "Generated cancelled child" } } };
    const first = results[0];
    if (typeof first !== "object" || first === null || !("content" in first)) throw new Error("Generated coordinator has no actual birth result.");
    const born: unknown = JSON.parse(String(first.content));
    if (typeof born !== "object" || born === null || !("id" in born) || typeof born.id !== "string") throw new Error("Generated coordinator lost its exact child.");
    if (results.length === 1) return { tool: { name: "session_control", args: { action: "dispatch", targetSessionId: born.id, text: "Generated held child task." } } };
    return { tool: { name: "wait_session", args: { targetSessionId: born.id, timeoutMs: 10000 } } };
  } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.refresh(); await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await sdk.workflows.start(f.sessionId, "orchestrate", "Generated cancellable multi-session assignment.");
    const child = await waitFor(() => f.service.controller.snapshot().sessions.find((session) => session.createdParentSessionId === f.sessionId && session.turnId && session.status === "running"));
    await waitFor(() => f.requests.some((request) => JSON.stringify(request.messages).includes("<delegated-session-task>")));
    await sdk.command({ type: "session.stop", sessionId: f.sessionId });
    await f.terminal();
    const settled = await waitFor(() => f.service.controller.snapshot().sessions.find((session) => session.id === child.id && !session.turnId));
    assert.ok(["stopped", "partial"].includes(settled.status));
    assert.ok(["stopped", "partial"].includes(f.session().status));
    assert.ok(f.service.controller.events(0).some((event) => event.session_id === child.id && event.event_type === "turn.stop_requested"));
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "session.deleted"), false);
  } finally { sdk.disconnect(); await f.close(); }
});
