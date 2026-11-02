import { createHash } from "node:crypto";
import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { LanguageToolSchema } from "../../../packages/protocol/src/language-tools.ts";
import { readProjectFile } from "./files.ts";
import { assertFolderAccess, type FolderPolicy } from "./project-policy.ts";
import { findProjectFiles } from "./lean-files.ts";
import { runDataTask } from "./data-tools.ts";

export async function languageTool(root: string, name: string, input: Record<string, unknown>, policy: FolderPolicy, signal: AbortSignal, started: (pid: number) => void) {
  const args = parse(LanguageToolSchema, input);
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(args.path)) throw new MoguriError("language_unsupported", "Definitions/references currently support JavaScript and TypeScript only. No regex/name backend was substituted.");
  await assertFolderAccess(root, args.path, false, policy);
  const inventory = await findProjectFiles(root, { pattern: "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", path: args.scope ?? ".", limit: 100 }, policy, signal, started);
  const second = inventory.nextOffset !== null ? await findProjectFiles(root, { pattern: "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", path: args.scope ?? ".", limit: 100, offset: inventory.nextOffset }, policy, signal, started) : null;
  const paths = [...new Set([args.path, ...inventory.files, ...second?.files ?? []])];
  if (paths.length > 200) throw new MoguriError("language_limit", "The requested source plus inventory exceeds 200 files. Narrow the explicit scope.");
  const files = [];
  let bytes = 0;
  for (const path of paths) {
    signal.throwIfAborted(); await assertFolderAccess(root, path, false, policy);
    const file = await readProjectFile(root, path);
    bytes += file.bytes;
    if (file.bytes > 128 * 1024 || bytes > 2 * 1024 * 1024) throw new MoguriError("language_limit", "Semantic snapshots allow 128 KiB per file and 2 MiB total. Narrow the scope; no source was truncated.");
    files.push({ path, text: file.text, digest: file.digest });
  }
  const selected = files.find((file) => file.path === args.path)!;
  if (args.expectedDigest && args.expectedDigest !== selected.digest) throw new MoguriError("language_stale", "The requested source version changed. Review its actual bytes before selecting a new location.", 409);
  const snapshotDigest = createHash("sha256").update(JSON.stringify(files.map(({ path, digest }) => ({ path, digest })))).digest("hex");
  if (args.offset && !args.snapshotDigest || args.snapshotDigest && args.snapshotDigest !== snapshotDigest) throw new MoguriError("language_stale", "Semantic continuation requires the exact current captured source set. No newer corpus was substituted.", 409);
  const value = await runDataTask({ kind: name === "goto_definition" ? "language.definition" : "language.references", arguments: args, seed: { files } }, signal, started);
  if (!isRecord(value) || !Array.isArray(value.locations)) throw new MoguriError("language_output", "The compiler returned no bounded typed location result.");
  for (const file of files) {
    signal.throwIfAborted();
    if ((await readProjectFile(root, file.path)).digest !== file.digest) throw new MoguriError("language_stale", "The source set changed during analysis. No obsolete locations were called current.", 409);
  }
  const result = { ...value, snapshotDigest, sourceDigest: selected.digest, admittedFiles: files.length,
    inventoryComplete: inventory.complete && (!second || second.complete && second.nextOffset === null), scope: args.scope ?? "." };
  const rawText = JSON.stringify(result);
  return { text: Buffer.byteLength(rawText) <= 12000 ? rawText : JSON.stringify({ backend: value.backend, symbol: value.symbol,
    snapshotDigest, sourceDigest: selected.digest, complete: false, detail: "The complete typed locations are retained with read_tool_result." }),
    rawText, rawComplete: true, isError: false, outcome: "completed" };
}
