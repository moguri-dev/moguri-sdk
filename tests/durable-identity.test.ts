import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { assertChatHome, captureChatHome } from "../apps/service/src/chat-workspace.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

/** macOS assigns new device numbers at boot; a retained identity from before a reboot differs only in `device`. */
const renumbered = <T extends { device: string }>(identity: T): T => ({ ...identity, device: String(BigInt(identity.device) + 7n) });

test("a project-free chat's Home survives a reboot device renumbering but not a re-created directory", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-home-"))), home = join(directory, "home");
  try {
    await mkdir(home);
    const captured = captureChatHome(home);
    assert.equal(assertChatHome(renumbered(captured)), home);
    await rm(home, { recursive: true }); await mkdir(home);
    assert.throws(() => assertChatHome(renumbered(captured)), (error: unknown) => (error as { code?: string }).code === "chat_home_changed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a managed worktree recorded before a reboot stays usable after restart when only its device number changed", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    initializeGeneratedRepository(fixture.project);
    const workspace = await sdk.workspaces.wait((await sdk.workspaces.create(fixture.session().projectId, "moguri/generated-reboot")).id!);
    const created = await sdk.sessions.create(fixture.session().projectId, "Generated reboot task", { modelId: fixture.modelId }, workspace.id);
    assert.equal((await sdk.workspaces.file(created.id!, "fixture.txt")).type, "session.file");
    const saved = fixture.service.controller.snapshot().managedWorkspaces.find((value) => value.id === workspace.id)!;
    fixture.service.store.commit([{ event_type: "workspace.saved", profile_id: "default", project_id: saved.projectId,
      payload: { workspace: { ...saved, identity: renumbered(saved.identity!), revision: saved.revision + 1 } } }]);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.notEqual(restarted.controller.snapshot().managedWorkspaces.find((value) => value.id === workspace.id)?.identity?.device, saved.identity!.device);
    const file = await sdk.workspaces.file(created.id!, "fixture.txt");
    assert.equal(file.type === "session.file" && file.path, "fixture.txt");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
