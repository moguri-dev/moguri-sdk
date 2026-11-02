import { isRecord, parse } from "../../../packages/protocol/src/core.ts";
import { WebAccessSchema } from "../../../packages/protocol/src/web-policy.ts";
import { runOwnedPlaywright } from "./playwright-data.ts";

console.log = (...values: unknown[]) => console.error(...values);
process.once("message", (request: unknown) => {
  void (async () => {
    if (!isRecord(request) || request.kind !== "playwright" || !isRecord(request.arguments) ||
      typeof request.root !== "string" || typeof request.temporary !== "string") throw new Error("Owned app executor needs its exact typed launch/root/profile input.");
    return runOwnedPlaywright(request.root, request.arguments, request.temporary,
      request.webAccess === undefined ? undefined : parse(WebAccessSchema, request.webAccess));
  })().then((value) => {
    if (Buffer.byteLength(JSON.stringify(value)) > 12 * 1024 * 1024) throw new Error("Owned app result exceeds its complete byte bound.");
    process.send?.({ ok: true, value, maxRssKiB: process.resourceUsage().maxRSS });
  }).catch((error: unknown) => {
    process.send?.({ ok: false, code: "tool_partial", message: error instanceof Error ? error.message.slice(0, 2000) : "Original owned app outcome is unconfirmed." });
  }).finally(() => { if (process.connected) process.disconnect?.(); });
});
