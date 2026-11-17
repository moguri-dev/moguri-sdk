import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

export interface GeneratedStainlessOptions {
  bundleId?: string; version?: string; build?: number; chromium?: string;
  /** "chromium" execs Playwright's own Chromium (a working headless browser); "fail" exits immediately. */
  executable?: "chromium" | "fail";
}
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** Writes a generated Stainless.app under `folder`. It never uses or copies the user's real Stainless. */
export async function generatedStainless(folder: string, options: GeneratedStainlessOptions = {}): Promise<string> {
  const app = join(folder, "Stainless.app"), macos = join(app, "Contents/MacOS");
  await mkdir(macos, { recursive: true });
  const entries: [string, string][] = [
    ["CFBundleIdentifier", `<string>${escape(options.bundleId ?? "dev.stainless.browser")}</string>`],
    ["CFBundleExecutable", "<string>Stainless</string>"],
    ["CFBundleShortVersionString", `<string>${escape(options.chromium ?? "999.0.0.1")}</string>`],
    ["StainlessVersion", `<string>${escape(options.version ?? "0.0.0-generated")}</string>`],
    ["StainlessBuild", `<integer>${options.build ?? 1}</integer>`],
    ["StainlessChannel", "<string>generated</string>"],
  ];
  await writeFile(join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${entries.map(([key, value]) => `<key>${key}</key>${value}`).join("")}</dict></plist>
`);
  const executable = join(macos, "Stainless");
  await writeFile(executable, options.executable === "fail" ? "#!/bin/sh\necho generated failure >&2\nexit 3\n" :
    `#!/bin/sh\nexec ${JSON.stringify(chromium.executablePath())} "$@"\n`);
  await chmod(executable, 0o755);
  return app;
}
