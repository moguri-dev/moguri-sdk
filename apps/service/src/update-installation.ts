import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, UpdateInstallJournalSchema, UpdateInstallerIntentSchema, type UpdateInstallJournal, type UpdateInstallerIntent } from "../../../packages/protocol/src/index.ts";

export async function readPrivateInstallerFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || metadata.nlink !== 1 || metadata.size > 64 * 1024) throw new Error("The original installer metadata changed ownership, size or type.");
    const buffer = Buffer.alloc(64 * 1024 + 1); let offset = 0;
    while (offset < buffer.length) { const result = await file.read(buffer, offset, buffer.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    if (offset > 64 * 1024) throw new Error("Installer metadata exceeded its exact size bound.");
    return buffer.subarray(0, offset).toString("utf8");
  } finally { await file.close(); }
}
export async function readInstallJournal(path: string): Promise<UpdateInstallJournal> {
  return parse(UpdateInstallJournalSchema, JSON.parse(await readPrivateInstallerFile(path)));
}
export async function waitForUpdateInstallArm(path: string, id: string, intentDigest: string, timeoutMs = 120_000): Promise<UpdateInstallJournal> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await readInstallJournal(path);
    if (value.id !== id || value.intentDigest !== intentDigest) throw new Error("The exact original installation journal changed. No newer operation or helper was adopted.");
    if (value.state === "armed" || value.state === "replacing" || value.state === "installed") return value;
    if (value.state === "partial" || value.state === "cancelled") throw new Error(value.diagnostic ?? "Original installation is unconfirmed. No restart or replacement was retried.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error("The original installation shutdown/arm remains unconfirmed. Inspect its exact journal and backup; no retry was attempted.");
}
export async function writeInstallJournal(path: string, value: UpdateInstallJournal): Promise<void> {
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || parent.mode & 0o077) throw new Error("The private original installer journal directory changed.");
  const pending = join(dirname(path), `.journal-${randomUUID()}.tmp`), file = await open(pending, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value)); await file.sync(); await file.close(); await rename(pending, path);
    const directory = await open(dirname(path), "r"); try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await file.close(); await unlink(pending).catch((cleanup: unknown) => { if (!(cleanup instanceof Error && "code" in cleanup && cleanup.code === "ENOENT")) throw new AggregateError([error, cleanup], "Installer journal publication and exact temporary-file cleanup failed."); });
    throw error;
  }
}
export function installerIntent(value: unknown): UpdateInstallerIntent {
  const intent = parse(UpdateInstallerIntentSchema, value);
  for (const path of [intent.destination, intent.candidate, intent.backup, intent.journal, intent.runtime.path, intent.helper.path]) if (!isAbsolute(path) || resolve(path) !== path) throw new Error("Installer paths must remain exact absolute reviewed paths.");
  const installation = join(dirname(intent.destination), `.Moguri-update-${intent.id}`);
  if (intent.candidate !== join(installation, "Moguri.app") || intent.backup !== join(installation, "previous.app") ||
    intent.journal !== join(dirname(intent.helper.path), "journal.json") || intent.runtime.path !== join(dirname(intent.helper.path), "node")) throw new Error("Installer paths lost their original sibling/helper binding.");
  return intent;
}
