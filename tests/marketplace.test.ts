import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

const exec = promisify(execFile);
test("repository marketplace binds exact committed bundles and installs skills, scripts and hooks disabled", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const manifest = {
      schemaVersion: 1, name: "generated-bundle", version: "1.0.0", description: "Generated reviewed bundle", license: "MIT",
      minimumProtocol: PROTOCOL_VERSION, maximumProtocol: PROTOCOL_VERSION,
      skills: ["---\nname: generated-style\ndescription: Generated conventions\n---\nUse explicit generated fixture types."],
      scripts: [{ name: "generated-script", description: "Generated deterministic utility", content: "console.log('generated fixture');\n" }],
      hooks: [{ schemaVersion: 1, name: "generated-check", description: "Generated turn check", trigger: "turn.start", command: "printf 'generated hook\\n'", timeoutMs: 2000 }],
    };
    await writeFile(join(fixture.project, "moguri-marketplace.json"), JSON.stringify({ schemaVersion: 1, packages: [manifest] }));
    const git = (...args: string[]) => exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Generated Fixture", "-c", "user.email=fixture@example.invalid", ...args], {
      cwd: fixture.project, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    await git("init", "--quiet");
    await git("add", "--", "moguri-marketplace.json");
    await git("commit", "--quiet", "--no-gpg-sign", "-m", "Generated marketplace fixture");
    const commit = (await git("rev-parse", "HEAD")).stdout.trim(), projectId = fixture.session().projectId!;
    const input = { projectId, sourceProjectId: projectId, commit, path: "moguri-marketplace.json", packageName: manifest.name, version: manifest.version };
    const preview = await sdk.marketplace.preview(input);
    assert.equal(preview.preview.manifest.hooks.length, 1);
    await assert.rejects(() => sdk.marketplace.install(input, "0".repeat(64), true), { code: "marketplace_stale" });
    const installed = await sdk.marketplace.install(input, preview.preview.digest, true);
    const entries = sdk.getState().snapshot!.registry.filter((entry) => entry.id === installed.id || entry.ownerPluginId === installed.id);
    assert.equal(entries.length, 4);
    assert.equal(entries.every((entry) => !entry.enabled), true);
    assert.equal(entries.some((entry) => entry.kind === "hook"), true);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
