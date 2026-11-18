import assert from "node:assert/strict";
import test from "node:test";
import { envelope } from "../apps/service/src/controller.ts";
import { runningSessionNames, runningSessions } from "../packages/protocol/src/sessions.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: 30_000 };
const RUNNING = /still running\. .* stops its current work\. Confirm that you want to stop it to continue; nothing was changed\./;

async function runningFixture(before?: (f: Awaited<ReturnType<typeof setupFixture>>, sdk: MoguriSdk) => Promise<void>) {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  await before?.(f, sdk);
  await f.configure();
  // Saved "don't ask again" preferences must not skip the running-session warning.
  const settings = sdk.settings.get()!;
  await sdk.settings.update({ ...settings.values, retention: { ...settings.values.retention, confirmArchive: false, confirmDelete: false,
    confirmBulkArchive: false, confirmBulkDelete: false } }, settings.revision);
  await f.send("generated slow task");
  await waitFor(() => f.requests.length === 1 && f.session().turnId, 10_000);
  return { f, sdk };
}

test("running sessions are found across the selected tree, including running jobs", () => {
  const session = (id: string, parentSessionId: string | undefined, turnId: string | null, status = "idle") => ({ id, title: `Generated ${id}`, parentSessionId, turnId, status });
  const sessions = [session("root", undefined, null), session("child", "root", "turn-1", "running"), session("waiting", "root", null, "waiting_input"),
    session("job-owner", "child", null), session("idle", "root", null, "completed"), session("other", undefined, "turn-2", "running")];
  assert.deepEqual(runningSessions(sessions, [{ sessionId: "job-owner", status: "running" }], ["root"]).map(({ id }) => id), ["child", "waiting", "job-owner"]);
  assert.deepEqual(runningSessions(sessions, [], ["idle"]), []);
  assert.equal(runningSessionNames(sessions.slice(0, 2)), '"Generated root" and "Generated child"');
  assert.equal(runningSessionNames(sessions), '"Generated root", "Generated child", "Generated waiting" and 3 more');
});

test("archiving or deleting a running session needs explicit confirmation even with confirmations turned off", mac, async () => {
  const { f, sdk } = await runningFixture();
  try {
    const archive = (confirmRunning?: true) => f.service.controller.dispatch(envelope({ type: "session.archive", sessionId: f.sessionId, expectedRevision: f.session().revision,
      ...(confirmRunning ? { confirmRunning } : {}) }));
    await assert.rejects(archive(), (error: Error & { code?: string }) => error.code === "session_running" && RUNNING.test(error.message));
    assert.ok(f.session().turnId, "the refused archive left the turn running"); assert.notEqual(f.session().status, "archived");
    await assert.rejects(sdk.sessions.delete(f.sessionId, true, f.session().revision), (error: Error & { code?: string }) => error.code === "session_running");
    assert.ok(f.service.controller.snapshot().sessions.some((session) => session.id === f.sessionId), "the refused delete removed nothing");
    await archive(true);
    await waitFor(() => f.session().status === "archived" && !f.session().turnId, 10_000);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a running subsession or bulk selection also needs confirmation, and confirmed deletion stops the work", mac, async () => {
  let parent: { id?: string } = {}, other: { id?: string } = {};
  const { f, sdk } = await runningFixture(async (f, sdk) => {
    parent = await sdk.sessions.create(f.session().projectId, "Generated idle parent");
    other = await sdk.sessions.create(f.session().projectId, "Generated idle peer");
    await f.service.controller.dispatch(envelope({ type: "session.organize", sessionId: f.sessionId, expectedRevision: f.session().revision, changes: { parentSessionId: parent.id! } }));
  });
  try {
    const tree = () => sdk.getState().snapshot!.sessions.find((session) => session.id === parent.id)!;
    const children = { action: "archive" as const, expected: [{ sessionId: f.sessionId, parentSessionId: parent.id! }] };
    await assert.rejects(f.service.controller.dispatch(envelope({ type: "session.archive", sessionId: parent.id!, expectedRevision: tree().revision, children })),
      (error: Error & { code?: string }) => error.code === "session_running" && error.message.includes(`"${f.session().title}" is still running`));
    const { preview } = await sdk.sessions.bulkPreview({ action: "archive", sessionIds: [parent.id!, other.id!], children: "cascade" });
    await assert.rejects(sdk.sessions.bulk(preview, true), (error: Error & { code?: string }) => error.code === "session_running");
    assert.ok(f.session().turnId);
    await sdk.sessions.delete(f.sessionId, true, f.session().revision, undefined, { confirmRunning: true });
    await waitFor(() => !f.service.controller.snapshot().sessions.some((session) => session.id === f.sessionId), 10_000);
  } finally { sdk.disconnect(); await f.close(); }
});

test("removing a project with a running session needs explicit confirmation", mac, async () => {
  const { f, sdk } = await runningFixture();
  try {
    const projectId = f.session().projectId, revision = (await sdk.projects.configuration(projectId)).configuration.revision;
    await assert.rejects(sdk.projects.remove(projectId, true, revision), (error: Error & { code?: string }) => error.code === "session_running" && /Removing the project stops/.test(error.message));
    assert.ok(f.service.controller.snapshot().projects.some((project) => project.id === projectId));
    assert.ok(f.session().turnId);
  } finally { sdk.disconnect(); await f.close(); }
});
