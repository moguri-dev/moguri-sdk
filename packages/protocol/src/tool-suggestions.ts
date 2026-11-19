import { Type, type Static } from "typebox";

/**
 * Protocol 113. Deterministic, local detection of repeated user requests that a reviewed script tool could handle
 * (for example "turn this markdown into a PDF" across several chats). It is a phrase match over already-scoped prior
 * prompts, never a model verdict, and it never creates, enables or runs a script.
 */
export const TOOL_SUGGESTION_INTERVALS = [6, 12, 24, 168] as const;
export const ToolSuggestionAutomationSchema = Type.Object({
  enabled: Type.Boolean(),
  intervalHours: Type.Union([Type.Literal(6), Type.Literal(12), Type.Literal(24), Type.Literal(168)]),
}, { additionalProperties: false });
export type ToolSuggestionAutomation = Static<typeof ToolSuggestionAutomationSchema>;
/** Absent means every automation is off. */
export const AutomationSettingsSchema = Type.Object({
  toolSuggestions: Type.Optional(ToolSuggestionAutomationSchema),
}, { additionalProperties: false });
export type AutomationSettings = Static<typeof AutomationSettingsSchema>;
export const TOOL_SCRIPT_NAME = /^[a-z][a-z0-9_]{2,63}$/;

export interface ToolSuggestion {
  /** Suggested script name, such as `markdown_into_pdf`. Also the stable key for de-duplicating Inbox notifications. */
  name: string; title: string; detail: string;
  /** Distinct source chats that asked for it. */
  count: number; sessionIds: string[]; messageIds: string[];
  /** One bounded matching excerpt from an approved source prompt. */
  example: string;
  /** A script capability with this name already exists in the profile. */
  installed: boolean;
}
interface SourcePrompt { sessionId: string; messageId: string; text: string }

const formats: Record<string, { id: string; label: string }> = {};
for (const [id, label, ...aliases] of [
  ["markdown", "Markdown", "md"], ["pdf", "PDF"], ["html", "HTML", "htm"], ["docx", "Word", "word"], ["xlsx", "Excel", "excel", "spreadsheet"],
  ["pptx", "PowerPoint", "powerpoint", "slides"], ["csv", "CSV", "tsv"], ["json", "JSON"], ["yaml", "YAML", "yml"], ["xml", "XML"], ["toml", "TOML"],
  ["text", "plain text", "txt"], ["png", "PNG"], ["jpeg", "JPEG", "jpg"], ["svg", "SVG"], ["webp", "WebP"], ["gif", "GIF"], ["mp4", "MP4"],
  ["mp3", "MP3"], ["wav", "WAV"], ["epub", "EPUB"], ["latex", "LaTeX", "tex"], ["rtf", "RTF"], ["ics", "calendar file", "ical"],
] as const) for (const alias of [id, ...aliases]) formats[alias] = { id, label };
const format = (token: string | undefined) => token === undefined ? undefined : formats[token];
const convertVerbs = new Set(["convert", "turn", "transform", "export", "render", "change", "save", "compile", "make", "rewrite"]);
const createVerbs = new Set(["create", "generate", "make", "produce", "build", "export", "render"]);
const taskVerbs = new Set(["resize", "compress", "extract", "rename", "minify", "optimize", "optimise", "sort", "dedupe", "deduplicate", "merge", "split",
  "count", "validate", "lint", "parse", "encode", "decode", "zip", "unzip", "archive", "backup", "scrape", "download", "bump", "crop", "watermark",
  "normalize", "normalise", "sanitize", "anonymize", "redact", "reformat", "format", "transcribe", "package", "tag"]);
const lead = new Set(["please", "pls", "can", "could", "would", "will", "you", "now", "also", "then", "again", "just", "and", "ok", "okay", "hey"]);
const filler = new Set(["the", "a", "an", "this", "that", "these", "those", "my", "our", "your", "all", "some", "it", "them", "me", "us", "each", "every",
  "new", "same", "file", "files", "following", "current", "latest"]);
const stops = new Set(["to", "into", "as", "for", "with", "from", "in", "on", "by", "at", "using", "via", "of", "and", "so", "then", "but", "because", "if"]);
const tokens = (line: string) => line.toLowerCase().replace(/[^a-z0-9+#\s-]/g, " ").split(/\s+/).filter(Boolean);

function conversion(words: string[]): { name: string; title: string } | null {
  for (let index = 0; index < words.length; index++) {
    const window = words.slice(index + 1, index + 12);
    if (convertVerbs.has(words[index]!)) {
      const at = window.findIndex((word) => format(word)), source = format(window[at]);
      const rest = window.slice(at + 1), connector = rest.findIndex((word) => word === "into" || word === "to" || word === "as");
      const target = connector >= 0 && connector <= 3 ? rest.slice(connector + 1, connector + 5).map(format).find(Boolean) : undefined;
      if (source && target && source.id !== target.id) return { name: `${source.id}_into_${target.id}`, title: `Convert ${source.label} to ${target.label}` };
    }
    if (createVerbs.has(words[index]!)) {
      const at = window.findIndex((word) => format(word)), target = format(window[at]);
      const rest = window.slice(at + 1), from = rest.indexOf("from");
      const source = from >= 0 && from <= 3 ? rest.slice(from + 1, from + 5).map(format).find(Boolean) : undefined;
      if (source && target && source.id !== target.id) return { name: `${source.id}_into_${target.id}`, title: `Convert ${source.label} to ${target.label}` };
    }
  }
  return null;
}
function task(words: string[]): { name: string; title: string } | null {
  let index = 0;
  while (index < words.length && lead.has(words[index]!)) index++;
  const verb = words[index];
  if (!verb || !taskVerbs.has(verb)) return null;
  const objects: string[] = [];
  for (const word of words.slice(index + 1, index + 8)) {
    if (stops.has(word) || objects.length === 2) break;
    if (filler.has(word) || !/^[a-z]{3,24}$/.test(word)) continue;
    objects.push(word);
  }
  if (!objects.length) return null;
  const name = [verb, ...objects].join("_");
  return { name, title: `${verb[0]!.toUpperCase()}${verb.slice(1)} ${objects.join(" ")}` };
}
const excerpt = (line: string) => Array.from(line.trim()).slice(0, 200).join("");

/**
 * Groups repeated requests by suggested tool name. Conversions need two distinct chats; other repeated tasks need three,
 * because a verb plus object is a weaker signal. Results are bounded and ordered by how many chats asked.
 */
export function detectToolSuggestions(sources: readonly SourcePrompt[], installedScripts: readonly string[] = []): ToolSuggestion[] {
  const found = new Map<string, { title: string; conversion: boolean; sessions: Set<string>; messages: Set<string>; example: string }>();
  for (const source of sources) {
    for (const line of source.text.split(/[\n!?;]+|\.(?=\s|$)/).map((value) => value.trim()).filter((value) => value.length >= 8 && value.length <= 400)) {
      const words = tokens(line), converted = conversion(words), match = converted ?? task(words);
      if (!match || !TOOL_SCRIPT_NAME.test(match.name)) continue;
      const entry = found.get(match.name) ?? { title: match.title, conversion: Boolean(converted), sessions: new Set<string>(), messages: new Set<string>(), example: excerpt(line) };
      entry.sessions.add(source.sessionId); entry.messages.add(source.messageId); found.set(match.name, entry);
    }
  }
  const installed = new Set(installedScripts);
  return [...found].filter(([, entry]) => entry.sessions.size >= (entry.conversion ? 2 : 3))
    .sort(([a, left], [b, right]) => right.sessions.size - left.sessions.size || a.localeCompare(b)).slice(0, 8)
    .map(([name, entry]) => ({ name, title: entry.title, count: entry.sessions.size,
      detail: `Asked in ${entry.sessions.size} chats. A reviewed script tool can do this the same way every time instead of the model working it out again.`,
      sessionIds: [...entry.sessions].slice(0, 20), messageIds: [...entry.messages].slice(0, 20), example: entry.example, installed: installed.has(name) }));
}

/** The stdin/stdout contract every approved script tool follows. Shared by the desktop, TUI and generated prompts. */
export const SCRIPT_TOOL_CONTRACT = "Moguri runs an approved script with Node.js as an ES module in the session's project root. It reads one JSON object " +
  "{\"arguments\": {...}, \"projectRoot\": \"...\"} from stdin, writes its result to stdout (at most 128 KiB) and exits 0. On failure it writes a clear " +
  "message to stderr and exits non-zero.";

/** Reads `// description: ...` (or `# description:` / ` * description:`) from the first lines of a script. */
export function scriptDescription(content: string): string | null {
  for (const line of content.split("\n").slice(0, 20)) {
    const match = line.match(/^\s*(?:\/\/|#|\*|\/\*\*?)\s*@?description:?\s+(.+?)\s*(?:\*\/)?\s*$/i);
    if (match?.[1]) return Array.from(match[1]).slice(0, 1000).join("");
  }
  return null;
}

/** A complete, editable chat prompt asking the agent to write a script tool and submit it for review with propose_script. */
export function toolScriptPrompt(name: string, purpose: string): string {
  return [
    `Write a Moguri script tool named \`${name}\` that can ${purpose.trim().replace(/[.\s]+$/, "")}.`,
    "",
    SCRIPT_TOOL_CONTRACT,
    "Use only Node.js built-in modules unless this project already depends on a library that does the job; never download code at run time.",
    `Start the file with a \`// description: ...\` line that tells an agent when to use the tool, then document the expected \`arguments\` fields.`,
    `When it's ready, submit the complete source with the propose_script tool using the name \`${name}\`. Don't run or enable it; I'll review it and turn it on.`,
  ].join("\n");
}
