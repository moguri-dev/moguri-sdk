import test from "node:test";
import { resolve } from "node:path";
import { qualifyPrCi } from "./fixtures/qualify-pr-ci.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual controller SIGKILL retains original CI evidence without polling replay and requires a separate reviewed watch", { timeout: ciTime(60_000) }, async () => {
  await qualifyPrCi(resolve("."));
});
