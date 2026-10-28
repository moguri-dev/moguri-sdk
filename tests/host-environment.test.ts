import assert from "node:assert/strict";
import test from "node:test";
import { hostExecutablePath } from "../packages/client/src/host-environment.ts";

test("macOS executable discovery preserves the inherited path, including explicit empty segments and repeated directories", () => {
  const inherited = "/generated/preferred-bin::/usr/bin:/generated/preferred-bin:";
  assert.equal(hostExecutablePath(inherited, "darwin"), `${inherited}:/usr/local/bin:/opt/homebrew/bin`);
});

test("macOS discovery appends only missing standard locations and remains stable across service and program boundaries", () => {
  const inherited = "/generated/preferred-bin:/opt/homebrew/bin:/usr/bin";
  const selected = hostExecutablePath(inherited, "darwin");
  assert.equal(selected, `${inherited}:/usr/local/bin`);
  assert.equal(hostExecutablePath(selected, "darwin"), selected);
  assert.equal(hostExecutablePath("/usr/local/bin:/opt/homebrew/bin:/usr/bin", "darwin"), "/usr/local/bin:/opt/homebrew/bin:/usr/bin");
});

test("an absent macOS PATH gets system defaults but an explicitly empty PATH stays empty", () => {
  assert.equal(hostExecutablePath(undefined, "darwin"), "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin");
  assert.equal(hostExecutablePath("", "darwin"), "");
});

test("other execution platforms keep their exact PATH instead of acquiring macOS tool locations", () => {
  for (const path of [undefined, "", "/generated/preferred-bin:/usr/bin"]) assert.equal(hostExecutablePath(path, "linux"), path);
  assert.equal(hostExecutablePath("C:\\generated;C:\\Windows", "win32"), "C:\\generated;C:\\Windows");
});
