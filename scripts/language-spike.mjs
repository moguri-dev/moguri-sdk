import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { API } from "typescript/unstable/async";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { getTokenAtPosition } from "typescript/unstable/ast";

const files = {
  "/moguri-source/tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true, noLib: true, allowJs: true, module: "esnext", moduleResolution: "bundler" }, files: ["a.ts", "b.ts"] }),
  "/moguri-source/a.ts": "export function increase(value: number) { return value + 1; }\n",
  "/moguri-source/b.ts": 'import { increase as bump } from "./a";\nconst increase = "not a reference";\nbump(2);\n',
};
const virtual = createVirtualFileSystem(files), denied = [];
const api = new API({ fs: { ...virtual,
  readFile: (path) => { if (!Object.hasOwn(files, path)) denied.push(path); return files[path] ?? null; },
  getAccessibleEntries: (path) => virtual.getAccessibleEntries(path) ?? { files: [], directories: [] },
}, collectTiming: true });
const start = performance.now();
try {
  const snapshot = await api.updateSnapshot({ openProjects: ["/moguri-source/tsconfig.json"] });
  const project = snapshot.getProject("/moguri-source/tsconfig.json");
  assert.ok(project);
  const symbol = await project.checker.getSymbolAtPosition("/moguri-source/a.ts", files["/moguri-source/a.ts"].indexOf("increase"));
  assert.ok(symbol); assert.equal(symbol.name, "increase");
  const definitions = await Promise.all(symbol.declarations.map(async (handle) => {
    const node = await handle.resolve(); assert.ok(node);
    return { path: handle.path, pos: node.pos, end: node.end };
  }));
  const source = await project.program.getSourceFile("/moguri-source/a.ts");
  assert.ok(source);
  const position = files["/moguri-source/a.ts"].indexOf("increase");
  const referenced = await project.checker.getReferencedSymbolsForNode(getTokenAtPosition(source, position), position);
  const references = await Promise.all(referenced.flatMap((entry) => entry.references).map(async (handle) => {
    const node = await handle.resolve(); assert.ok(node);
    return { path: handle.path, pos: node.getStart(), end: node.getEnd() };
  }));
  assert.ok(definitions.some((entry) => entry.path === "/moguri-source/a.ts"));
  assert.ok(references.some((entry) => entry.path === "/moguri-source/b.ts" && files[entry.path].slice(entry.pos, entry.end).trim() === "bump"));
  assert.equal(references.some((entry) => entry.path === "/moguri-source/b.ts" && files[entry.path].slice(entry.pos, entry.end).includes("not a reference")), false);
  console.log(JSON.stringify({ primitive: "typescript-7-native-semantic-api", status: "PASS", elapsedMs: performance.now() - start,
    definitions, references, deniedFilesystemFallbacks: denied.length, filesystem: "All five callbacks, unknown reads null and directories empty; no real source root, plugins or host fallback.", timing: await api.getTimingInfo() }, null, 2));
  await snapshot.dispose();
} finally { await api.close(); }
