import assert from "node:assert/strict";
import { test } from "node:test";
import { projectWinddown, type WinddownRecord } from "../packages/protocol/src/winddown.ts";

test("a wind-down begins as independent held capacity, not a model result or Git approval, and immutable terminal intent cannot replay", () => {
  const now = "2026-07-01T00:00:00.000Z";
  const value: WinddownRecord = { version: 1, id: "generated-winddown", profileId: "generated-profile", sessionId: "generated-session", turnId: "generated-turn",
    ownerSessionId: "generated-session", ownerTurnId: "generated-turn", projectId: null, workspaceId: null, folderId: null, env: "Local", source: null,
    inputDigest: "a".repeat(64), authorityDigest: "b".repeat(64), policyDigest: "c".repeat(64), originId: "generated-original-prompt",
    revision: 0, createdAt: now, updatedAt: now, status: "held", diagnostic: null, commitDocumentDigest: null, commit: null,
    step: { planId: "generated-plan", role: "checkpoint", modelId: "generated-checkpoint", providerId: "generated-provider", apiModelId: "generated-api-checkpoint",
      inputBound: 1024, outputBound: 128, state: "pending", stepId: null, inputDigest: null, resultDigest: null, outcome: null, diagnostic: null } };
  const record = projectWinddown(undefined, value); assert.deepEqual(record, value);
  assert.throws(() => projectWinddown(record, { ...record, revision: 1, status: "ready" }), { code: "winddown_corrupt" });
  assert.throws(() => projectWinddown(record, { ...record, revision: 1, ownerSessionId: "generated-other-owner" }), { code: "winddown_corrupt" });
  const unused = projectWinddown(record, { ...record, revision: 1, status: "unused", diagnostic: "Actual owner ended without dispatch. No model call or Git effect." });
  assert.throws(() => projectWinddown(unused, { ...unused, revision: 2, status: "held", diagnostic: null }), { code: "winddown_corrupt" });
});
