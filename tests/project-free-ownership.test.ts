import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { automaticHome, homeCommand, setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";

const mac = { skip: process.platform !== "darwin", timeout: 20_000 };
const heldCommand = "printf 'a-start\\n' >> generated-order.log; printf ready > generated-started; while ! test -f generated-release; do sleep 0.02; done; printf 'a-end\\n' >> generated-order.log";

test("separate Home chats serialize their actual approved writers and retain exact original-root settlement", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const first = await automaticHome(sdk, "Generated first Home writer"), second = await automaticHome(sdk, "Generated second Home writer");
    const a = await homeCommand(sdk, first, heldCommand);
    await waitFor(() => existsSync(join(fixture.home, "generated-started")));
    const b = await homeCommand(sdk, second, "printf 'b\\n' >> generated-order.log");
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === b.id && job.status === "running"));
    assert.equal(fixture.service.controller.snapshot().chatWriters.filter((writer) => writer.status === "active").length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === second && event.event_type === "tool.started"), false);
    await writeFile(join(fixture.home, "generated-release"), "Generated release.\n");
    await waitFor(() => [a.id, b.id].every((id) => fixture.service.controller.snapshot().jobs.find((job) => job.id === id)?.status === "completed"));
    assert.equal(await readFile(join(fixture.home, "generated-order.log"), "utf8"), "a-start\na-end\nb\n");
    const events = fixture.service.controller.events(0), released = events.find((event) => event.session_id === first && event.event_type === "turn.finished")!,
      admitted = events.find((event) => event.event_type === "chat.writer_recorded" && event.payload.writer.sessionId === second)!;
    assert.ok(admitted.seq > released.seq);
    assert.equal(fixture.service.controller.snapshot().chatWriters.filter((writer) => writer.status === "settled").length, 2);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("stopping an undispatched Home writer while another chat owns the root is stopped, not partial work or a second execution", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const first = await automaticHome(sdk, "Generated retained Home writer"), second = await automaticHome(sdk, "Generated cancelled Home waiter");
    const a = await homeCommand(sdk, first, heldCommand);
    await waitFor(() => existsSync(join(fixture.home, "generated-started")));
    const b = await homeCommand(sdk, second, "printf GENERATED_MUST_NOT_RUN > generated-forbidden");
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === b.id && job.status === "running"));
    await sdk.command({ type: "session.stop", sessionId: second });
    const stopped = await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === b.id && !["running", "waiting_input"].includes(job.status)));
    assert.equal(stopped.status, "cancelled");
    await writeFile(join(fixture.home, "generated-release"), "Generated release.\n");
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === a.id)?.status === "completed");
    assert.equal(existsSync(join(fixture.home, "generated-forbidden")), false);
    assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === second && event.event_type === "tool.started"), false);
    assert.equal(fixture.service.controller.snapshot().chatWriters.some((writer) => writer.sessionId === second), false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a bounded Home command job keeps its independently retained writer after model completion and releases only on actual job settlement", mac, async () => {
  const fixture = await setupFixture({ toolCall: { name: "command_job", args: { action: "start", command: heldCommand, timeoutMs: 5000 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const source = await sdk.sessions.create(null, "Generated Home background owner", { modelId: fixture.modelId });
    await sdk.sessions.autonomy(source.id!, "Autopilot");
    await sdk.command({ type: "draft.save", sessionId: source.id!, expectedRevision: 0, text: "Generated bounded Home watch.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: source.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === source.id)?.status === "completed");
    await waitFor(() => existsSync(join(fixture.home, "generated-started")));
    const writer = fixture.service.controller.snapshot().chatWriters.find((writer) => writer.sessionId === source.id)!;
    assert.equal(writer.status, "active"); assert.equal(writer.backgroundJobs.length, 1);
    const originalJob = fixture.service.controller.snapshot().jobs.find((job) => job.id === writer.backgroundJobs[0])!;
    assert.equal(originalJob.status, "running"); assert.equal(originalJob.commandJob?.root, writer.root.root);
    const second = await automaticHome(sdk, "Generated Home background waiter"), next = await homeCommand(sdk, second, "printf 'b\\n' >> generated-order.log");
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === next.id && job.status === "running"));
    assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === second && event.event_type === "tool.started"), false);
    await writeFile(join(fixture.home, "generated-release"), "Generated background release.\n");
    await waitFor(() => [originalJob.id, next.id!].every((id) => fixture.service.controller.snapshot().jobs.find((job) => job.id === id)?.status === "completed"));
    assert.equal(fixture.service.controller.snapshot().chatWriters.find((value) => value.id === writer.id)?.status, "settled");
    assert.equal(await readFile(join(fixture.home, "generated-order.log"), "utf8"), "a-start\na-end\nb\n");
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("profiles sharing Home keep model-only questions independent while excluding their actual overlapping command writers", mac, async () => {
  const fixture = await profileFixture(), home = join(fixture.directory, "home");
  try {
    const first = await automaticHome(fixture.sdk, "Generated Default Home writer"), a = await homeCommand(fixture.sdk, first, heldCommand);
    await waitFor(() => existsSync(join(home, "generated-started")));
    const other = await fixture.create("Generated independent Home profile"), modelId = fixture.assigned.get(other.profile.id)!.modelId;
    const question = await other.client.sessions.create(null, "Generated independent Home question", { modelId });
    await fixture.send(other.client, question.id!, "Generated independent question with no workspace operation.");
    await waitFor(() => other.client.getState().snapshot!.sessions.find((session) => session.id === question.id)?.status === "completed");
    assert.equal(fixture.sdk.getState().snapshot!.jobs.find((job) => job.id === a.id)?.status, "running");
    assert.equal(other.client.getState().snapshot!.chatWriters.length, 0);
    const second = await automaticHome(other.client, "Generated foreign Home writer"), b = await homeCommand(other.client, second, "printf 'b\\n' >> generated-order.log");
    await waitFor(() => other.client.getState().snapshot!.jobs.find((job) => job.id === b.id && job.status === "running"));
    assert.equal(other.client.getState().snapshot!.chatWriters.length, 0);
    await writeFile(join(home, "generated-release"), "Generated profile release.\n");
    await waitFor(() => fixture.sdk.getState().snapshot!.jobs.find((job) => job.id === a.id)?.status === "completed" &&
      other.client.getState().snapshot!.jobs.find((job) => job.id === b.id)?.status === "completed");
    assert.equal(await readFile(join(home, "generated-order.log"), "utf8"), "a-start\na-end\nb\n");
    assert.equal(other.client.getState().snapshot!.chatWriters[0]?.profileId, other.profile.id);
    assert.equal(fixture.sdk.getState().snapshot!.chatWriters[0]?.profileId, "default");
    assert.equal(fixture.assigned.get(other.profile.id)!.requests.length, 1);
  } finally { await fixture.close(); }
});

test("a Home command cannot bypass the retained quarantine of an explicitly registered nested project", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), nested = join(fixture.home, "generated-project");
  try {
    await mkdir(nested);
    const project = await sdk.projects.add(nested), created = await sdk.sessions.create(project.id!, "Generated nested original writer");
    await sdk.sessions.autonomy(created.id!, "Autopilot");
    await homeCommand(sdk, created.id!, "printf generated > generated-started; sleep 10", 12000);
    await waitFor(() => existsSync(join(nested, "generated-started")));
    await sdk.command({ type: "session.stop", sessionId: created.id! });
    assert.ok(sdk.getState().snapshot!.blockedProjects.includes(project.id!));
    const general = await automaticHome(sdk, "Generated Home quarantine check"), blocked = await homeCommand(sdk, general, "printf forbidden > generated-quarantine-bypass");
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === blocked.id && job.status === "failed"));
    assert.equal(existsSync(join(fixture.home, "generated-quarantine-bypass")), false);
    assert.equal(fixture.service.controller.events(0).some((event) => event.session_id === general && event.event_type === "tool.started"), false);
    await sdk.command({ type: "session.resume", sessionId: created.id! });
    await sdk.command({ type: "session.resume", sessionId: general });
    const allowed = await homeCommand(sdk, general, "pwd");
    await waitFor(() => fixture.service.controller.snapshot().jobs.find((job) => job.id === allowed.id && job.status === "completed"));
    assert.equal(fixture.service.controller.snapshot().chatWriters.find((writer) => writer.sessionId === general)?.status, "settled");
  } finally { sdk.disconnect(); await fixture.close(); }
});
