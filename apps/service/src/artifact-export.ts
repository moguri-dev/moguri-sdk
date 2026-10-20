import { basename, dirname, isAbsolute, join } from "node:path";
import { link, open, realpath, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { ArtifactExport } from "../../../packages/protocol/src/index.ts";

export async function writeArtifactExport(path: string, document: ArtifactExport, signal?: AbortSignal): Promise<{ path: string; digest: string }> {
  if (!isAbsolute(path) || Buffer.byteLength(document.text) > 8 * 1024 * 1024 || createHash("sha256").update(document.text).digest("hex") !== document.digest) throw new Error("Choose an absolute export destination and an exact bounded SDK export. No file was written.");
  signal?.throwIfAborted();
  const parent = await realpath(dirname(path)), target = join(parent, basename(path)), temporary = join(parent, `.moguri-export-${randomUUID()}.tmp`);
  let created = false, published = false;
  try {
    const file = await open(temporary, "wx", 0o600); created = true;
    try { await file.writeFile(document.text, { encoding: "utf8", signal }); await file.sync(); }
    finally { await file.close(); }
    signal?.throwIfAborted();
    await link(temporary, target); published = true;
    await unlink(temporary); created = false;
    const directory = await open(parent, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    signal?.throwIfAborted();
    return { path: target, digest: document.digest };
  } catch (error) {
    throw new Error(published ? "Export file was created, but persistence was not fully acknowledged. Inspect its checksum; no project copy was deleted." :
      error instanceof Error && "code" in error && error.code === "EEXIST" ? "The export destination already exists and was preserved. Choose a new file." :
      `Export failed; no stored artifact was deleted. ${error instanceof Error ? error.message : "Check destination permissions."}`, { cause: error });
  } finally {
    if (created) await unlink(temporary);
  }
}
