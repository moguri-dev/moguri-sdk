import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { fixtureProvider, waitFor } from "../fixture.ts";

const installed = process.argv[2];
if (!installed) throw new Error("Provide the independently installed package root.");
const require = createRequire(join(installed, "package.json"));
const { spawn } = require("node-pty");
const node = require.resolve("node/bin/node");
const core = dirname(require.resolve("@opentui/core"));
for (const asset of ["markdown/tree-sitter-markdown.wasm", "markdown_inline/tree-sitter-markdown_inline.wasm"]) {
  await access(join(core, "assets", asset));
}
const { createRuntime, connectMoguri } = await import(pathToFileURL(join(installed, "dist/sdk/node.mjs")).href);
const { DraftEditor } = await import(pathToFileURL(join(installed, "dist/sdk/index.mjs")).href);
const reply = "## Generated installed Markdown\n\nKeep **readable output** without extra frames.\n\n```generated-language\nconst packaged = true;\n```\n\n[Generated installed link](https://never-fetch.invalid/review)";
const provider = await fixtureProvider({ modelId: "generated-terminal-model", responseMode: "text", replyText: reply });
const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-installed-tui-")));
const stateDir = join(directory, "state"), project = join(directory, "project"), home = join(directory, "home");
await mkdir(project); await mkdir(home);
const secrets = new Map(), vault = { read: async (id) => secrets.get(id) ?? null,
  write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); } };
let runtime, sdk, editor, tui, exit;
try {
  runtime = await createRuntime({ stateDir, retentionKey: Buffer.alloc(32, 0x67), provider: provider.provider,
    platform: { vault, terminal: { defaultRoot: home, vault }, sandbox: { setup: { automatic: false } } } });
  sdk = await connectMoguri({ stateDir, autoStart: false });
  const added = await sdk.projects.add(project), created = await sdk.sessions.create(added.id, "Generated installed terminal review");
  await sdk.sessions.selectModel(created.id, provider.modelId);
  const session = () => sdk.sessions.get(created.id);
  editor = new DraftEditor(sdk, created.id, session().draft);
  editor.edit("Generated installed terminal presentation."); await editor.send("auto");
  await waitFor(() => session()?.status === "completed" && !session().turnId);
  assert.equal(provider.requests.length, 1);
  let output = "";
  const began = performance.now();
  tui = spawn(node, [join(installed, "dist/tui.mjs"), "--project", project], {
    name: "xterm-256color", cols: 120, rows: 36, cwd: home,
    env: { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: home, TMPDIR: tmpdir(), TERM: "xterm-256color",
      COLORTERM: "truecolor", LANG: "en_US.UTF-8", MOGURI_STATE_DIR: stateDir, MOGURI_PROFILE_ID: sdk.profileId },
  });
  tui.onData((data) => { output += data; });
  tui.onExit((outcome) => { exit = outcome; });
  await waitFor(() => {
    if (exit) throw new Error(`The installed TUI exited before presentation: ${JSON.stringify(exit)}\n${stripVTControlCharacters(output)}`);
    const text = stripVTControlCharacters(output);
    return text.includes("Generated installed Markdown") && text.includes("readable output") &&
      text.includes("const packaged = true;") && text.includes("Generated installed link") && text.includes("Budget Unlimited");
  });
  const paintedMs = performance.now() - began;
  assert.ok(paintedMs <= 1500, `Cold installed TUI with the original healthy generated owner took ${paintedMs.toFixed(2)} ms; budget is 1500 ms.`);
  assert.doesNotMatch(output, /TreeSitter.*(?:failed|error)|MODULE_NOT_FOUND|Cannot find module/);
  assert.equal(session().messages.find((message) => message.role === "assistant")?.text, reply);
  assert.equal(session().draft.text, "");
  assert.equal(provider.requests.length, 1);
  tui.write("\x11");
  await waitFor(() => exit);
  assert.equal(exit.exitCode, 0, stripVTControlCharacters(output));
  assert.equal(provider.requests.length, 1);
  console.log(JSON.stringify({ primitive: "installed-cold-tui-presentation", paintedMs, reusedGeneratedService: true, modelCalls: 1 }));
} finally {
  if (tui && !exit) { tui.kill("SIGTERM"); await waitFor(() => exit); }
  editor?.dispose(); sdk?.disconnect(); await runtime?.close(); await provider.close();
  await rm(directory, { recursive: true, force: true });
}
