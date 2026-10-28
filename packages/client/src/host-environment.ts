import { delimiter } from "node:path";

export const MACOS_TOOL_PATHS = ["/usr/local/bin", "/opt/homebrew/bin"] as const;

export function hostExecutablePath(path: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "darwin" || path === "") return path;
  const inherited = path ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  const paths = inherited.split(delimiter);
  return [inherited, ...MACOS_TOOL_PATHS.filter((directory) => !paths.includes(directory))].join(delimiter);
}
