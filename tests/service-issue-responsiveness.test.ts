import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import test from "node:test";
import { MoguriSdk, type Command, type CommandResult, type StoredEvent } from "../packages/sdk/src/index.ts";
import { generatedIssueRevisions } from "./fixtures/responsive-history.ts";
import { assertLatencyBudget, assertOperationLatency, LATENCY_SAMPLES, OPERATION_LATENCY_MS } from "./fixtures/latency-budgets.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("SDK operations satisfy every per-operation budget with retained issue revisions and exact receipts", {
  timeout: ciTime(120_000), skip: process.platform !== "darwin",
}, async (t) => {
  const fixture = await setupFixture({ responseMode: "text" });
  let sdk: MoguriSdk | undefined;
  const loop = monitorEventLoopDelay({ resolution: 5 });
  try {
    const projectId = fixture.session().projectId, history = generatedIssueRevisions(projectId);
    fixture.service.store.commit(history);
    fixture.service.controller.refreshProfile();
    sdk = await new MoguriSdk(fixture.service.connection).ready();
    const issueBytes = () => {
      const hash = createHash("sha256");
      for (const row of fixture.service.store.db.prepare("SELECT id,payload FROM events WHERE json_extract(data,'$.event_type')='issue.saved' ORDER BY seq").iterate()) {
        hash.update(String(row.id)); hash.update(String(row.payload));
      }
      return hash.digest("hex");
    };
    const retainedCiphertext = issueBytes(), timings: Array<{ operation: string; acknowledgedMs: number }> = [];
    const command = async (input: Command, id: string): Promise<CommandResult> => {
      const began = performance.now(), result = await sdk!.command(input, id);
      timings.push({ operation: input.type, acknowledgedMs: performance.now() - began });
      console.log(JSON.stringify({ primitive: "generated-operation-latency-budget", ...timings.at(-1) }));
      assertOperationLatency(input.type, timings.at(-1)!.acknowledgedMs);
      assert.deepEqual(await sdk!.commandReceipt(input, id), { status: "committed", result });
      return result;
    };
    const fetch = globalThis.fetch;
    let originalDraftTransmissions = 0;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === `${fixture.service.connection.baseUrl}/v1/commands` && typeof init?.body === "string" &&
        JSON.parse(init.body).id === "generated-issue-latency-draft-0") {
        originalDraftTransmissions++;
        const response = await fetch(input, init);
        await response.arrayBuffer();
        throw new TypeError("Generated original draft acknowledgement was lost after commit.");
      }
      return fetch(input, init);
    });
    let rereadMs = 0, checkpointMs = 0;
    const read = fixture.service.store.events.bind(fixture.service.store), exec = fixture.service.store.db.exec.bind(fixture.service.store.db);
    t.mock.method(fixture.service.store, "events", (after = 0, previous?: readonly StoredEvent[]) => {
      const began = performance.now(), result = read(after, previous); rereadMs += performance.now() - began; return result;
    });
    t.mock.method(fixture.service.store.db, "exec", (sql: string) => {
      const began = performance.now(), result = exec(sql);
      if (sql.includes("wal_checkpoint")) checkpointMs += performance.now() - began;
      return result;
    });
    loop.enable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let sample = 0; sample < LATENCY_SAMPLES; sample++) {
      const created = await command({ type: "session.create", projectId: null, title: `Generated responsive issue-history chat ${sample}`,
        overrides: { modelId: fixture.modelId } }, `generated-issue-latency-create-${sample}`);
      const sessionId = created.id!;
      await command({ type: "session.organize", sessionId, changes: { title: `Generated acknowledged rename ${sample}` },
        expectedRevision: sdk.sessions.get(sessionId)!.revision }, `generated-issue-latency-rename-${sample}`);
      await command({ type: "draft.save", sessionId, expectedRevision: 0, text: `Generated original responsiveness request ${sample}.`, attachments: [] },
        `generated-issue-latency-draft-${sample}`);
      await command({ type: "message.send", sessionId, expectedRevision: 1, delivery: "auto" }, `generated-issue-latency-send-${sample}`);
      await waitFor(() => {
        const session = fixture.service.controller.snapshot().sessions.find((session) => session.id === sessionId);
        return session?.status === "completed" && !session.turnId;
      }, 20_000);
      await sdk.refresh();
      await command({ type: "session.archive", sessionId }, `generated-issue-latency-archive-${sample}`);
      await command({ type: "session.delete", sessionId, expectedRevision: sdk.sessions.get(sessionId)!.revision, confirm: true },
        `generated-issue-latency-delete-${sample}`);
      assert.equal(sdk.sessions.get(sessionId), undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    const loopMs = Math.max(0, loop.max / 1_000_000 - 5);
    console.log(JSON.stringify({ primitive: "generated-issue-history-sdk-admission", revisions: history.length, currentIssues: 100, timings,
      samplesPerOperation: LATENCY_SAMPLES, maxLoopDelayMs: loopMs, rereadMs, checkpointMs, generatedModelCalls: fixture.requests.length }));
    assertLatencyBudget("Original service event-loop delay (largest operation budget)", loopMs, OPERATION_LATENCY_MS["session.delete"]);
    assert.equal(fixture.requests.length, LATENCY_SAMPLES);
    assert.equal(originalDraftTransmissions, 1);
    assert.equal(fixture.service.store.db.prepare("SELECT count(*) AS rows FROM receipts WHERE id=?").get("generated-issue-latency-draft-0")?.rows, 1);
    assert.equal(issueBytes(), retainedCiphertext);
    assert.equal(fixture.service.controller.snapshot().issues.length, 100);
  } finally { loop.disable(); sdk?.disconnect(); await fixture.close(); }
});
