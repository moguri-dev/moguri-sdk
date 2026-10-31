import { basename } from "node:path";
import { parse, type ParseEntry } from "shell-quote";

const runtimes = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "node", "nodejs", "python", "python3", "ruby", "perl", "php", "bun", "deno", "pwsh", "powershell", "osascript", "eval", "source", "."]);
const wrappers = new Set(["env", "command", "exec", "sudo", "doas", "nohup", "nice", "timeout", "stdbuf"]);
const dataPipes = new Set(["jq", "grep", "rg", "cat", "head", "tail", "wc", "printf", "echo", "tee"]);
const reason = "This command contains unreviewed script execution or dynamic executable selection. Inspect the entire exact source with review_script, assess suspicious payloads/API calls, then use run_script under normal tool policy. Unsafe findings must be reported without asking to execute; only an actual user can force the exact reviewed source.";
type Token = ParseEntry | { unresolved: true };
export function unreviewedScriptCommand(command: string, depth = 0): string | null {
  if (depth > 4) return reason;
  let tokens: Token[];
  try { tokens = parse<{ unresolved: true }>(command, () => ({ unresolved: true })); }
  catch { return "The shell expression cannot be parsed for full-source script review. Correct the expression or use the reviewed-script flow; no execution approval was requested."; }
  const groups: Token[][] = [[]];
  for (const token of tokens) {
    if (typeof token !== "string" && "comment" in token) continue;
    if (typeof token !== "string" && "op" in token && token.op !== "glob") { groups.push([]); continue; }
    groups.at(-1)!.push(token);
  }
  const commands = groups.filter((group) => group.length).map((group) => {
    const words = [...group];
    while (typeof words[0] === "string" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    return words;
  }).filter((words) => words.length);
  for (const words of commands) {
    if (typeof words[0] !== "string") return reason;
    const program = basename(words[0]), args = words.slice(1);
    if (runtimes.has(program)) {
      if (args.length === 1 && typeof args[0] === "string" && ["--version", "-V", "-v", "--help", "-h"].includes(args[0])) continue;
      const inline = args.findIndex((argument) => typeof argument === "string" && ["-c", "-e", "--eval", "-p", "--print"].includes(argument));
      const source = args[inline + 1];
      if (inline >= 0 && typeof source === "string") {
        if (["sh", "bash", "zsh", "dash", "ksh"].includes(program)) {
          const nested = unreviewedScriptCommand(source, depth + 1);
          if (nested) return nested;
        }
        continue;
      }
      return reason;
    }
    if (["curl", "wget"].includes(program)) {
      for (const argument of args) {
        if (typeof argument !== "string") return reason;
        if (/\.(?:sh|bash|zsh|py|[cm]?js|ts|rb|pl|php|ps1)(?:[?#].*)?$/i.test(argument)) return reason;
        if (!/^https?:\/\//i.test(argument)) continue;
        let url: URL;
        try { url = new URL(argument); } catch { return reason; }
        if (["raw.githubusercontent.com", "gist.githubusercontent.com"].includes(url.hostname) ||
          /\/(?:raw|blob|releases\/download)\//.test(url.pathname) || url.pathname.includes("/-/raw/")) return reason;
      }
    }
    if (words[0].startsWith("./") || words[0].startsWith("../") || /\.(?:sh|bash|zsh|py|[cm]?js|ts|rb|pl|php|ps1)$/i.test(program)) return reason;
    if (wrappers.has(program) && args.some((word) => typeof word !== "string" || runtimes.has(basename(word)) || /\.(?:sh|py|[cm]?js|ts|rb|pl|php|ps1)$/i.test(word))) return reason;
  }
  const downloader = commands.some((words) => typeof words[0] === "string" && ["curl", "wget"].includes(basename(words[0])));
  if (downloader && commands.length > 1 && commands.some((words) => typeof words[0] !== "string" ||
    !["curl", "wget"].includes(basename(words[0])) && !dataPipes.has(basename(words[0])))) return reason;
  return null;
}
