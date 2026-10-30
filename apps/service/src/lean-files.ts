import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { normalize } from "node:path";
import { performance } from "node:perf_hooks";
import { parseDocument } from "yaml";
import { MoguriError, isRecord } from "../../../packages/protocol/src/index.ts";
import { readProjectFile, writeProjectBytes, isProtectedProjectPath, textFilePage } from "./files.ts";
import { assertFolderAccess, matchesFolder, repositoryInstructionLayers, type FolderPolicy } from "./project-policy.ts";
import { defaultProjectSettings } from "../../../packages/protocol/src/sessions.ts";
import { groupExists, stopGroup } from "./supervisor.ts";
import { Writable } from "node:stream";
import { isUtf8 } from "node:buffer";

export interface ProgramResult { stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null; elapsedMs: number; clipped: boolean; timedOut: boolean; cleanup: boolean }
export async function boundedProgram(root: string, executable: string, args: string[], signal: AbortSignal, options: { input?: string; keepInputOpen?: boolean; inputFd3?: string; home?: string; rejectBackground?: boolean; timeoutMs?: number; maxBytes?: number; started?: (pid: number) => void } = {}): Promise<ProgramResult> {
  signal.throwIfAborted();
  const started = performance.now(), maximum = options.maxBytes ?? 512 * 1024;
  const child = spawn(executable, args, { cwd: root, detached: true, stdio: ["pipe", "pipe", "pipe", ...(options.inputFd3 === undefined ? [] : ["pipe" as const])],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "en_US.UTF-8", LC_ALL: "C", NO_COLOR: "1", GIT_PAGER: "cat", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", ...(options.home ? { HOME: options.home } : {}) } });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let bytes = 0, clipped = false, timedOut = false, stopping: Promise<boolean> | undefined;
  const stop = () => { if (child.pid) stopping ??= stopGroup(child.pid); };
  const collect = (value: Buffer, error: boolean) => {
    const remaining = Math.max(0, maximum - bytes);
    (error ? stderr : stdout).push(value.subarray(0, remaining));
    bytes += value.length;
    if (bytes > maximum) { clipped = true; stop(); }
  };
  child.stdout.on("data", (value: Buffer) => collect(value, false));
  child.stderr.on("data", (value: Buffer) => collect(value, true));
  child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") { console.error("Tool input failed:", error.code); stop(); } });
  if (options.keepInputOpen) { if (options.input) child.stdin.write(options.input); }
  else child.stdin.end(options.input);
  if (options.inputFd3 !== undefined) {
    const channel = child.stdio[3];
    if (!(channel instanceof Writable)) { stop(); throw new MoguriError("tool_input", "The owned script source pipe was not created. No alternative input transport was used."); }
    channel.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") { console.error("Script source input failed:", error.code); stop(); } });
    channel.end(options.inputFd3);
  }
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 10000);
  try {
    child.once("spawn", () => { if (child.pid) options.started?.(child.pid); if (signal.aborted) stop(); });
    const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", (error: NodeJS.ErrnoException) => reject(new MoguriError("tool_program", `${executable} could not start (${error.code ?? "unknown"}). Install/configure it in this exact execution environment; no fallback was used.`)));
      child.once("close", (exitCode, exitSignal) => resolve({ exitCode, signal: exitSignal }));
    });
    const background = options.rejectBackground && !stopping && child.pid && groupExists(child.pid);
    const cleanup = stopping ? await stopping : child.pid ? await stopGroup(child.pid) : true;
    if (!cleanup) throw new MoguriError("tool_partial", "The exact owned program group did not confirm cleanup. Inspect it before resuming; no successful cancellation was inferred.");
    if (background) throw new MoguriError("tool_partial", "Background descendants survived the reviewed script and the known group was stopped. Inspect the original effects before retrying; no complete success was inferred.");
    signal.throwIfAborted();
    const decode = (parts: Buffer[]) => {
      let buffer = Buffer.concat(parts);
      for (let count = 0; clipped && count < 3 && !isUtf8(buffer); count++) buffer = buffer.subarray(0, Math.max(0, buffer.length - 1));
      if (!isUtf8(buffer)) throw new MoguriError("tool_encoding", "Program output is not valid UTF-8. No replacement characters or successful text result were invented.");
      return buffer.toString("utf8");
    };
    return { ...result, stdout: decode(stdout), stderr: decode(stderr), elapsedMs: performance.now() - started, clipped, timedOut, cleanup };
  } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
}
export function programSucceeded(result: ProgramResult, allowed = [0]): void {
  if (result.clipped || result.timedOut || !result.cleanup || !allowed.includes(result.exitCode ?? -1)) {
    throw new MoguriError(result.cleanup ? "tool_program_failed" : "tool_partial", `Program did not complete: exit=${result.exitCode}, deadline=${result.timedOut}, clipped=${result.clipped}, cleanup=${result.cleanup}. ${result.stderr.slice(0, 1000)}`);
  }
}
export async function editProjectFile(root: string, args: { path: string; expectedDigest: string; edits: { oldText: string; newText: string }[] }, signal: AbortSignal) {
  const file = await readProjectFile(root, args.path, 1024 * 1024);
  if (file.digest !== args.expectedDigest) throw new MoguriError("file_conflict", "The source changed. Read it again before editing.", 409);
  let text = file.text;
  for (const edit of args.edits) {
    if (!edit.oldText.isWellFormed() || !edit.newText.isWellFormed() || edit.newText.includes("\0")) throw new MoguriError("edit_text", "Edits need lossless UTF-8 text, without NUL.");
    const at = text.indexOf(edit.oldText);
    if (at < 0 || text.indexOf(edit.oldText, at + 1) !== -1) throw new MoguriError("edit_match", "Each oldText must match exactly once in the current sequential edit. No edits were published.", 409);
    text = text.slice(0, at) + edit.newText + text.slice(at + edit.oldText.length);
  }
  signal.throwIfAborted();
  let attempted = false;
  try {
    if (Buffer.byteLength(text) > 1024 * 1024) throw new MoguriError("edit_limit", "Edited text exceeds 1 MiB. Split the operation explicitly.");
    const hash = await writeProjectBytes(root, args.path, Buffer.from(text), file.digest, { signal, beforeCommit: () => { attempted = true; } });
    return { text: JSON.stringify({ path: file.path, digest: hash, edits: args.edits.length, bytes: Buffer.byteLength(text) }), isError: false, outcome: "completed" };
  } catch (error) {
    if (!attempted) throw error;
    return { text: `File publication may have occurred: ${error instanceof Error ? error.message : "unconfirmed write"}. Inspect the source before retrying.`, isError: true, outcome: "partial" };
  }
}
export async function readFileSelection(root: string, args: Record<string, unknown>, policy: FolderPolicy, repository?: string) {
    const paged = args.offset !== undefined || args.limit !== undefined || args.search !== undefined;
    const file = await readProjectFile(root, String(args.path), args.mode === "full" && !paged ? 128 * 1024 : 1024 * 1024);
    if (args.requireExactVersion === true && args.expectedDigest === undefined) throw new MoguriError("file_version", "An exact-version read needs an original expectedDigest. Use an ordinary read to obtain the current source reference.");
    const refreshed = args.expectedDigest !== undefined && args.expectedDigest !== file.digest;
    if (refreshed && args.requireExactVersion === true) throw new MoguriError("file_conflict", "The explicitly pinned file version changed. Read the current source without requireExactVersion, or inspect the original retained result. No write occurred.", 409);
    const continuationReset = refreshed && Number(args.offset ?? 0) > 0;
    const selection = continuationReset ? { ...args, offset: 0 } : args;
    const instructions = (await repositoryInstructionLayers(root, { ...defaultProjectSettings(), deniedFolders: policy.denied, readOnlyFolders: policy.readOnly }, file.path)).filter((layer) => layer.depth > 0);
    const lines = file.text.split("\n");
    let view: Record<string, unknown> = { ...file, view: "full", complete: true };
    if (paged) view = { ...file, ...textFilePage(file.text, selection), complete: false, view: "byte-page" };
    else if (args.mode === "lines") {
      const start = Number(args.startLine ?? 1), end = Number(args.endLine ?? start + 99);
      if (start > lines.length || end < start) throw new MoguriError("file_lines", "Select an ascending existing 1-based line range.");
      let text = "", nextLine = start;
      for (let line = start; line <= Math.min(end, lines.length); line++) {
        const value = `${line}: ${lines[line - 1]}\n`;
        if (Buffer.byteLength(text + value) > 12000) break;
        text += value; nextLine = line + 1;
      }
      if (nextLine === start) throw new MoguriError("file_lines", "This line exceeds the view bound. Use UTF-8 byte paging instead.");
      view = { ...file, text, view: "lines", startLine: start, nextLine: nextLine <= Math.min(end, lines.length) ? nextLine : null, complete: start === 1 && nextLine > lines.length };
    } else if (args.mode === "outline" || args.mode !== "full" && (file.bytes > 16384 || lines.length > 200)) {
      const selected = new Set<number>();
      lines.forEach((line, index) => { if (/^\s*(?:export\b|import\b|(?:async\s+)?(?:function|class|interface|type|enum|def|fn|struct|impl|pub)\b|#{1,6}\s)/.test(line)) selected.add(index); });
      if (!selected.size) { for (let index = 0; index < Math.min(20, lines.length); index++) selected.add(index); for (let index = Math.max(20, lines.length - 10); index < lines.length; index++) selected.add(index); }
      const shown: number[] = []; let text = "";
      for (const index of [...selected].sort((a, b) => a - b)) {
        const row = `${index + 1}: ${lines[index]!.slice(0, 300)}\n`;
        if (shown.length >= 100 || Buffer.byteLength(text + row) > 12000) break;
        shown.push(index); text += row;
      }
      view = { ...file, text, view: "structural-preview", complete: shown.length === lines.length && shown.every((index) => lines[index]!.length <= 300),
        omittedLines: lines.length - shown.length, columnsBoundedAt: 300, diagnostic: "Deterministic definition/import/heading preview, not a semantic or complete code summary. Use exact line/byte reads before conclusions." };
    }
    const text = JSON.stringify({ ...view, ...(instructions.length ? { instructions } : {}),
      ...(refreshed ? { sourceVersion: { refreshed: true, requestedDigest: args.expectedDigest, currentDigest: file.digest, continuationReset,
        diagnostic: continuationReset ? "The file changed; byte continuation restarted at zero. Earlier pages are not this version." : "The file changed; this is its current permitted version. Use the fresh sourceRef for edits." } } : {}),
      sourceRef: { path: file.path, expectedDigest: file.digest, ...(repository ? { repository } : {}) },
      sourceRetention: "retained-source" });
    if (text.length > 128 * 1024) throw new MoguriError("file_view_limit", "The complete selected text/instructions exceed the tool envelope. Select a smaller explicit view; no instructions were omitted.");
    return { text, rawText: file.text, rawComplete: true, isError: false, outcome: "completed" };
}
function searchExclusions(policy: FolderPolicy): string[] {
  const literal = (folder: string) => normalize(folder).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "").replace(/[?*[\]{}!]/g, "\\$&");
  return ["**/{.git,.moguri,node_modules,.ssh,.aws,.azure,.kube,.docker,Moguri}", "**/{.git,.moguri,node_modules,.ssh,.aws,.azure,.kube,.docker,Moguri}/**", "**/.moguri-dependencies-*", "**/.moguri-dependencies-*/**",
    "**/{.npmrc,.pypirc,.netrc,.git-credentials}", "**/.env*", "**/*.{pem,key,p12,pfx}", "**/{credentials,id_rsa,id_ed25519}{,.*}",
    ...policy.denied.flatMap((folder) => [literal(folder), `${literal(folder)}/**`])].flatMap((pattern) => ["--iglob", `!${pattern}`]);
}
const ignoreFlags = ["--hidden", "--no-follow", "--no-ignore-global", "--no-require-git"];
export async function findProjectFiles(root: string, args: { pattern: string; path?: string; offset?: number; limit?: number }, policy: FolderPolicy, signal: AbortSignal, started: (pid: number) => void = () => {}) {
  root = await realpath(root);
  await assertFolderAccess(root, args.path ?? ".", false, policy);
  const result = await boundedProgram(root, "rg", ["--files", "--null", ...ignoreFlags, ...searchExclusions(policy), "--", args.path ?? "."], signal, { timeoutMs: 5000, started });
  if (!result.clipped && !result.timedOut || !result.cleanup) programSucceeded(result, [0, 1]);
  // Explicit rg globs override ignore rules; intersect with the ordinary inventory.
  const matching = await boundedProgram(root, "rg", ["--files", "--null", ...ignoreFlags, "--glob", `/${args.pattern.replace(/^\//, "")}`, ...searchExclusions(policy), "--", args.path ?? "."], signal, { timeoutMs: 5000, started });
  if (!matching.clipped && !matching.timedOut || !matching.cleanup) programSucceeded(matching, [0, 1]);
  const observed = result.stdout.split("\0");
  if (observed.at(-1) === "" || result.clipped) observed.pop();
  const selected = matching.stdout.split("\0");
  if (selected.at(-1) === "" || matching.clipped) selected.pop();
  const names = new Set(selected.map((name) => name.replace(/^\.\//, "")));
  const complete = !result.clipped && !result.timedOut && !matching.clipped && !matching.timedOut && observed.length <= 10000;
  const files = observed.slice(0, 10000).map((name) => name.replace(/^\.\//, ""))
    .filter((name) => !isProtectedProjectPath(name) && !matchesFolder(name, policy.denied) && names.has(name));
  files.sort();
  const offset = args.offset ?? 0, limit = args.limit ?? 100;
  if (offset > files.length) throw new MoguriError("file_cursor", "This offset is outside the observed file inventory. Start again.");
  const page: string[] = [];
  for (const name of files.slice(offset, offset + limit)) { if (Buffer.byteLength(JSON.stringify([...page, name])) > 12000) break; page.push(name); }
  return { files: page, nextOffset: offset + page.length < files.length ? offset + page.length : null,
    complete, observedMatches: files.length, visited: Math.min(observed.length, 10000), omitted: Math.max(0, files.length - offset - page.length),
    observation: "Bounded ripgrep inventory honoring applicable ancestor/nested .gitignore/.ignore/.rgignore metadata. No global ignore/config injection or atomic filesystem snapshot." };
}
export async function searchProjectFiles(root: string, args: { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; context?: number; limit?: number }, policy: FolderPolicy, signal: AbortSignal, started: (pid: number) => void) {
  const path = args.path ?? ".";
  await assertFolderAccess(root, path, false, policy);
  const flags = ["--json", ...ignoreFlags, "--context", String(args.context ?? 2)];
  if (args.literal) flags.push("--fixed-strings");
  if (args.ignoreCase) flags.push("--ignore-case");
  if (args.glob) flags.push("--glob", args.glob);
  flags.push(...searchExclusions(policy));
  const result = await boundedProgram(root, "rg", [...flags, "--", args.pattern, path], signal, { started });
  if (!result.clipped && !result.timedOut || !result.cleanup) programSucceeded(result, [0, 1]);
  const matches: { path: string; line: number; text: string; context: boolean; clipped: boolean }[] = [];
  const raw: string[] = []; let omitted = 0, unsupportedRecords = 0;
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { if (result.clipped) continue; throw new MoguriError("search_output", "ripgrep returned malformed JSON; no complete result was inferred."); }
    if (!isRecord(value) || !["match", "context"].includes(String(value.type)) || !isRecord(value.data)) continue;
    const data = value.data;
    if (!isRecord(data.path) || typeof data.path.text !== "string" || !isRecord(data.lines) || typeof data.lines.text !== "string" || typeof data.line_number !== "number") { unsupportedRecords++; continue; }
    const name = data.path.text.replace(/^\.\//, "");
    if (isProtectedProjectPath(name) || matchesFolder(name, policy.denied)) continue;
    raw.push(line);
    const row = { path: name, line: data.line_number, text: Array.from(data.lines.text).slice(0, 1000).join(""), context: value.type === "context", clipped: Array.from(data.lines.text).length > 1000 };
    if (matches.length >= (args.limit ?? 50) || Buffer.byteLength(JSON.stringify([...matches, row])) > 12000) { omitted++; continue; }
    matches.push(row);
  }
  return { matches, complete: !result.clipped && !result.timedOut && !omitted && !unsupportedRecords && matches.every((match) => !match.clipped), elapsedMs: result.elapsedMs,
    boundedAt: args.limit ?? 50, omittedRows: omitted, unsupportedRecords, rawText: raw.join("\n"), rawComplete: !result.clipped && !result.timedOut && !unsupportedRecords,
    diagnostic: "The view is bounded by rows and UTF-8 bytes. Only permitted UTF-8 match/context records enter retained source; unsupported binary descriptors are counted, never complete coverage. Narrow path/glob/pattern or page that exact source." };
}
export async function queryProjectData(root: string, args: { path: string; format?: "json" | "yaml"; expression: string }, signal: AbortSignal, started: (pid: number) => void) {
  const file = await readProjectFile(root, args.path);
  if (/\b(?:import|include|module|modulemeta|input|inputs|env)\b|\$ENV/.test(args.expression)) throw new MoguriError("query_scope", "This query supports stdin-only jq expressions, not modules, imports, ambient environment or additional inputs (including these reserved words inside strings).");
  const yaml = args.format === "yaml" || !args.format && /\.ya?ml$/i.test(args.path);
  let data: unknown;
  if (yaml) {
    const document = parseDocument(file.text, { uniqueKeys: true, schema: "core" });
    if (document.errors.length || document.warnings.length) throw new MoguriError("query_data", "YAML must be valid core data without unknown tags or duplicate keys.");
    data = document.toJS({ maxAliasCount: 10 });
  } else data = JSON.parse(file.text);
  const result = await boundedProgram(root, "jq", ["--compact-output", "--", args.expression], signal, { input: JSON.stringify(data), started });
  programSucceeded(result);
  return { path: file.path, digest: file.digest, format: yaml ? "yaml" : "json", expression: args.expression, text: result.stdout, elapsedMs: result.elapsedMs };
}
