import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MoguriSdk, defaultProjectSettings, isRecord } from "../packages/sdk/src/index.ts";
import { detectInstallers } from "../apps/service/src/installer-detection.ts";
import { workflowMediaGuidance } from "../apps/service/src/platform.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("installer detection reads only root package scripts and Makefile targets, with the project's runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-installers-"));
  try {
    assert.deepEqual(await detectInstallers(root), []);
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {
      build: "vite build", test: "node --test", "package:mac": "npm run build && node scripts/package.mjs", dist: "electron-builder --win",
      prepackage: "echo generated", lint: "eslint .", release: "changeset publish",
    } }));
    await writeFile(join(root, "pnpm-lock.yaml"), "generated: true\n");
    await writeFile(join(root, "Makefile"), "build:\n\tcc main.c\ndmg: build\n\thdiutil create out.dmg\nVAR := dmg\n");
    assert.deepEqual((await detectInstallers(root)).map((candidate) => [candidate.source, candidate.run]), [
      ["Makefile", "make dmg"], ["package.json", "pnpm run package:mac"], ["package.json", "pnpm run dist"],
    ]);
    const linked = await mkdtemp(join(tmpdir(), "moguri-generated-linked-"));
    try {
      await rm(join(root, "package.json")); await symlink(join(linked, "package.json"), join(root, "package.json"));
      await writeFile(join(linked, "package.json"), JSON.stringify({ scripts: { "package:mac": "electron-builder" } }));
      assert.deepEqual((await detectInstallers(root)).map((candidate) => candidate.run), ["make dmg"], "a linked manifest is not read");
    } finally { await rm(linked, { recursive: true, force: true }); }
    await rm(join(root, "package.json")); await writeFile(join(root, "package.json"), "{ not json");
    assert.deepEqual((await detectInstallers(root)).map((candidate) => candidate.run), ["make dmg"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("screenshot and installer guidance follows the project's preferences", () => {
  const settings = defaultProjectSettings();
  assert.match(workflowMediaGuidance(settings), /capture each affected screen after the change/);
  assert.match(workflowMediaGuidance(settings), /Moguri asks the user separately/);
  settings.repo = { ...settings.repo, screenshots: "off", installers: "build", installerCommand: "npm run package:mac" };
  const guidance = workflowMediaGuidance(settings);
  assert.match(guidance, /opted out of automatic UI screenshots/);
  assert.match(guidance, /run `npm run package:mac` once in this session's workspace under normal approvals/);
  settings.repo = { ...settings.repo, installers: "skip" };
  assert.doesNotMatch(workflowMediaGuidance(settings), /asks the user separately|run `/);
});

test("project preferences are saved, validated and reach the agent's instructions", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await writeFile(join(f.project, "package.json"), JSON.stringify({ scripts: { "package:mac": "electron-builder --mac" } }));
    assert.deepEqual((await sdk.projects.installers(f.session().projectId)).map((candidate) => candidate.run), ["npm run package:mac"]);
    const { configuration } = await sdk.projects.configuration(f.session().projectId);
    await assert.rejects(sdk.projects.configure(f.session().projectId, { ...configuration.values, repo: { ...configuration.values.repo, installers: "build", installerCommand: "npm run a\nrm -rf /" } }, configuration.revision));
    await sdk.projects.configure(f.session().projectId, { ...configuration.values, repo: { ...configuration.values.repo, installers: "build", installerCommand: "npm run package:mac" } }, configuration.revision);
    await f.configure();
    await f.send("Generated task");
    await waitFor(() => f.requests.some((request) => Array.isArray(request.messages)));
    const request = f.requests.find((value) => Array.isArray(value.messages))!;
    const system = (request.messages as unknown[]).filter(isRecord).find((message) => message.role === "system");
    assert.match(String(system?.content), /Screenshots: whenever a change affects anything a person sees/);
    assert.match(String(system?.content), /run `npm run package:mac` once/);
  } finally { sdk.disconnect(); await f.close(); }
});
