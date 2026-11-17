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
const patterns: Array<[SourceIndicatorRule, RegExp[]]> = [
  ["download-execute", [
    new RegExp(`\\b(?:curl|wget|fetch|iwr|irm|invoke-webrequest|invoke-restmethod)\\b[^|;&\\n]*\\|\\s*(?:sudo\\s+(?:-\\S+\\s+)*)?(?:${shells})\\b`, "i"),
    /\b(?:sh|bash|zsh|source|\.)\s+<\(\s*(?:curl|wget)\b/i,
    /\b(?:sh|bash|zsh|eval)\s+(?:-c\s+)?["']?\$\(\s*(?:curl|wget)\b/i,
    /\b(?:iex|invoke-expression)\b[^\n]*\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)\b/i,
    /\bdownloadstring\s*\(/i,
    /\b(?:eval|exec)\s*\(\s*(?:await\s+)?\(?\s*(?:await\s+)?(?:fetch|requests\.get|urlopen|urllib\.request\.urlopen|http\.get|https\.get)\s*\(/i,
    /\b(?:import|require)\s*\(\s*["'`]https?:\/\//i,
    /\b(?:curl|wget)\b[^\n]*(?:\s-o\s|\s-O\s|--output[=\s])[^\n]*&&\s*(?:chmod\s+(?:\+|[0-7]*)x|\.\/|sh\s|bash\s)/i,
    /\bdeno\s+run\b[^\n]*\bhttps?:\/\//i,
  ]],
  ["dynamic-install", [
    /(?:^|[\s;&|(`'"])(?:npx|pnpx|bunx|uvx)\s+(?:-y\s+|--yes\s+|-p\s+\S+\s+)*[@a-z0-9]/i,
    /\bpipx\s+run\b/i,
    /\b(?:npm|pnpm|bun)\s+(?:install|i|add)\b/i,
    /\byarn\s+(?:add|global\s+add|dlx)\b/i,
    /\bpip[0-9.]*\s+install\b/i,
    /\bpython[0-9.]*\s+-m\s+pip\s+install\b/i,
    /\buv\s+(?:pip\s+install|add|tool\s+install|run\s+--with)\b/i,
    /\b(?:go\s+(?:install|get)|cargo\s+install|gem\s+install|brew\s+install|apt(?:-get)?\s+install|dnf\s+install|yum\s+install|apk\s+add|port\s+install)\b/i,
  ]],
  ["decode-execute", [
    /\b(?:eval|exec|Function)\s*\(\s*(?:atob|Buffer\.from|base64\.b64decode|codecs\.decode|bytes\.fromhex|zlib\.decompress|marshal\.loads|unescape)\b/i,
    /\bbase64\s+(?:-d|--decode|-D)\b[^|\n]*\|\s*(?:sh|bash|zsh|python[0-9.]*|node|perl|ruby)\b/i,
    /\bexec\s*\(\s*(?:compile|__import__\s*\(\s*["'](?:base64|zlib|marshal|codecs))/i,
    /\bnew\s+Function\s*\([^\n]*\b(?:atob|Buffer\.from)\s*\(/i,
  ]],
  ["encoded-payload", [/[A-Za-z0-9+/]{400,}={0,2}/, /(?:\\x[0-9a-f]{2}){64,}/i]],
  ["credential-read", [
    /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\]\.ssh\b|\.ssh[/\\]id_(?:rsa|dsa|ecdsa|ed25519)\b|\bid_(?:rsa|ed25519)(?:\.pub)?\b/i,
    /\.aws[/\\]credentials\b|\.config[/\\]gcloud\b|\.azure[/\\]|\.kube[/\\]config\b|\.docker[/\\]config\.json\b|\.git-credentials\b|\.config[/\\]gh[/\\]hosts\.yml\b/i,
    /(?:^|[\s"'`/\\~])\.(?:npmrc|pypirc|netrc)\b/i,
    /\bsecurity\s+(?:find-generic-password|find-internet-password|dump-keychain)\b|\bgh\s+auth\s+token\b|Library[/\\]Keychains\b|\blogin\.keychain/i,
    /\/etc\/shadow\b|Cookies\.binarycookies|\bLogin Data\b|\bkey4\.db\b/i,
  ]],
  ["exfiltration", [
    /\bcurl\b[^\n]*(?:\s-d|\s--data(?:-binary|-raw|-urlencode)?|\s-F|\s--form|\s-T|\s--upload-file)[\s=]+["']?@/i,
    /\b(?:nc|ncat|netcat)\s+(?:-[a-z]+\s+)*[a-z0-9][a-z0-9.-]*\s+\d{2,5}\b/i,
    /\/dev\/(?:tcp|udp)\//i,
  ]],
  ["prompt-injection", [
    /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|system|developer|original)\s+(?:instructions|prompts?|rules|messages|guidelines|directions)\b/i,
    /\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|notify|alert|warn|mention\s+(?:this\s+|it\s+)?to|show)\s+(?:the\s+)?user\b/i,
    /\bwithout\s+(?:asking|telling|informing|notifying|alerting|confirming\s+with)\s+(?:the\s+)?user\b/i,
    /\b(?:auto-?approve|self-?approve)\b|\bapprove\s+(?:all|every|any)\s+(?:tools?|commands?|requests?|tool\s+calls?)\b/i,
    /--dangerously-skip-permissions\b|\bdangerously-?bypass\b|\bdangerouslyDisableSandbox\b/i,
    /\b(?:bypass|disable|skip|circumvent|turn\s+off)\s+(?:the\s+|any\s+|all\s+)?(?:permission|approval|sandbox|safety|security)\s*(?:checks?|prompts?|polic(?:y|ies)|rules|system|guard(?:s|rails)?)\b/i,
    /\b(?:switch|set|change|put)\s+(?:the\s+|your\s+)?(?:autonomy|approval)\s*(?:level|mode)?\s+to\s+(?:autopilot|max|yolo|full\s+auto)\b/i,
    /\banswer\s+(?:on\s+behalf\s+of|for|as)\s+the\s+user\b/i,
  ]],
  ["remote-instructions", [
    /\b(?:fetch|download|load|read|retrieve|follow|get|obey)\b[^\n]{0,60}\b(?:instructions?|rules|prompts?|guidelines|directives|commands)\b[^\n]{0,40}\b(?:from|at)\s+<?https?:\/\//i,
    /\bfollow\s+(?:the\s+)?(?:instructions|steps|rules)\s+(?:at|from|in)\s+<?https?:\/\//i,
  ]],
  ["destructive", [
    /\brm\s+(?:-[a-z]*\s+)*-[a-z]*(?:rf|fr|r[a-z]*f|f[a-z]*r)[a-z]*\s+(?:--no-preserve-root\s+)?["']?(?:\/|~|\$HOME|\$\{HOME\}|\/\*)["']?(?:\s|$|;|&)/i,
    /\bmkfs(?:\.\w+)?\b|\bdiskutil\s+(?:erase\w*|zeroDisk|secureErase)\b/i,
    /\bdd\b[^\n]*\bof=\/dev\/(?:sd|disk|rdisk|nvme|hd)/i,
    /\bgit\s+push\b[^\n]*(?:\s--force\b|\s-f\b|\s--force-with-lease\b)/i,
    /\bchmod\s+-R\s+777\s+\//i,
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  ]],
];

const escapeInvisible = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u180e\ufeff]|[\u{e0000}-\u{e007f}]/gu,
  (character) => `<U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`);
const excerpt = (text: string) => {
  const visible = escapeInvisible(text.replace(/\t/g, " ").trim()).replace(/\s+/g, " ");
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
      const start = index;
      let logical = lines[index]!;
      if (hidden(logical, index === 0)) add("hidden-unicode", file.path, index + 1, logical);
      while (logical.endsWith("\\") && index + 1 < lines.length) {
        index++;
        if (hidden(lines[index]!, false)) add("hidden-unicode", file.path, index + 1, lines[index]!);
        logical = `${logical.slice(0, -1)} ${lines[index]!}`;
      }
      const normalized = logical.normalize("NFKC").replace(hiddenGlobal, "");
      for (const [rule, expressions] of patterns) if (expressions.some((expression) => expression.test(normalized))) add(rule, file.path, start + 1, logical);
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
