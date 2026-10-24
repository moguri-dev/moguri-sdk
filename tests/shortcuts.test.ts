import assert from "node:assert/strict";
import test from "node:test";
import { parseShortcut, shortcutMatches, validateShortcutSet } from "../packages/protocol/src/shortcuts.ts";

test("qualified shortcut matching preserves exact Ctrl+Space and both existing command modifiers", () => {
  const event = { code: "Space", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(shortcutMatches(event, "Control+Space"), true);
  assert.equal(shortcutMatches({ ...event, shiftKey: true }, "Control+Space"), false);
  assert.equal(shortcutMatches({ ...event, code: "KeyK" }, "Primary+KeyK"), true);
  assert.equal(shortcutMatches({ ...event, code: "KeyK", ctrlKey: false, metaKey: true }, "Primary+KeyK"), true);
  assert.equal(shortcutMatches(event, "none"), false);
  assert.equal(parseShortcut("Control+Shift+KeyD")?.code, "KeyD");
  assert.deepEqual(validateShortcutSet({ voice: "Control+Space", commands: "Primary+KeyK", terminalCopy: "Primary+Shift+KeyC" }), []);
});
