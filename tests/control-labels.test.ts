import assert from "node:assert/strict";
import { test } from "node:test";
import { autonomyLabel, autonomyLabelList, builtinSlashClash, envLabel, envLabelList, executeSlash, isSharedSlash, MoguriSdk, parseAutonomyInput, parseEnvInput, parseSlash, slashCommands } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("autonomy and Env labels rename only the display text of unchanged stored values", () => {
  assert.deepEqual(autonomyLabelList, ["Manual", "Guided", "Autonomous", "Autopilot"]);
  assert.equal(autonomyLabel("Autopilot"), "Autonomous");
  assert.equal(autonomyLabel("Autopilot Max"), "Autopilot");
  assert.deepEqual(envLabelList, ["Local", "Sandbox", "Remote host"]);
  assert.equal(envLabel("Remote"), "Remote host");
  assert.equal(envLabel("unknown"), "unknown");
  for (const [input, value] of [["manual", "Manual"], ["GUIDED", "Guided"], ["autonomous", "Autopilot"], ["Autopilot", "Autopilot Max"],
    ["Autopilot Max", "Autopilot Max"], ["  autopilot   max ", "Autopilot Max"]] as const) assert.equal(parseAutonomyInput(input), value, input);
  for (const input of ["Max", "auto", "", "Autonomous Max"]) assert.equal(parseAutonomyInput(input), null, input);
  for (const [input, value] of [["Remote host", "Remote"], ["remote host", "Remote"], ["Remote", "Remote"], ["local", "Local"], ["Sandbox", "Sandbox"]] as const) {
    assert.equal(parseEnvInput(input), value, input);
  }
  for (const input of ["host", "Remote SSH", ""]) assert.equal(parseEnvInput(input), null, input);
});

test("/ssh replaces the listed /remote command, which stays an unlisted alias", () => {
  // Recorded history re-parses queued text against its stored name, so the alias keeps its own name.
  assert.deepEqual(parseSlash("/remote probe"), { name: "remote", argument: "probe" });
  assert.equal(isSharedSlash("remote"), true);
  assert.deepEqual(parseSlash("/ssh reconcile generated-run"), { name: "ssh", argument: "reconcile generated-run" });
  assert.equal(slashCommands.map((command): string => command.name).includes("remote"), false);
  assert.equal(slashCommands.find((command) => command.name === "autonomy")?.argument, "Manual|Guided|Autonomous|Autopilot");
  assert.equal(slashCommands.find((command) => command.name === "env")?.argument, "Local|Sandbox|Remote host");
  assert.equal(builtinSlashClash("remote"), "ssh");
});

test("typed /autonomy, /env and /ssh map display names to the stored values", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const autonomous = await executeSlash(sdk, fixture.sessionId, "/autonomy autonomous", "tui");
    assert.deepEqual(autonomous, { kind: "ok", message: "Session autonomy set to Autonomous. Hard policy is unchanged." });
    assert.equal(fixture.session().controls.autonomy, "Autopilot");
    for (const text of ["/autonomy autopilot", "/autonomy Autopilot Max"]) {
      await assert.rejects(executeSlash(sdk, fixture.sessionId, text, "tui"), { code: "decision_unavailable" }, text);
    }
    await assert.rejects(executeSlash(sdk, fixture.sessionId, "/autonomy Max", "tui"), { code: "autonomy_input" });
    assert.equal(fixture.session().controls.autonomy, "Autopilot");
    for (const text of ["/env remote host", "/env Remote"]) {
      await assert.rejects(executeSlash(sdk, fixture.sessionId, text, "tui"), { code: "env_unavailable" }, text);
    }
    await assert.rejects(executeSlash(sdk, fixture.sessionId, "/env SSH", "tui"), { code: "env_input" });
    assert.equal(fixture.session().controls.env, "Local");
    for (const text of ["/ssh", "/remote"]) assert.equal((await executeSlash(sdk, fixture.sessionId, text, "tui")).kind, "text", text);
    await assert.rejects(executeSlash(sdk, fixture.sessionId, "/ssh generated", "tui"), { code: "remote_action", message: /Use \/ssh, \/ssh probe/ });
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
