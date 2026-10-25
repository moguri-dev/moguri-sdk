import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryContext } from "../apps/service/src/project-policy.ts";
import { defaultProjectSettings } from "../packages/protocol/src/index.ts";
import { executeTool } from "../apps/service/src/tools.ts";
import { parseSearchPage } from "../apps/service/src/web-search.ts";

test("instruction inheritance is complete, scoped and ordered, with moguri.md after AGENTS.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-instructions-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "AGENTS.md"), "Generated root rule.");
    await writeFile(join(root, "moguri.md"), "Generated root supplement.");
    await writeFile(join(root, "nested", "AGENTS.md"), "Generated nested rule.");
    await writeFile(join(root, "nested", "moguri.md"), "Generated nested supplement.");
    await writeFile(join(root, "nested", "large.ts"), Array.from({ length: 400 }, (_, index) => `export const generated${index} = ${index};`).join("\n"));
    const context = await repositoryContext(root, defaultProjectSettings(), "nested/large.ts");
    for (const text of ["Generated root rule.", "Generated root supplement.", "Generated nested rule.", "Generated nested supplement."]) assert.ok(context.includes(text));
    assert.ok(context.indexOf("Generated root rule.") < context.indexOf("Generated root supplement."));
    assert.ok(context.indexOf("Generated nested rule.") < context.indexOf("Generated nested supplement."));
    const result = await executeTool(root, { id: "read", name: "read_file", arguments: { path: "nested/large.ts", mode: "outline" } }, new AbortController().signal, () => {}, () => {});
    const view = JSON.parse(result.text);
    assert.equal(view.complete, false);
    assert.ok(view.instructions.some((source: { path: string }) => source.path === "nested/moguri.md"));
    assert.ok(result.rawText?.includes("generated399"));
    await assert.rejects(() => repositoryContext(root, defaultProjectSettings(), "../outside"), { code: "path_denied" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("keyless search extracts cited bounded results and rejects challenge pages instead of fake empty success", () => {
  const result = parseSearchPage('<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fgenerated">Generated title</a><a class="result__snippet">Generated snippet</a></div>', 3);
  assert.equal(result.results[0]?.url, "https://example.org/generated");
  assert.equal(result.results[0]?.title, "Generated title");
  assert.throws(() => parseSearchPage('<form id="challenge-form">Verify you are human</form>', 3), { code: "web_search_blocked" });
  assert.throws(() => parseSearchPage('<a class="result__a" href="javascript:alert(1)">Unsafe</a>', 3), { code: "web_search_blocked" });
});
