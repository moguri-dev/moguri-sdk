import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCompoundWorkflow } from "../packages/protocol/src/compound.ts";
import { waitingCompound } from "./fixtures/compound-state.ts";

test("a pending validation cannot manufacture user approval, change reviewed bytes or move a model result into a different owned test root", () => {
  const record = waitingCompound(), validation = record.validations[0]!;
  const decision = { actor: "user" as const, commandId: "generated-validation-command", commandDigest: "c".repeat(64), at: record.createdAt };
  for (const changes of [{ decision }, { reviewDigest: "f".repeat(64) }, { documentDigest: "f".repeat(64) },
    { stageWorkspaceId: "generated-alternate-root" }, { proposalStepId: "generated-router-step" }]) {
    assert.throws(() => projectCompoundWorkflow(record, { ...record, revision: record.revision + 1, validations: [{ ...validation, ...changes }] }), { code: "compound_corrupt" });
  }
});
