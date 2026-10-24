import { createHash } from "node:crypto";
import { lstat, open, realpath, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bundleTreeSha512, fileSha512, verifyBundleIdentity } from "./bundle-tree.ts";
import { installerIntent, readInstallJournal, readPrivateInstallerFile, writeInstallJournal } from "./update-installation.ts";
import type { UpdateInstallJournal, UpdateInstallerIntent } from "../../../packages/protocol/src/index.ts";

const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
export async function performBundleReplacement(intent: UpdateInstallerIntent, intentDigest: string, hooks: {
  launch: (path: string) => Promise<void>; afterBackup?: () => Promise<void>;
}): Promise<void> {
  const write = (state: UpdateInstallJournal["state"], diagnostic: string | null = null) => writeInstallJournal(intent.journal, { schemaVersion: 1, id: intent.id, intentDigest, state, diagnostic });
  let verified = false;
  try {
    installerIntent(intent);
    const directory = await lstat(dirname(intent.candidate));
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || directory.mode & 0o077 ||
      await realpath(dirname(intent.candidate)) !== dirname(intent.candidate)) throw new Error("The reviewed same-filesystem installation directory changed.");
    if (await bundleTreeSha512(intent.destination) !== intent.oldBundleSha512 || await bundleTreeSha512(intent.candidate) !== intent.bundleSha512) throw new Error("Actual old/candidate application bytes changed after review. Nothing was replaced.");
    await verifyBundleIdentity(intent.candidate, intent.version, intent.arch);
    try { await lstat(intent.backup); throw new Error("The exact previous-app backup path already exists. It was not overwritten."); } catch (error) { if (!missing(error)) throw error; }
    await write("replacing");
    await rename(intent.destination, intent.backup); await hooks.afterBackup?.();
    try { await lstat(intent.destination); throw new Error("Another destination appeared after preserving the old app. Nothing there was overwritten."); } catch (error) { if (!missing(error)) throw error; }
    await rename(intent.candidate, intent.destination);
    const parent = await open(dirname(intent.destination), "r"); try { await parent.sync(); } finally { await parent.close(); }
    if (await bundleTreeSha512(intent.destination) !== intent.bundleSha512) throw new Error("The actual replacement bytes did not verify. The previous app and original stage remain retained.");
    verified = true;
    await write("installed", "Exact bundle replacement verified; normal OS launch is requested, not proof the new app has started.");
    await hooks.launch(intent.destination);
  } catch (error) {
    await write(verified ? "installed" : "partial", error instanceof Error ? error.message : "Application replacement is unconfirmed. Inspect original candidate, destination and previous-app backup.");
    throw error;
  }
}
async function main(): Promise<void> {
  const [path, expectedDigest] = process.argv.slice(2);
  if (!path || !expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest) || process.platform !== "darwin") throw new Error("An exact original macOS installer intent/digest is required.");
  const text = await readPrivateInstallerFile(path);
  if (createHash("sha256").update(text).digest("hex") !== expectedDigest) throw new Error("The immutable original installer intent changed.");
  const intent = installerIntent(JSON.parse(text));
  if (process.ppid !== intent.servicePid || await realpath(process.execPath) !== await realpath(intent.runtime.path) ||
    fileURLToPath(import.meta.url) !== intent.helper.path || await fileSha512(intent.runtime.path) !== intent.runtime.sha512 || await fileSha512(intent.helper.path) !== intent.helper.sha512 ||
    dirname(path) !== dirname(intent.helper.path)) throw new Error("The current trusted installer/runtime lost its exact retained parent or byte identity.");
  const previous = await readInstallJournal(intent.journal);
  if (previous.id !== intent.id || previous.intentDigest !== expectedDigest || previous.state !== "prepared") throw new Error("Installer intent was already consumed or changed. No replacement was replayed.");
  let armed = false, started = false;
  const finish = async () => {
    if (started) return; started = true;
    if (!armed) { await writeInstallJournal(intent.journal, { ...previous, state: "partial", diagnostic: "Original service ownership ended before the exact shutdown/arm acknowledgement. No installation was replayed." }); return; }
    const deadline = Date.now() + 60_000;
    const mayExist = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return false; throw error; } };
    while (mayExist(intent.servicePid) || mayExist(intent.desktopPid)) {
      if (Date.now() >= deadline) { await writeInstallJournal(intent.journal, { ...previous, state: "partial", diagnostic: "The exact original service/desktop exit was not confirmed. No PID was signalled and no app was replaced." }); return; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await performBundleReplacement(intent, expectedDigest, { launch: async (path) => {
      if (process.env.MOGURI_TEST_WINDOW === "hidden") {
        await writeInstallJournal(intent.journal, { ...previous, state: "installed", diagnostic: "Generated hidden bundle replacement verified. OS application launch was deliberately suppressed." }); return;
      }
      await promisify(execFile)("/usr/bin/open", ["-n", path], { timeout: 15_000, maxBuffer: 4096 });
    } });
  };
  process.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || !("id" in message) || message.id !== intent.id || !("intentDigest" in message) || message.intentDigest !== expectedDigest || !("action" in message) || message.action !== "arm" || armed) return;
    void writeInstallJournal(intent.journal, { ...previous, state: "armed", diagnostic: null }).then(() => {
      armed = true; process.send?.({ type: "armed", id: intent.id, intentDigest: expectedDigest });
    }).catch((error: unknown) => { console.error("Installer arm acknowledgement failed:", error instanceof Error ? error.message : "private journal failure"); process.exitCode = 1; process.disconnect?.(); });
  });
  process.once("disconnect", () => { void finish().catch((error: unknown) => { console.error("Moguri installer retained a partial outcome:", error instanceof Error ? error.message : "inspect the private journal"); process.exitCode = 1; }); });
  process.send?.({ type: "ready", id: intent.id, intentDigest: expectedDigest });
}
if (import.meta.main) void main().catch((error: unknown) => { console.error("Moguri installer refused:", error instanceof Error ? error.message : "invalid original intent"); process.exitCode = 1; process.disconnect?.(); });
