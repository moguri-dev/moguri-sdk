import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, projectEvents, parse, RemoteMcpCallSchema, RemoteTargetSchema, type EventInput, type RemoteMcpCall } from "../packages/protocol/src/index.ts";

const hash = "a".repeat(64), other = "b".repeat(64);
const generatedCall = (): RemoteMcpCall => ({
  id: randomUUID(), profileId: "default", sessionId: "generated-session", projectId: "generated-project", turnId: "generated-turn", stepId: "generated-step", callId: "generated-call",
  actor: "external", commandId: "generated-command", commandDigest: hash, jobId: "generated-job", executionId: null, revision: 0, env: "Remote",
  root: "/generated/remote-project", hostFingerprint: "SHA256:generated-public-key", peerDigest: hash, resourceDigest: hash, scopeDigest: hash, helperDigest: hash,
  serverId: "generated-server", tool: "generated-tool", argumentsDigest: hash, intentDigest: hash, accessForwarded: false, resultDigest: null,
  phase: "intent", status: "waiting_input", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", diagnostic: null,
});
const event = (call: RemoteMcpCall): Extract<EventInput, { event_type: "mcp.remote_recorded" }> => ({ event_type: "mcp.remote_recorded", profile_id: call.profileId, project_id: call.projectId,
  session_id: call.sessionId, turn_id: call.turnId, step_id: call.stepId, payload: { call } });

test("Remote MCP projection retains exact actor/original identity and cannot rewrite scope, access or a retained result", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-remote-mcp-state-")), store = new EventStore(join(root, "events.sqlite"), randomBytes(32), "generated-mcp-state-key");
  try {
    const original = { ...generatedCall(), intentDigest: store.putBlob("Generated retained Remote MCP intent.") };
    const retained = store.putBlob("Generated retained Remote MCP result.");
    store.commit([event(original)]);
    store.commit([event({ ...original, revision: 1, phase: "result-retained", status: "running", accessForwarded: true, resultDigest: retained })]);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM blob_payloads WHERE digest IN (?,?)").get(original.intentDigest, retained)?.n, 2);
    const history = store.events(), projected = projectEvents(history).remoteMcpCalls[0]!;
    assert.equal(projected.commandId, original.commandId); assert.equal(projected.actor, "external"); assert.equal(projected.accessForwarded, true);
    for (const update of [{ root: "/generated/different-project" }, { actor: "model" as const }, { commandId: "generated-replaced-command" },
      { resultDigest: other }, { accessForwarded: false }, { callId: "generated-different-call" }]) {
      const changed = { ...projected, ...update, revision: 2 };
      const synthetic = { ...history.at(-1)!, ...event(changed), seq: history.at(-1)!.seq + 1, id: randomUUID() };
      assert.throws(() => projectEvents([...history, synthetic]), { code: "remote_mcp_corrupt" });
    }
    assert.equal(projectEvents(history, "generated-foreign-profile").remoteMcpCalls.length, 0);
    assert.throws(() => parse(RemoteMcpCallSchema, { ...original, accessToken: "generated-secret-must-not-fit" }), { code: "invalid_request" });
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: original.sessionId, usage: [] } }], undefined, { sessions: [original.sessionId] });
    assert.equal(projectEvents(store.events()).remoteMcpCalls.length, 0);
    assert.throws(() => store.blob(original.intentDigest), /Missing or deleted/);
    assert.throws(() => store.blob(retained), /Missing or deleted/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("old Remote targets remain valid but never inherit an MCP credential/execution grant", () => {
  const target = parse(RemoteTargetSchema, { id: "generated", name: "Generated", host: "127.0.0.1", port: 2222, user: "generated",
    hostKey: "ssh-ed25519 Z2VuZXJhdGVkLW5vdC1hLXJlYWwta2V5", identityFile: "/generated/identity", stateDir: "/generated/state",
    command: ["/generated/node", "/generated/worker"], allowCopilot: true, models: [] });
  assert.equal(target.mcpGrants, undefined);
  assert.throws(() => parse(RemoteTargetSchema, { ...target, mcpGrants: [{ serverId: "generated", peerDigest: hash, resourceDigest: hash, forwardAccess: true, accessToken: "generated-secret" }] }), { code: "invalid_request" });
});

test("schema-24 marker failure preserves exact schema-23 ciphertext and recovers without a reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-remote-mcp-migration-")), path = join(root, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key, "generated-mcp-upgrade-key");
  try {
    store.commit([{ event_type: "job.progress", profile_id: "default", payload: { jobId: "generated-older-source", progress: "Generated encrypted schema-23 source." } }]);
    const before = store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all();
    store.db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id IN ('remote_memory_schema','remote_mcp_schema','remote_terminal_schema','remote_repository_schema','candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema','paste_file_schema','native_execution_schema','compound_workflow_schema','budget_winddown_schema','owned_decision_schema','task_progress_schema','document_attachment_schema'); PRAGMA user_version=23;
      CREATE TRIGGER generated_remote_mcp_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='remote_mcp_schema'
      BEGIN SELECT RAISE(ABORT,'Generated Remote MCP marker failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key, "generated-mcp-upgrade-key"), /Generated Remote MCP marker failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 23);
      assert.deepEqual(raw.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
      raw.exec("DROP TRIGGER generated_remote_mcp_marker");
    } finally { raw.close(); }
    store = new EventStore(path, key, "generated-mcp-upgrade-key");
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});
