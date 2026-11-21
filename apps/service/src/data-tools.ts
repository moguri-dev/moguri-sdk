import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { extname } from "node:path";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MoguriError, isRecord, defaultProjectSettings, type ToolCall } from "../../../packages/protocol/src/index.ts";
import { scopedPath, readRegularFile, bytesDigest, writeProjectBytes } from "./files.ts";
import { stopGroup } from "./supervisor.ts";
import { repositoryInstructionLayers, type FolderPolicy } from "./project-policy.ts";

export async function runDataTask(request: { kind: string; arguments: Record<string, unknown>; path?: string; source?: string; seed?: unknown; root?: string; webAccess?: import("../../../packages/protocol/src/web-policy.ts").WebAccess; stainlessExecutable?: string; stainlessDefault?: boolean }, signal: AbortSignal,
  started: (pid: number) => void = () => {}, writesDatabase = false): Promise<unknown> {
  signal.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(request)) > 16 * 1024 * 1024) throw new MoguriError("tool_data_limit", "Complete structured input exceeds 16 MiB. No partial input was dispatched.");
  const worker = request.kind === "playwright" ? "playwright-worker.mjs" : "data-worker.mjs";
  const path = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? `../../../dist/${worker}` : `./${worker}`, import.meta.url));
  const dependency = createRequire(import.meta.url).resolve("docx");
  const modules = dependency.slice(0, dependency.indexOf("/node_modules/") + "/node_modules".length);
  if (!modules.endsWith("/node_modules")) throw new MoguriError("tool_worker", "Structured tools need a qualified installed module boundary.");
  const dbFiles = request.path ? ["", "-wal", "-shm", "-journal"].map((suffix) => request.path + suffix) : [];
  const temporary = request.kind === "playwright" ? await mkdtemp(join(tmpdir(), "moguri-owned-app-")) : undefined;
  const temporaryOwner = temporary ? await lstat(temporary) : undefined;
  const effectful = writesDatabase || request.kind === "playwright";
  const actualRequest = temporary ? { ...request, temporary } : request;
  const child = fork(path, [], { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"], env: { NODE_NO_WARNINGS: "1",
    ...(temporary ? { HOME: temporary, TMPDIR: temporary, TMP: temporary, TEMP: temporary } : {}) },
    execArgv: request.kind === "playwright" ? ["--max-old-space-size=128"] : ["--max-old-space-size=128", "--disallow-code-generation-from-strings", "--permission", "--allow-worker",
      ...(["language.definition", "language.references"].includes(request.kind) ? ["--allow-child-process"] : []),
      `--allow-fs-read=${modules}`, `--allow-fs-read=${path}`, ...dbFiles.map((file) => `--allow-fs-read=${file}`),
      ...(writesDatabase ? dbFiles.map((file) => `--allow-fs-write=${file}`) : [])] });
  let reply: unknown, stderr = "", reason: string | null = null, stopping: Promise<boolean> | undefined, clean = false;
  const stop = () => { reason ??= "Structured tool cancelled."; if (child.pid) stopping ??= stopGroup(child.pid); };
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { reason = "Structured tool exceeded its bounded deadline."; stop(); }, request.kind === "playwright" ? 30000 : 10000);
  child.stderr?.on("data", (value: Buffer) => { stderr = (stderr + value.toString("utf8")).slice(0, 2000); });
  child.once("spawn", () => { if (child.pid) started(child.pid); if (signal.aborted) stop(); });
  child.once("message", (value: unknown) => { reply = value; });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
      child.send(actualRequest, (error) => { if (error) { reason = "Structured input delivery failed."; stop(); } });
    });
    clean = stopping ? await stopping : child.pid ? await stopGroup(child.pid) : true;
    if (reason || !clean || !isRecord(reply)) {
      if (stderr) console.error("Structured tool stopped without a valid result:", stderr);
      throw new MoguriError(effectful ? "tool_partial" : "tool_worker", `${reason ?? "Structured worker failed its output/heap boundary."} ${effectful ? "An admitted database/app effect may already exist; inspect before retrying." : "No successful data result was acknowledged."}`, 409);
    }
    if (reply.ok !== true) throw new MoguriError(typeof reply.code === "string" ? reply.code : "tool_data", typeof reply.message === "string" ? reply.message : "Structured operation failed.", 409);
    if (typeof reply.maxRssKiB !== "number" || reply.maxRssKiB > 384 * 1024) throw new MoguriError(effectful ? "tool_partial" : "tool_worker", "Structured result exceeded its observed memory boundary; inspect any admitted database/app effects.");
    return reply.value;
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", stop); if (child.connected) child.disconnect();
    if (temporary && temporaryOwner && clean && isRecord(reply) && reply.ok === true && isRecord(reply.value) && reply.value.closedKnownTarget === true) {
      const current = await lstat(temporary);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== temporaryOwner.dev || current.ino !== temporaryOwner.ino || current.uid !== temporaryOwner.uid) {
        throw new MoguriError("tool_partial", "The original private app profile changed ownership. No replacement directory was deleted; inspect the retained app operation.", 409);
      }
      await rm(temporary, { recursive: true, force: true });
    }
    else if (temporary) console.error("Owned app temporary profile retained for unconfirmed cleanup:", temporary);
  }
}
export async function executeDataTool(root: string, call: ToolCall, signal: AbortSignal, started: (pid: number) => void, policy: FolderPolicy = { denied: [], readOnly: [] }) {
  const input = call.arguments, name = String(input.path), writesDatabase = call.name === "sqlite_transaction";
  const path = await scopedPath(root, name, writesDatabase || call.name === "write_document");
  if (call.name === "sqlite_query" || writesDatabase) {
    try {
      const result = await runDataTask({ kind: call.name, arguments: input, path }, signal, started, writesDatabase);
      return { text: JSON.stringify(result), isError: false, outcome: "completed" };
    } catch (error) {
      if (!(error instanceof MoguriError && error.code === "tool_partial")) throw error;
      return { text: error.message, isError: true, outcome: "partial" };
    }
  }
  if (call.name === "inspect_document") {
    const source = await readRegularFile(path, 8 * 1024 * 1024), digest = bytesDigest(source);
    if (input.expectedDigest !== undefined && input.expectedDigest !== digest) throw new MoguriError("file_conflict", "The original document changed. No newer bytes were substituted for this source.", 409);
    const value = await runDataTask({ kind: call.name, arguments: input, source: source.toString("base64") }, signal, started);
    if (!isRecord(value) || typeof value.rawText !== "string") throw new MoguriError("document_output", "Inspection returned no complete bounded inert extraction.");
    const { rawText, ...view } = value;
    const instructions = (await repositoryInstructionLayers(root, { ...defaultProjectSettings(), deniedFolders: policy.denied, readOnlyFolders: policy.readOnly }, name)).filter((layer) => layer.depth > 0);
    const text = JSON.stringify({ ...view, path: name, digest, originalBytes: source.length, ...(instructions.length ? { instructions } : {}) });
    if (Buffer.byteLength(text) > 128 * 1024) throw new MoguriError("document_view_limit", "The complete selected view/instructions exceed 128 KiB. Narrow the selection; no instructions were omitted.");
    return { text, rawText, rawComplete: true, isError: false, outcome: "completed" };
  }
  let source: Buffer | undefined;
  try {
    source = await readRegularFile(path, 8 * 1024 * 1024);
    if (bytesDigest(source) !== input.expectedDigest) throw new MoguriError("file_conflict", "The original document changed. Inspect it before editing or replacing.", 409);
  } catch (error) {
    if (!(input.expectedDigest === "absent" && error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const format = extname(name).slice(1).toLowerCase();
  if (call.name === "write_document" && format !== input.format) throw new MoguriError("document_format", "The exact extension must match the selected output format.");
  const result = await runDataTask({ kind: call.name, arguments: input, ...(source ? { source: source.toString("base64") } : {}) }, signal, started);
  if (!isRecord(result) || typeof result.bytes !== "string" || result.bytes.length > 12 * 1024 * 1024) throw new MoguriError("document_output", "Authoring returned no complete bounded document.");
  const bytes = Buffer.from(result.bytes, "base64");
  if (!bytes.length || bytes.toString("base64") !== result.bytes) throw new MoguriError("document_output", "Authoring returned invalid original bytes.");
  signal.throwIfAborted();
  let attempted = false;
  try {
    const hash = await writeProjectBytes(root, name, bytes, String(input.expectedDigest), { signal, beforeCommit: () => { attempted = true; } });
    signal.throwIfAborted();
    return { text: JSON.stringify({ path: name, digest: hash, bytes: bytes.length, format, summary: result.summary }), isError: false, outcome: "completed" };
  } catch (error) {
    if (!attempted) throw error;
    return { text: `Document publication may already have occurred. ${error instanceof Error ? error.message : "Acknowledgement lost"} Inspect the exact file before retrying.`, isError: true, outcome: "partial" };
  }
}
