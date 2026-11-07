import test from "node:test";
import { resolve } from "node:path";
import { qualifyMyWork } from "./fixtures/qualify-my-work.ts";

test("actual controller SIGKILL preserves original inbox observations/unknown cleanup and never replays refresh", { timeout: 60000 }, async () => {
  await qualifyMyWork(resolve("."));
});
