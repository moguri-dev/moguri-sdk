import { isRecord } from "../../packages/protocol/src/index.ts";
import "../../apps/service/src/worker.ts";

const original = process.send;
if (!original) throw new Error("The generated cache-presence fixture needs its owned IPC channel.");
process.send = new Proxy(original, { apply(target, owner, args) {
  const message = args[0];
  if (isRecord(message) && message.kind === "model.complete" && isRecord(message.stream)) {
    args[0] = { ...message, stream: { ...message.stream, cacheReadReported: false, cacheWriteReported: false } };
  }
  return Reflect.apply(target, owner, args);
} });
