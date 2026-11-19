import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/**
 * Protocol 114. A read-only library of files that Moguri sessions produced or that sit in a project's build-output folders,
 * listed by metadata only (no file content is read). Each file keeps the session that wrote it or owns its worktree, when known.
 */
export const ArtifactLibraryQuerySchema = Type.Object({
  type: Type.Literal("artifacts.library"),
  /** A project's ID, or null for project-free chats. */
  projectId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
}, { additionalProperties: false });
export type ArtifactLibraryQuery = Static<typeof ArtifactLibraryQuerySchema>;
export const isArtifactLibraryQuery = (value: unknown): value is ArtifactLibraryQuery => Value.Check(ArtifactLibraryQuerySchema, value);
export type ArtifactFileKind = "installer" | "archive" | "image" | "document" | "media";
export interface ArtifactFile {
  /** Absolute Local path. */
  path: string; relativePath: string; root: string;
  kind: ArtifactFileKind; bytes: number; modifiedAt: string;
  /** The session whose worktree holds the file or whose agent wrote it; null when no session is linked. */
  sessionId: string | null;
  /** `output`: found in a build-output folder. `agent`: an agent tool call wrote it. */
  origin: "output" | "agent";
}
export interface ArtifactLibraryRoot {
  path: string; sessionId: string | null;
  status: "scanned" | "missing"; diagnostic: string | null;
}
export interface ArtifactLibrary {
  projectId: string | null; files: ArtifactFile[]; roots: ArtifactLibraryRoot[];
  /** True when a file, folder-entry or depth limit stopped the scan early. */
  truncated: boolean; scannedAt: string;
}
export type ArtifactLibraryResponse = { type: "artifacts.library"; library: ArtifactLibrary };

/** Folder names treated as build output when they sit at a root or one level below it (for example apps/desktop/dist). */
export const ARTIFACT_OUTPUT_DIRECTORIES = ["dist", "out", "build", "release", "releases", "artifacts", "output", "outputs", "target", "publish", "bin", "exports"] as const;
/** Agent tools whose `path` argument names a file the agent created or rewrote. */
export const ARTIFACT_WRITE_TOOLS = ["write_file", "write_document", "edit_document"] as const;
export const ARTIFACT_LIBRARY_LIMITS = { files: 600, agentFiles: 300, entries: 20_000, depth: 6 } as const;
const kinds: Record<string, ArtifactFileKind> = {};
for (const [kind, extensions] of [
  ["installer", ["dmg", "pkg", "exe", "msi", "msix", "appimage", "deb", "rpm", "apk", "aab", "ipa", "snap", "flatpak"]],
  ["archive", ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "vsix", "nupkg", "jar", "whl", "crate"]],
  ["image", ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "icns", "bmp", "tif", "tiff", "avif", "heic"]],
  ["document", ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "rtf", "csv", "html", "htm", "md", "txt"]],
  ["media", ["mp4", "mov", "webm", "mkv", "mp3", "wav", "m4a", "ogg", "flac"]],
] as const) for (const extension of extensions) kinds[extension] = kind;
/** The artifact kind for a file name, or null for files the library doesn't list (source code, maps, metadata). */
export function artifactFileKind(path: string): ArtifactFileKind | null {
  const name = path.split(/[\\/]/).at(-1) ?? "", extension = name.includes(".") ? name.split(".").at(-1)!.toLowerCase() : "";
  return kinds[extension] ?? null;
}
/** HTTP(S) links in message text, without trailing punctuation, de-duplicated in order. */
export function messageLinks(text: string): string[] {
  const links: string[] = [];
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>()"'`\]\[{}|\\^]+/g)) {
    const link = match[0].replace(/[.,;:!?*_~]+$/, "");
    try { new URL(link); } catch { continue; }
    if (!links.includes(link)) links.push(link);
  }
  return links;
}
