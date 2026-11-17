import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallerCandidate } from "../../../packages/protocol/src/index.ts";

const MAX_BYTES = 512 * 1024;
/** Tools whose use in a script means it produces an installer or distributable app bundle. */
const INSTALLER_TOOL = /\b(?:electron-builder|electron-forge\s+make|electron-packager|tauri\s+build|cargo\s+(?:tauri\s+build|bundle|packager)|pkgbuild|productbuild|hdiutil|create-dmg|appdmg|makensis|wixl?|flutter\s+build\s+(?:macos|windows|linux|apk|appbundle|ipa)|xcodebuild\b[^\n]*\barchive)\b|\.dmg\b/i;
/** Script or make target names that clearly mean "build the installer". */
const INSTALLER_NAME = /(?:^|[:_-])(?:dmg|installer|msi|appimage)(?:$|[:_-])|^(?:package|dist|make|bundle|release)[:_-](?:mac|macos|darwin|osx|win|windows|linux|all|app|desktop)$/i;

async function regularFile(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) return null;
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code))) return null;
    throw error;
  }
}
async function packageRunner(root: string): Promise<string> {
  for (const [file, runner] of [["pnpm-lock.yaml", "pnpm run"], ["yarn.lock", "yarn"], ["bun.lock", "bun run"], ["bun.lockb", "bun run"]] as const) {
    if (await lstat(join(root, file)).then((value) => value.isFile(), () => false)) return runner;
  }
  return "npm run";
}

/** Read-only and bounded: only the root package.json scripts and Makefile targets are inspected, and nothing is run. */
export async function detectInstallers(root: string): Promise<InstallerCandidate[]> {
  const candidates: InstallerCandidate[] = [];
  const manifest = await regularFile(join(root, "package.json"));
  if (manifest) {
    let scripts: unknown;
    try { scripts = (JSON.parse(manifest) as { scripts?: unknown }).scripts; } catch { scripts = undefined; }
    if (scripts && typeof scripts === "object" && !Array.isArray(scripts)) {
      const runner = await packageRunner(root);
      for (const [name, script] of Object.entries(scripts as Record<string, unknown>)) {
        if (typeof script !== "string" || name.length > 100 || !/^[\w:.-]+$/.test(name) || /^(?:pre|post)/.test(name)) continue;
        if (INSTALLER_NAME.test(name) || INSTALLER_TOOL.test(script)) candidates.push({ source: "package.json", name, script: script.slice(0, 500), run: `${runner} ${name}` });
      }
    }
  }
  const makefile = await regularFile(join(root, "Makefile"));
  if (makefile) {
    const targets = new Set<string>();
    for (const line of makefile.split("\n").slice(0, 5000)) {
      const match = /^([A-Za-z0-9_.-]{1,60})\s*:(?!=)/.exec(line);
      if (match && INSTALLER_NAME.test(match[1]!) && !targets.has(match[1]!)) {
        targets.add(match[1]!);
        candidates.push({ source: "Makefile", name: match[1]!, script: `make ${match[1]}`, run: `make ${match[1]}` });
      }
    }
  }
  const order = (candidate: InstallerCandidate) => /mac|darwin|osx|dmg/i.test(candidate.name) ? 0 : INSTALLER_NAME.test(candidate.name) ? 1 : 2;
  return candidates.sort((left, right) => order(left) - order(right) || left.name.localeCompare(right.name)).slice(0, 10);
}
