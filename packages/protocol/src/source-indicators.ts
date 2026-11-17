/**
 * Deterministic source indicators for skills and reviewed scripts (OWASP AST05/AST08).
 * Pattern matching over the complete normalized text: advisory findings, never a malware verdict,
 * semantic intent classification or permission. Absence of findings proves nothing.
 */
export const SOURCE_INDICATOR_SCANNER = "moguri-source-indicators";
/** Bump whenever a rule, gate or normalization changes, so reviews disclose which rule set they saw. */
export const SOURCE_INDICATOR_VERSION = 1;
export const SOURCE_INDICATOR_LOCATIONS = 8;
export const SOURCE_INDICATOR_LIMITATION = "Deterministic indicator rules over the complete normalized text. This is not malware analysis, " +
  "a semantic intent classifier or a safety verdict; no finding proves nothing. Binary and omitted files are not scanned.";

export type SourceIndicatorRule = "hidden-unicode" | "download-execute" | "dynamic-install" | "decode-execute" | "encoded-payload" |
  "credential-read" | "exfiltration" | "prompt-injection" | "remote-instructions" | "destructive";
/**
 * `model-script`: a model "safe" verdict cannot authorize the script; only the actual user's force (or the user's explicit
 * risk acceptance setting) can. `trusted-skill`: a trusted-folder skill is not auto-admitted; explicit review still works.
 */
export type SourceIndicatorGate = "model-script" | "trusted-skill";
export interface SourceIndicatorRuleInfo {
  id: SourceIndicatorRule; severity: "high" | "medium"; layer: "code" | "instruction" | "both"; label: string; gate: SourceIndicatorGate | null;
}
export interface SourceIndicatorFinding {
  rule: SourceIndicatorRule; severity: "high" | "medium"; count: number;
  /** First locations only; `count` is the complete number of matching lines. */
  locations: { path: string; line: number; excerpt: string }[];
}
export interface SourceIndicatorReport {
  scanner: typeof SOURCE_INDICATOR_SCANNER; version: number; files: number; bytes: number;
  findings: SourceIndicatorFinding[]; limitation: string;
}

export const SOURCE_INDICATOR_RULES: readonly SourceIndicatorRuleInfo[] = Object.freeze([
  { id: "hidden-unicode", severity: "high", layer: "both", label: "Invisible or bidirectional control characters", gate: "trusted-skill" },
  { id: "download-execute", severity: "high", layer: "code", label: "Downloads code and runs it", gate: "model-script" },
  { id: "dynamic-install", severity: "medium", layer: "code", label: "Installs or runs packages fetched at run time", gate: "model-script" },
  { id: "decode-execute", severity: "high", layer: "code", label: "Decodes hidden content and runs it", gate: "model-script" },
  { id: "encoded-payload", severity: "medium", layer: "code", label: "Long encoded payload", gate: null },
  { id: "credential-read", severity: "high", layer: "both", label: "Reads credential or key locations", gate: null },
  { id: "exfiltration", severity: "medium", layer: "code", label: "Uploads local files or opens raw network channels", gate: null },
  { id: "prompt-injection", severity: "medium", layer: "instruction", label: "Instructions to override rules, hide actions or self-approve", gate: null },
  { id: "remote-instructions", severity: "medium", layer: "instruction", label: "Follows instructions fetched from a URL", gate: null },
  { id: "destructive", severity: "medium", layer: "code", label: "Destructive system or history command", gate: null },
]);
const ruleInfo = new Map(SOURCE_INDICATOR_RULES.map((rule) => [rule.id, rule]));
export const sourceIndicatorRule = (id: SourceIndicatorRule): SourceIndicatorRuleInfo => ruleInfo.get(id)!;
export const gatedFindings = (report: SourceIndicatorReport | undefined | null, gate: SourceIndicatorGate): SourceIndicatorFinding[] =>
  report?.findings.filter((finding) => sourceIndicatorRule(finding.rule).gate === gate) ?? [];

// Trojan Source embeddings/overrides/isolates, zero-width space, word joiner and invisible operators, tag characters and invisible fillers.
// LRM/RLM/ALM marks are normal in right-to-left text and are not reported.
const alwaysHidden = /[\u202a-\u202e\u2066-\u2069\u200b\u2060-\u2064\u180e\u115f\u1160\u3164\uffa0]|[\u{e0000}-\u{e007f}]/u;
const hiddenGlobal = /[\u202a-\u202e\u2066-\u2069\u200b-\u200d\u2060-\u2064\u180e\u115f\u1160\u3164\uffa0\ufeff]|[\u{e0000}-\u{e007f}]/gu;
const shells = "sh|bash|zsh|dash|ksh|fish|python[0-9.]*|node|deno|bun|perl|ruby|php|pwsh|powershell|iex|invoke-expression";
// Every quantifier is bounded so no match can exceed MATCH_SPAN characters; long lines are then scanned in overlapping windows,
// which keeps adversarial 512 KiB inputs linear instead of quadratic.
const patterns: Array<[SourceIndicatorRule, RegExp[]]> = [
  ["download-execute", [
    new RegExp(`\\b(?:curl|wget|fetch|iwr|irm|invoke-webrequest|invoke-restmethod)\\b[^|;&\\n]{0,300}\\|\\s{0,8}(?:sudo\\s{1,4}(?:-\\S{1,20}\\s{1,4}){0,4})?(?:${shells})\\b`, "i"),
    /\b(?:sh|bash|zsh|source|\.)\s{1,8}<\(\s{0,8}(?:curl|wget)\b/i,
    /\b(?:sh|bash|zsh|eval)\s{1,8}(?:-c\s{1,8})?["']?\$\(\s{0,8}(?:curl|wget)\b/i,
    /\b(?:iex|invoke-expression)\b[^\n]{0,300}\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)\b/i,
    /\bdownloadstring\s{0,8}\(/i,
    /\b(?:eval|exec)\s{0,8}\(\s{0,8}(?:await\s{1,8})?\(?\s{0,8}(?:await\s{1,8})?(?:fetch|requests\.get|urlopen|urllib\.request\.urlopen|http\.get|https\.get)\s{0,8}\(/i,
    /\b(?:import|require)\s{0,8}\(\s{0,8}["'`]https?:\/\//i,
    /\b(?:curl|wget)\b[^\n]{0,200}(?:\s-o\s|\s-O\s|--output[=\s])[^\n]{0,200}&&\s{0,8}(?:chmod\s{1,8}(?:\+|[0-7]{0,4})x|\.\/|sh\s|bash\s)/i,
    /\bdeno\s{1,8}run\b[^\n]{0,200}\bhttps?:\/\//i,
  ]],
  ["dynamic-install", [
    /(?:^|[\s;&|(`'"])(?:npx|pnpx|bunx|uvx)\s{1,8}(?:-y\s{1,8}|--yes\s{1,8}|-p\s{1,8}\S{1,100}\s{1,8}){0,4}[@a-z0-9]/i,
    /\bpipx\s{1,8}run\b/i,
    /\b(?:npm|pnpm|bun)\s{1,8}(?:install|i|add)\b/i,
    /\byarn\s{1,8}(?:add|global\s{1,8}add|dlx)\b/i,
    /\bpip[0-9.]{0,6}\s{1,8}install\b/i,
    /\bpython[0-9.]{0,6}\s{1,8}-m\s{1,8}pip\s{1,8}install\b/i,
    /\buv\s{1,8}(?:pip\s{1,8}install|add|tool\s{1,8}install|run\s{1,8}--with)\b/i,
    /\b(?:go\s{1,8}(?:install|get)|cargo\s{1,8}install|gem\s{1,8}install|brew\s{1,8}install|apt(?:-get)?\s{1,8}install|dnf\s{1,8}install|yum\s{1,8}install|apk\s{1,8}add|port\s{1,8}install)\b/i,
  ]],
  ["decode-execute", [
    /\b(?:eval|exec|Function)\s{0,8}\(\s{0,8}(?:atob|Buffer\.from|base64\.b64decode|codecs\.decode|bytes\.fromhex|zlib\.decompress|marshal\.loads|unescape)\b/i,
    /\bbase64\s{1,8}(?:-d|--decode|-D)\b[^|\n]{0,200}\|\s{0,8}(?:sh|bash|zsh|python[0-9.]*|node|perl|ruby)\b/i,
    /\bexec\s{0,8}\(\s{0,8}(?:compile|__import__\s{0,8}\(\s{0,8}["'](?:base64|zlib|marshal|codecs))/i,
    /\bnew\s{1,8}Function\s{0,8}\([^\n]{0,200}\b(?:atob|Buffer\.from)\s{0,8}\(/i,
  ]],
  ["encoded-payload", [/[A-Za-z0-9+/]{400}/, /(?:\\x[0-9a-f]{2}){64}/i]],
  ["credential-read", [
    /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\]\.ssh\b|\.ssh[/\\]id_(?:rsa|dsa|ecdsa|ed25519)\b|\bid_(?:rsa|ed25519)(?:\.pub)?\b/i,
    /\.aws[/\\]credentials\b|\.config[/\\]gcloud\b|\.azure[/\\]|\.kube[/\\]config\b|\.docker[/\\]config\.json\b|\.git-credentials\b|\.config[/\\]gh[/\\]hosts\.yml\b/i,
    /(?:^|[\s"'`/\\~])\.(?:npmrc|pypirc|netrc)\b/i,
    /\bsecurity\s{1,8}(?:find-generic-password|find-internet-password|dump-keychain)\b|\bgh\s{1,8}auth\s{1,8}token\b|Library[/\\]Keychains\b|\blogin\.keychain/i,
    /\/etc\/shadow\b|Cookies\.binarycookies|\bLogin Data\b|\bkey4\.db\b/i,
  ]],
  ["exfiltration", [
    /\bcurl\b[^\n]{0,300}(?:\s-d|\s--data(?:-binary|-raw|-urlencode)?|\s-F|\s--form|\s-T|\s--upload-file)[\s=]{1,4}["']?@/i,
    /\b(?:nc|ncat|netcat)\s{1,8}(?:-[a-z]{1,8}\s{1,8}){0,6}[a-z0-9][a-z0-9.-]{0,253}\s{1,8}\d{2,5}\b/i,
    /\/dev\/(?:tcp|udp)\//i,
  ]],
  ["prompt-injection", [
    /\b(?:ignore|disregard|forget|override)\s{1,4}(?:all\s{1,4}|any\s{1,4})?(?:of\s{1,4})?(?:the\s{1,4}|your\s{1,4})?(?:previous|prior|above|earlier|preceding|system|developer|original)\s{1,4}(?:instructions|prompts?|rules|messages|guidelines|directions)\b/i,
    /\b(?:do\s{1,4}not|don'?t|never)\s{1,4}(?:tell|inform|notify|alert|warn|mention\s{1,4}(?:this\s{1,4}|it\s{1,4})?to|show)\s{1,4}(?:the\s{1,4})?user\b/i,
    /\bwithout\s{1,4}(?:asking|telling|informing|notifying|alerting|confirming\s{1,4}with)\s{1,4}(?:the\s{1,4})?user\b/i,
    /\b(?:auto-?approve|self-?approve)\b|\bapprove\s{1,4}(?:all|every|any)\s{1,4}(?:tools?|commands?|requests?|tool\s{1,4}calls?)\b/i,
    /--dangerously-skip-permissions\b|\bdangerously-?bypass\b|\bdangerouslyDisableSandbox\b/i,
    /\b(?:bypass|disable|skip|circumvent|turn\s{1,4}off)\s{1,4}(?:the\s{1,4}|any\s{1,4}|all\s{1,4})?(?:permission|approval|sandbox|safety|security)\s{0,4}(?:checks?|prompts?|polic(?:y|ies)|rules|system|guard(?:s|rails)?)\b/i,
    /\b(?:switch|set|change|put)\s{1,4}(?:the\s{1,4}|your\s{1,4})?(?:autonomy|approval)\s{0,4}(?:level|mode)?\s{1,4}to\s{1,4}(?:autopilot|max|yolo|full\s{1,4}auto)\b/i,
    /\banswer\s{1,4}(?:on\s{1,4}behalf\s{1,4}of|for|as)\s{1,4}the\s{1,4}user\b/i,
  ]],
  ["remote-instructions", [
    /\b(?:fetch|download|load|read|retrieve|follow|get|obey)\b[^\n]{0,60}\b(?:instructions?|rules|prompts?|guidelines|directives|commands)\b[^\n]{0,40}\b(?:from|at)\s{1,4}<?https?:\/\//i,
    /\bfollow\s{1,4}(?:the\s{1,4})?(?:instructions|steps|rules)\s{1,4}(?:at|from|in)\s{1,4}<?https?:\/\//i,
  ]],
  ["destructive", [
    /\brm\s{1,8}(?:-[a-z]{0,8}\s{1,8}){0,6}-[a-z]{0,8}(?:rf|fr|r[a-z]{0,8}f|f[a-z]{0,8}r)[a-z]{0,8}\s{1,8}(?:--no-preserve-root\s{1,8})?["']?(?:\/|~|\$HOME|\$\{HOME\}|\/\*)["']?(?:\s|$|;|&)/i,
    /\bmkfs(?:\.\w{1,10})?\b|\bdiskutil\s{1,8}(?:erase\w{0,20}|zeroDisk|secureErase)\b/i,
    /\bdd\b[^\n]{0,200}\bof=\/dev\/(?:sd|disk|rdisk|nvme|hd)/i,
    /\bgit\s{1,8}push\b[^\n]{0,200}(?:\s--force\b|\s-f\b|\s--force-with-lease\b)/i,
    /\bchmod\s{1,8}-R\s{1,8}777\s{1,8}\//i,
    /:\(\)\s{0,4}\{\s{0,4}:\s{0,4}\|\s{0,4}:\s{0,4}&\s{0,4}\}\s{0,4};\s{0,4}:/,
  ]],
];
/** Longest possible match of any bounded pattern above; windows overlap by this much, so no match is split. */
const MATCH_SPAN = 1024, WINDOW = 8192;
function windows(text: string): string[] {
  if (text.length <= WINDOW) return [text];
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += WINDOW - MATCH_SPAN) {
    parts.push(text.slice(start, start + WINDOW));
    if (start + WINDOW >= text.length) break;
  }
  return parts;
}

const escapeInvisible = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u180e\ufeff]|[\u{e0000}-\u{e007f}]/gu,
  (character) => `<U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`);
const excerpt = (text: string) => {
  const visible = escapeInvisible(text.slice(0, 1024).replace(/\t/g, " ").trim()).replace(/\s+/g, " ");
  return visible.length > 160 ? `${visible.slice(0, 157)}...` : visible;
};
const ascii = (character: string | undefined) => character === undefined || /^[\x00-\x7f]$/.test(character);
function hidden(line: string, first: boolean): boolean {
  if (alwaysHidden.test(line)) return true;
  if (line.includes("\ufeff") && (!first || line.indexOf("\ufeff") > 0 || line.slice(1).includes("\ufeff"))) return true;
  const characters = [...line];
  return characters.some((character, index) => (character === "\u200c" || character === "\u200d") && ascii(characters[index - 1]) && ascii(characters[index + 1]));
}

/** Scans every supplied file completely. Continued shell lines (trailing backslash) are matched as one logical line. */
export function scanSourceIndicators(files: readonly { path: string; text: string }[]): SourceIndicatorReport {
  const found = new Map<SourceIndicatorRule, SourceIndicatorFinding>();
  const add = (rule: SourceIndicatorRule, path: string, line: number, text: string) => {
    const finding = found.get(rule) ?? { rule, severity: sourceIndicatorRule(rule).severity, count: 0, locations: [] };
    finding.count++;
    if (finding.locations.length < SOURCE_INDICATOR_LOCATIONS) finding.locations.push({ path, line, excerpt: excerpt(text) });
    found.set(rule, finding);
  };
  let bytes = 0;
  for (const file of files) {
    bytes += new TextEncoder().encode(file.text).byteLength;
    const lines = file.text.split(/\r\n|\n|\r/);
    for (let index = 0; index < lines.length; index++) {
      const start = index, parts = [lines[index]!];
      if (hidden(parts[0]!, index === 0)) add("hidden-unicode", file.path, index + 1, parts[0]!);
      while (parts.at(-1)!.endsWith("\\") && index + 1 < lines.length) {
        index++;
        if (hidden(lines[index]!, false)) add("hidden-unicode", file.path, index + 1, lines[index]!);
        parts[parts.length - 1] = parts.at(-1)!.slice(0, -1); parts.push(lines[index]!);
      }
      const logical = parts.join(" "), sections = windows(logical.normalize("NFKC").replace(hiddenGlobal, ""));
      for (const [rule, expressions] of patterns) {
        if (expressions.some((expression) => sections.some((section) => expression.test(section)))) add(rule, file.path, start + 1, logical);
      }
    }
  }
  const order = new Map(SOURCE_INDICATOR_RULES.map((rule, index) => [rule.id, index]));
  return { scanner: SOURCE_INDICATOR_SCANNER, version: SOURCE_INDICATOR_VERSION, files: files.length, bytes,
    findings: [...found.values()].sort((a, b) => order.get(a.rule)! - order.get(b.rule)!), limitation: SOURCE_INDICATOR_LIMITATION };
}
/** One bounded line per finding, for model-facing notices and CLI output. */
export function describeSourceIndicators(report: SourceIndicatorReport): string[] {
  return report.findings.map((finding) => `${finding.rule} (${finding.severity}, ${finding.count} line${finding.count === 1 ? "" : "s"}): ` +
    `${sourceIndicatorRule(finding.rule).label}; first at ${finding.locations.map((location) => `${location.path}:${location.line}`).join(", ")}`);
}
