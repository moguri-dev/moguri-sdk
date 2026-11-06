import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { RemoteRuntime } from "../apps/service/src/remote.ts";
import { CandidateTransports, type CandidateBinding, type CandidateLaunch } from "../apps/service/src/candidate-transports.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import type { EventInput, StoredEvent } from "../packages/protocol/src/index.ts";
import type { BridgeStatus } from "../apps/service/src/remote-protocol.ts";
import type { CandidateWorkerAction } from "../apps/service/src/candidate-worker-protocol.ts";

test("actual pinned rootless SSH worker authenticates candidate create/read/write receipts without a provider or Local fallback", { timeout: 60_000 }, async (t) => {
  const directory = resolve(".test-output", `candidate-transport-${randomUUID()}`);
  await mkdir(join(directory, "source"), { recursive: true, mode: 0o700 }); await mkdir(join(directory, "ssh"), { mode: 0o700 });
  const ssh = await createSshTarget(join(directory, "ssh")), secrets = new Map<string, string>();
  const remote = new RemoteRuntime(directory, () => ssh.target, resolve("apps/service/src/worker.ts"), { vault: {
    read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { if (secrets.has(id)) throw new Error("Generated duplicate original key"); secrets.set(id, value); },
    remove: async (id) => { secrets.delete(id); },
  } });
  const store = new EventStore(join(directory, "state.sqlite"), Buffer.alloc(32, 0x62));
  try {
    const root = await realpath(join(directory, "source"));
    await writeFile(join(root, "fixture.txt"), "generated original\n"); const git = initializeGeneratedRepository(root);
    await writeFile(join(root, "dirty.txt"), "unrelated staged\n"); git(["add", "--", "dirty.txt"]);
    const index = await readFile(join(root, ".git/index"));
    await remote.probe();
    const profileId = "default", sessionId = randomUUID(), projectId = randomUUID(), events: StoredEvent[] = [];
    const binding: CandidateBinding = { scope: { env: "Remote", profileId, sessionId, projectId, sourceWorkspaceId: null,
      stateRoot: ssh.target.stateDir, folders: { denied: [], readOnly: [] }, boundary: { env: "Remote", sourceRoot: root,
        peerDigest: frameDigest({ hostKey: ssh.target.hostKey }), configurationDigest: frameDigest(ssh.target), workerDigest: remote.readiness.workerDigest! } },
    current: () => { remote.assertReady(); },
    launch: (id) => ({ kind: "Remote", execution: { id, sessionId, projectId, turnId: id, target: ssh.target,
      workspace: root, workerDigest: remote.readiness.workerDigest!, configDigest: frameDigest(ssh.target), createdAt: new Date().toISOString(),
      status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null, lastSequence: 0, workerPid: null } }) };
    let failResultAppend = false;
    const transport = new CandidateTransports(store, { events: () => events, binding: async () => binding,
      commit: (inputs: EventInput[]) => {
        if (failResultAppend && inputs.some((event) => event.event_type === "candidate.transport_recorded" && event.payload.transport.resultDigest)) {
          failResultAppend = false; throw new Error("Generated lost durable candidate result receipt");
        }
        for (const input of inputs) events.push({ ...input, id: randomUUID(), seq: events.length + 1, schema_version: 1,
          timestamp: new Date().toISOString(), work_item_id: null, parent_event_id: null,
          artifact_id: input.event_type === "candidate.transport_recorded" && input.payload.transport.ownerKind === "candidate" ? input.payload.transport.ownerId : null });
      },
      open: (launch: CandidateLaunch, observed) => {
        assert.equal(launch.kind, "Remote"); if (launch.kind !== "Remote") throw new Error("Generated wrong actual Env");
        let status: BridgeStatus | undefined;
        const connection = remote.launch(launch.execution, (value) => { status = value; observed(value); }, true);
        const ended = new Promise<boolean>((resolve) => connection.events.once("exit", () => resolve(Boolean(status && ["completed", "stopped", "failed", "partial"].includes(status.status) && status.cleanup === "owned-worker-stopped"))));
        return { connection, clean: () => ended };
      },
    });
    const call = (action: CandidateWorkerAction, kind: "workspace" | "candidate" | "read" = "read", operationId = randomUUID()) =>
      transport.execute(binding, { kind, id: randomUUID(), authorityDigest: frameDigest("review"), operationId }, action, AbortSignal.timeout(20_000));
    const source = await call({ action: "source", paths: ["fixture.txt"] });
    assert.equal(source.type, "source"); if (source.type !== "source") throw new Error("Generated wrong result type");
    const created = await call({ action: "create", workspaceId: randomUUID(), source: source.source }, "workspace");
    assert.equal(created.type, "created"); if (created.type !== "created") throw new Error("Generated wrong result type");
    const patch = { kind: "patch" as const, summary: "Generated actual SSH proposal", edits: [{ path: "fixture.txt", baseDigest: frameDigest("unused"), text: "proposed\n" }] };
    patch.edits[0]!.baseDigest = source.files[0]!.baseDigest;
    const operationId = randomUUID(), candidateId = randomUUID();
    const staged = await call({ action: "write", candidateId, phase: "stage", source: source.source, stage: created.stage, patch }, "candidate", operationId);
    assert.equal(staged.type, "written"); assert.equal(await readFile(join(root, "fixture.txt"), "utf8"), "generated original\n");
    await assert.rejects(() => call({ action: "write", candidateId, phase: "stage", source: source.source, stage: created.stage, patch }, "candidate", operationId), { code: "candidate_no_replay" });
    assert.equal(transport.records().length, 3); assert.ok(transport.records().every((record) => record.status === "completed" && record.terminalAcknowledged && record.cleanupConfirmed));
    assert.deepEqual(await readFile(join(root, ".git/index")), index); assert.equal(git(["branch", "--show-current"]), "main");
    await t.test("the actual peer refuses changed source HEAD and altered staged bytes without a substitute", async () => {
      const peerSource = source.source;
      if (peerSource.env !== "Remote") throw new Error("Generated wrong actual Env");
      await assert.rejects(() => call({ action: "create", workspaceId: randomUUID(), source: { ...peerSource, head: "0".repeat(40) } }, "workspace"), /HEAD|branch|base/i);
      await writeFile(join(created.stage.root, "fixture.txt"), "Generated newer peer staging edit.\n");
      await assert.rejects(() => call({ action: "write", candidateId, phase: "apply", source: source.source, stage: created.stage, patch }, "candidate"), /Candidate bytes|changed|staged/i);
      assert.equal(await readFile(join(root, "fixture.txt"), "utf8"), "generated original\n");
      assert.deepEqual(await readFile(join(root, ".git/index")), index);
    });
    await t.test("lost terminal result storage retains actual staged effects and refuses original operation replay", async () => {
      const clean = await call({ action: "create", workspaceId: randomUUID(), source: source.source }, "workspace");
      if (clean.type !== "created") throw new Error("Generated missing fresh owned stage");
      failResultAppend = true;
      const lostId = randomUUID();
      await assert.rejects(() => call({ action: "write", candidateId: randomUUID(), phase: "stage", source: source.source, stage: clean.stage, patch }, "candidate", lostId), /lost|receipt|unconfirmed/i);
      assert.equal(await readFile(join(clean.stage.root, "fixture.txt"), "utf8"), "proposed\n");
      assert.equal(await readFile(join(root, "fixture.txt"), "utf8"), "generated original\n");
      const record = transport.records().find((record) => record.id === lostId)!;
      assert.equal(record.status, "partial"); assert.equal(record.resultDigest, null);
      assert.equal(record.terminalAcknowledged, false); assert.equal(record.cleanupConfirmed, false);
      const key = secrets.get(lostId);
      await assert.rejects(() => call({ action: "write", candidateId: record.ownerId, phase: "stage", source: source.source, stage: clean.stage, patch }, "candidate", lostId), { code: "candidate_no_replay" });
      assert.equal(secrets.get(lostId), key); assert.deepEqual(await readFile(join(root, ".git/index")), index);
    });
  } finally { await remote.close(); store.close(); await ssh.close(); await rm(directory, { recursive: true, force: true }); }
});
