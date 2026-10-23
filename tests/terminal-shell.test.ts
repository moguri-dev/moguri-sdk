import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalEnvironment, terminalShell } from "../apps/service/src/terminal-shell.ts";

test("Dock launches without SHELL select the actual host account shell, never a guessed sh fallback", () => {
  assert.equal(terminalShell({}, "/generated/bin/zsh"), "/generated/bin/zsh");
  assert.equal(terminalShell({ SHELL: "/generated/bin/fish" }, "/generated/bin/zsh"), "/generated/bin/fish");
  assert.throws(() => terminalShell({}, null), /no valid absolute login shell/);
  assert.throws(() => terminalShell({ SHELL: "zsh" }, "/generated/bin/zsh"), /no valid absolute login shell/);
});
test("Ghostty PTYs preserve shell configuration locations without control-plane or runtime injection", () => {
  const environment = terminalEnvironment("/generated/root", "/generated/bin/zsh", {
    HOME: "/generated/home", ZDOTDIR: "/generated/zsh", XDG_CONFIG_HOME: "/generated/config", PATH: "/generated/bin",
    MOGURI_TOKEN: "generated-private-token", NODE_OPTIONS: "--generated-untrusted-option", DYLD_INSERT_LIBRARIES: "/generated/untrusted",
  });
  assert.equal(environment.SHELL, "/generated/bin/zsh"); assert.equal(environment.TERM_PROGRAM, "ghostty");
  assert.equal(environment.ZDOTDIR, "/generated/zsh"); assert.equal(environment.XDG_CONFIG_HOME, "/generated/config");
  assert.equal(environment.MOGURI_TOKEN, undefined); assert.equal(environment.NODE_OPTIONS, undefined); assert.equal(environment.DYLD_INSERT_LIBRARIES, undefined);
});
