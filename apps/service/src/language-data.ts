import { API, SymbolFlags, type NodeHandle } from "typescript/unstable/async";
import { getTokenAtPosition, type SourceFile } from "typescript/unstable/ast";
import { parse, MoguriError } from "../../../packages/protocol/src/core.ts";
import { LanguageSeedSchema, LanguageToolSchema } from "../../../packages/protocol/src/language-tools.ts";

export async function semanticSnapshot(input: Record<string, unknown>, seed: unknown, definitions: boolean) {
  const args = parse(LanguageToolSchema, input), source = parse(LanguageSeedSchema, seed), prefix = "/moguri-source/";
  const files = new Map(source.files.map((file) => [prefix + file.path, file.text]));
  const key = (path: string) => process.platform === "darwin" ? path.normalize("NFC").toLowerCase() : path;
  const originals = new Map(source.files.map((file) => [key(prefix + file.path), file]));
  if (originals.size !== source.files.length || source.files.some((file) => !file.path.isWellFormed() || file.path.startsWith("/") ||
    file.path.split(/[\\/]/).some((part) => part === "..")) || Buffer.byteLength(JSON.stringify(source)) > 4 * 1024 * 1024) {
    throw new MoguriError("language_snapshot", "The captured source set is ambiguous or exceeds its exact virtual-filesystem bound.");
  }
  const config = prefix + "tsconfig.json";
  files.set(config, JSON.stringify({ compilerOptions: { noEmit: true, noLib: true, allowJs: true, checkJs: true,
    module: "esnext", moduleResolution: "bundler", jsx: "preserve" }, files: source.files.map((file) => file.path) }));
  const directories = new Map<string, { files: Set<string>; directories: Set<string> }>();
  for (const path of files.keys()) {
    const parts = path.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      const directory = "/" + parts.slice(0, index).join("/");
      const entries = directories.get(directory) ?? { files: new Set<string>(), directories: new Set<string>() };
      (index === parts.length - 1 ? entries.files : entries.directories).add(parts[index]!);
      directories.set(directory, entries);
    }
  }
  const api = new API({ fs: {
    readFile: (path) => files.get(path) ?? null, fileExists: (path) => files.has(path),
    directoryExists: (path) => directories.has(path), realpath: (path) => path,
    getAccessibleEntries: (path) => { const entries = directories.get(path); return {
      files: entries ? [...entries.files] : [], directories: entries ? [...entries.directories] : [],
    }; },
  } });
  let snapshot: Awaited<ReturnType<API["updateSnapshot"]>> | undefined;
  try {
    snapshot = await api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProject(config), path = prefix + args.path;
    if (!project) throw new MoguriError("language_project", "The compiler did not admit the exact closed source snapshot.");
    const file = await project.program.getSourceFile(path);
    if (!file || !originals.has(key(file.fileName))) throw new MoguriError("language_source", "The requested source is not part of the admitted compiler snapshot.");
    const lines = file.getLineStarts(), start = lines[args.line - 1];
    if (start === undefined) throw new MoguriError("language_position", "The selected line is outside this exact source version.");
    const position = start + args.column - 1, next = lines[args.line] ?? file.text.length;
    if (position >= next || position >= file.text.length) throw new MoguriError("language_position", "The selected UTF-16 column is outside this exact source line.");
    const token = getTokenAtPosition(file, position);
    if (token.getStart(file) > position || token.getEnd() <= position) throw new MoguriError("language_symbol", "Choose the exact semantic token, not adjacent whitespace or a guessed name.");
    let symbol = await project.checker.getSymbolAtPosition(path, position);
    if (!symbol || await project.checker.isUnknownSymbol(symbol)) throw new MoguriError("language_symbol", "No resolved workspace symbol exists here. Standard libraries, dependencies and unsupported syntax were not replaced by name/regex matches.");
    if (symbol.flags & SymbolFlags.Alias) symbol = await project.checker.getAliasedSymbol(symbol);
    if (await project.checker.isUnknownSymbol(symbol)) throw new MoguriError("language_symbol", "The alias is unresolved within the admitted workspace snapshot. No external file was read.");
    const referenced = definitions ? null : await project.checker.getReferencedSymbolsForNode(token, position);
    const handles: readonly NodeHandle[] = definitions ? symbol.declarations : referenced!.flatMap((entry) => entry.references);
    if (handles.length > 10000) throw new MoguriError("language_limit", "The actual semantic result exceeds 10,000 locations. Narrow the scope; no result was silently truncated.");
    const locations = [];
    for (const handle of handles) {
      const original = originals.get(key(handle.path)), node = await handle.resolve();
      if (!original || !node) throw new MoguriError("language_scope", "A compiler location escaped the exact captured source set. No host/dependency location was substituted.");
      const sourceFile: SourceFile = node.getSourceFile(), begin = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      locations.push({ path: original.path, digest: original.digest, line: begin.line + 1, column: begin.character + 1,
        endLine: end.line + 1, endColumn: end.character + 1 });
    }
    const unique = [...new Map(locations.map((location) => [JSON.stringify(location), location])).values()]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line || a.column - b.column);
    const offset = args.offset ?? 0;
    if (offset > unique.length) throw new MoguriError("language_cursor", "Use a returned cursor from this exact semantic snapshot.");
    const selected = unique.slice(offset, offset + 100);
    return { backend: "TypeScript 7.0.2 native semantic API", symbol: symbol.name, locations: selected,
      totalLocations: unique.length, nextOffset: offset + selected.length < unique.length ? offset + selected.length : null,
      columns: "1-based UTF-16", limitations: "Approved JS/TS snapshot only; no standard library, installed dependency types, custom config/plugins or native filesystem fallback." };
  } finally { await snapshot?.dispose(); await api.close(); }
}
