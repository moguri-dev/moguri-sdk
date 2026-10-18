import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const helper = join(dirname(require.resolve("node-pty/package.json")), "prebuilds", `darwin-${process.arch}`, "spawn-helper");
  const metadata = await stat(helper);
  if ((metadata.mode & 0o111) !== 0o111) {
    await chmod(helper, metadata.mode | 0o111);
    console.log("Prepared node-pty's shipped macOS spawn helper.");
  }
}
