import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCompoundLedger } from "../packages/protocol/src/compound.ts";
import { waitingCompound } from "./fixtures/compound-state.ts";

test("a public workflow cannot retain paid role starts/results without exact profile-owned planned capacity and actual ledger entries", () => {
  const workflow = waitingCompound();
  assert.throws(() => validateCompoundLedger([workflow], [], []), { code: "compound_corrupt" });
});
