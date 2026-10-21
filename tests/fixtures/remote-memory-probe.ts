import { Value } from "typebox/value";
import { MoguriError } from "../../packages/protocol/src/core.ts";
import { captureRepositorySource, SOURCE_FRAME_BYTES, SourceRequestSchema, SourceValidationRequestSchema, validateRepositorySource } from "../../apps/service/src/repository-source.ts";
import { JsonLineChannel, sendFrame } from "../../apps/service/src/worker-wire.ts";

const wire = new JsonLineChannel(process.stdin, process.stdout, false, SOURCE_FRAME_BYTES), abort = new AbortController();
let admitted = false;
const stopped = () => abort.abort(new Error("Generated Remote source control stopped."));
process.once("SIGTERM", stopped); process.once("SIGHUP", stopped);
wire.on("error", stopped); wire.on("close", () => { stopped(); process.stdin.destroy(); });
wire.on("message", (raw) => {
  if (!admitted && Value.Check(SourceValidationRequestSchema, raw)) {
    admitted = true;
    void validateRepositorySource(raw, abort.signal).then(
      (result) => wire.send({ kind: "source.validation", ...result }, () => wire.end()),
      (error: unknown) => { console.error("Generated source validation failed:", error instanceof MoguriError ? error.code : "stopped"); wire.send({ kind: "error", code: error instanceof MoguriError ? error.code : "memory_stopped" }, () => wire.end()); },
    ); return;
  }
  if (admitted || !Value.Check(SourceRequestSchema, raw)) { process.exitCode = 1; wire.end(); return; }
  admitted = true;
  wire.send({ kind: "probe", pid: process.pid });
  void captureRepositorySource(raw.root, raw.maxFiles, raw.denied, abort.signal, (frame) => sendFrame(wire, frame, abort.signal)).then(() => wire.end(), (error: unknown) => {
    console.error("Generated source capture failed:", error instanceof MoguriError ? error.code : "stopped");
    wire.send({ kind: "error", code: error instanceof MoguriError ? error.code : "memory_stopped" }, () => wire.end()); process.exitCode = 1;
  });
});
