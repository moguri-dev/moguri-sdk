import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import test from "node:test";
import { MoguriSdk, type Command, type CommandResult, type StoredEvent } from "../packages/sdk/src/index.ts";
import { generatedIssueRevisions } from "./fixtures/responsive-history.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("SDK create, draft, send, archive and delete remain responsive with retained issue-import revisions and exact receipts", {
  timeout: 120_000, skip: process.platform !== "darwin",
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
      assert.deepEqual(await sdk!.commandReceipt(input, id), { status: "committed", result });
      return result;
    };
    loop.enable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const created = await command({ type: "session.create", projectId: null, title: "Generated responsive issue-history chat",
      overrides: { modelId: fixture.modelId } }, "generated-issue-latency-create");
    const sessionId = created.id!;
    const fetch = globalThis.fetch;
    let originalDraftTransmissions = 0;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === `${fixture.service.connection.baseUrl}/v1/commands` && typeof init?.body === "string" &&
        JSON.parse(init.body).id === "generated-issue-latency-draft") {
        originalDraftTransmissions++;
        const response = await fetch(input, init);
        await response.arrayBuffer();
        throw new TypeError("Generated original draft acknowledgement was lost after commit.");
      }
      return fetch(input, init);
    });
    await command({ type: "draft.save", sessionId, expectedRevision: 0, text: "Generated original responsiveness request.", attachments: [] },
      "generated-issue-latency-draft");
    await command({ type: "message.send", sessionId, expectedRevision: 1, delivery: "auto" }, "generated-issue-latency-send");
    await waitFor(() => {
      const session = fixture.service.controller.snapshot().sessions.find((session) => session.id === sessionId);
      return session?.status === "completed" && !session.turnId;
    }, 20_000);
    await sdk.refresh();
    await command({ type: "session.archive", sessionId }, "generated-issue-latency-archive");
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
    await command({ type: "session.delete", sessionId, expectedRevision: sdk.sessions.get(sessionId)!.revision, confirm: true },
      "generated-issue-latency-delete");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const loopMs = Math.max(0, loop.max / 1_000_000 - 5);
    console.log(JSON.stringify({ primitive: "generated-issue-history-sdk-admission", revisions: history.length, currentIssues: 100, timings,
      maxLoopDelayMs: loopMs, rereadMs, checkpointMs, generatedModelCalls: fixture.requests.length }));
    assert.ok(timings.every((timing) => timing.acknowledgedMs < 1000), "Original SDK acknowledgement must not wait for multi-second issue-history replay.");
    assert.ok(loopMs < 1000, "Original service event loop must not stall for a second while processing ordinary input.");
    assert.equal(fixture.requests.length, 1);
    assert.equal(originalDraftTransmissions, 1);
    assert.equal(fixture.service.store.db.prepare("SELECT count(*) AS rows FROM receipts WHERE id=?").get("generated-issue-latency-draft")?.rows, 1);
    assert.equal(sdk.sessions.get(sessionId), undefined);
    assert.equal(issueBytes(), retainedCiphertext);
    assert.equal(fixture.service.controller.snapshot().issues.length, 100);
  } finally { loop.disable(); sdk?.disconnect(); await fixture.close(); }
});
