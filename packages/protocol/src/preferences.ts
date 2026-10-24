import { Type, type Static } from "typebox";

const text = Type.Optional(Type.String({ maxLength: 64 * 1024 }));
export const WorkflowGuidanceSchema = Type.Object({
  documentation: text, mergeConflicts: text, fixingCi: text, featurePlanning: text, debugging: text,
}, { additionalProperties: false });
export const GuidanceSchema = Type.Object({
  readmeReadiness: text, readmeSections: text, issueTemplates: text, prSections: text,
  preferredStacks: text, bootstrap: text, deliverableStyle: text, responseStyle: text,
  communityFiles: text, securityContact: text, contributingContact: text, preferredLicenses: text, aiPolicy: text,
  ...WorkflowGuidanceSchema.properties,
}, { additionalProperties: false });
export type Guidance = Static<typeof GuidanceSchema>;
export type WorkflowGuidance = Static<typeof WorkflowGuidanceSchema>;
export const WORKFLOW_GUIDANCE_FIELDS = [
  { key: "documentation", label: "Documentation style" },
  { key: "mergeConflicts", label: "When solving merge conflicts" },
  { key: "fixingCi", label: "When fixing CI" },
  { key: "featurePlanning", label: "When planning a feature" },
  { key: "debugging", label: "When debugging" },
] as const;
export const GUIDANCE_GROUPS = [
  { label: "Repository readiness and templates", fields: [
    { key: "readmeReadiness", label: "Open-source readiness" }, { key: "readmeSections", label: "README sections" },
    { key: "issueTemplates", label: "Issue types and fields" }, { key: "prSections", label: "Pull request sections and evidence" },
  ] },
  { label: "Stacks and bootstrap", fields: [
    { key: "preferredStacks", label: "Preferred technology stacks" }, { key: "bootstrap", label: "Project bootstrap by language" },
  ] },
  { label: "Writing and communication", fields: [
    { key: "deliverableStyle", label: "Non-code writing style" }, { key: "responseStyle", label: "Responses to the user" },
  ] },
  { label: "Community files and policy", fields: [
    { key: "communityFiles", label: "Community-file guidance" }, { key: "securityContact", label: "Security contact" },
    { key: "contributingContact", label: "Contributing contact" }, { key: "preferredLicenses", label: "Preferred licenses" },
    { key: "aiPolicy", label: "AI policy" },
  ] },
  { label: "Engineering workflows", fields: WORKFLOW_GUIDANCE_FIELDS },
] as const;

export const readinessGuidance: Guidance = {
  readmeReadiness: "Verify claims, links, commands and implemented capabilities. Public visibility is not an open-source license. Keep README concise and put complete user/developer documentation in docs/. Preserve existing approved policies and ask for missing contacts or legal decisions.",
  readmeSections: "Use existing logo/name, verified badges/navigation, a current meaningful UI screenshot if applicable, optional real demo, mission, table of contents, quickstart, concrete benefits, how it works, configuration, implemented features, documentation links, accountability AI policy, contributing, security and the approved license. Omit unavailable assets rather than inventing them.",
  issueTemplates: "Use separate bug, feature and task structures when appropriate. Bugs describe expected/actual behavior, reproducible steps, environment and sanitized evidence. Features describe the problem, desired outcome and acceptance criteria. Do not request credentials or personal/customer data.",
  prSections: "Describe the problem, meaningful changes, validation and limitations. Include generated before/after screenshots for GUI changes. Link the actual issue when available. Do not invent test results, approvals or attribution.",
  communityFiles: "Preserve the project's approved conduct, contributing, security and license policies. Link agent guidance to verified developer documentation. Ask for missing reporting contacts, supported versions and legal choices; do not fabricate response promises.",
  aiPolicy: "Contributors are responsible for everything they contribute, including AI-assisted code, documentation and assets. Review and test contributions and be able to explain what the code does and why it is needed.",
};
export function effectiveGuidance(global: Guidance = {}, project: WorkflowGuidance = {}): Guidance {
  const result = { ...global };
  for (const { key } of WORKFLOW_GUIDANCE_FIELDS) if (Object.hasOwn(project, key)) result[key] = project[key];
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value?.trim()));
}
export function guidanceText(global?: Guidance, project?: WorkflowGuidance): string {
  const values = effectiveGuidance(global, project);
  return Object.keys(values).length ? `\n<configured-guidance>\nReviewed preferences, not tool/Git permission or proof of a completed action.\n${JSON.stringify(values).replaceAll("<", "\\u003c")}\n</configured-guidance>` : "";
}

const color = Type.Optional(Type.String({ pattern: "^#[a-fA-F0-9]{6}$" }));
export const ThemeColorsSchema = Type.Object({
  text: color, canvas: color, surface: color, sidebar: color, subtle: color, line: color, controlLine: color, muted: color,
  accent: color, accentHover: color, accentActive: color, onAccent: color, selected: color, selectionText: color, danger: color,
  hover: color, active: color, hoverLine: color, softLine: color, code: color,
  warningBg: color, warningText: color, warningLine: color, warningCode: color,
  errorBg: color, errorText: color, errorLine: color,
}, { additionalProperties: false });
export type ThemeColors = Required<Static<typeof ThemeColorsSchema>>;
export type ThemeColor = keyof ThemeColors;
export type ThemeMode = "dark" | "light";
export const AppearanceSchema = Type.Object({
  theme: Type.Union([Type.Literal("dark"), Type.Literal("light"), Type.Literal("system")]),
  palette: Type.Optional(Type.Union([Type.Literal("moguri"), Type.Literal("ocean"), Type.Literal("orchid"), Type.Literal("custom")])),
  custom: Type.Optional(Type.Object({ dark: Type.Optional(ThemeColorsSchema), light: Type.Optional(ThemeColorsSchema) }, { additionalProperties: false })),
}, { additionalProperties: false });
export type Appearance = Static<typeof AppearanceSchema>;
const colors: Record<ThemeMode, ThemeColors> = {
  dark: {
    text: "#e1e8f0", canvas: "#141922", surface: "#191f29", sidebar: "#11161e", subtle: "#1d2530",
    line: "#344151", controlLine: "#65758a", muted: "#a2afc0",
    accent: "#a8d7bc", accentHover: "#b9e5cb", accentActive: "#8dc5a6", onAccent: "#152a20",
    selected: "#233c30", selectionText: "#ccebd9", danger: "#ffb5a9",
    hover: "#2c3746", active: "#354253", hoverLine: "#8090a5", softLine: "#2c3745", code: "#111923",
    warningBg: "#30291d", warningText: "#efd397", warningLine: "#89713d", warningCode: "#211e16",
    errorBg: "#352024", errorText: "#ffc1b7", errorLine: "#ad726b",
  },
  light: {
    text: "#202936", canvas: "#f5f6f8", surface: "#ffffff", sidebar: "#eff1f4", subtle: "#f7f8fa",
    line: "#dce1e7", controlLine: "#7d8999", muted: "#535e6d",
    accent: "#286547", accentHover: "#1f5139", accentActive: "#173d2b", onAccent: "#ffffff",
    selected: "#dfe8e3", selectionText: "#17472e", danger: "#a23e38",
    hover: "#e6eaf0", active: "#dce2e9", hoverLine: "#6d7989", softLine: "#edf0f3", code: "#f0f2f5",
    warningBg: "#fcf9f0", warningText: "#795c24", warningLine: "#d5be8d", warningCode: "#f4efe0",
    errorBg: "#fbf0ee", errorText: "#85352f", errorLine: "#ddc5c2",
  },
};
const palettes = {
  ocean: {
    dark: { accent: "#a7cfea", accentHover: "#bbdef5", accentActive: "#8eb9d5", onAccent: "#142b3b", selected: "#203746", selectionText: "#d5ebfa" },
    light: { accent: "#285f86", accentHover: "#1f4c6b", accentActive: "#173950", selected: "#dce8f0", selectionText: "#193e59" },
  },
  orchid: {
    dark: { accent: "#cdbbe7", accentHover: "#dfcff4", accentActive: "#b59dd5", onAccent: "#2c1d3f", selected: "#362944", selectionText: "#eddefb" },
    light: { accent: "#70488f", accentHover: "#593972", accentActive: "#432b55", selected: "#ece2f2", selectionText: "#4c2d65" },
  },
} satisfies Record<string, Record<ThemeMode, Partial<ThemeColors>>>;
export function appearanceColors(appearance: Appearance, mode: ThemeMode): ThemeColors {
  const palette = appearance.palette ?? "moguri";
  return { ...colors[mode], ...(palette === "ocean" || palette === "orchid" ? palettes[palette][mode] :
    palette === "custom" ? appearance.custom?.[mode] : {}) };
}
export function colorContrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    if (!/^#[a-fA-F0-9]{6}$/.test(hex)) throw new Error("Use a six-digit hexadecimal theme color.");
    const components = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return components[0]! * 0.2126 + components[1]! * 0.7152 + components[2]! * 0.0722;
  };
  const left = luminance(a), right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
export function appearanceErrors(appearance: Appearance): string[] {
  const errors: string[] = [];
  for (const mode of ["dark", "light"] as const) {
    const value = appearanceColors(appearance, mode);
    const check = (foreground: ThemeColor, background: ThemeColor, minimum: number) => {
      const ratio = colorContrast(value[foreground], value[background]);
      if (ratio < minimum) errors.push(`${mode}: ${foreground} / ${background} contrast ${ratio.toFixed(2)}:1 needs ${minimum}:1.`);
    };
    for (const background of ["canvas", "surface", "sidebar", "subtle", "code", "hover", "active"] as const) {
      check("text", background, 4.5); check("muted", background, 4.5); check("accent", background, 3);
    }
    for (const background of ["accent", "accentHover", "accentActive"] as const) check("onAccent", background, 4.5);
    check("selectionText", "selected", 4.5); check("controlLine", "surface", 3); check("hoverLine", "hover", 3);
    check("warningText", "warningBg", 4.5); check("errorText", "errorBg", 4.5); check("danger", "surface", 4.5);
  }
  return errors;
}
export const themeVariable = (key: string) => `--${key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`;

export const VerbositySchema = Type.Union([Type.Literal("dry"), Type.Literal("minimal"), Type.Literal("balanced"), Type.Literal("detailed")]);
export type Verbosity = Static<typeof VerbositySchema>;
export const verbosityGuidance: Record<Verbosity, string> = {
  dry: "Use terse factual output. Omit framing and commentary, but never hide an error, uncertainty, required decision or safety boundary.",
  minimal: "Answer concisely with the outcome and only essential explanation. Keep actionable errors and uncertainty explicit.",
  balanced: "",
  detailed: "Explain meaningful reasoning, tradeoffs, changes and supporting evidence in useful detail. Do not invent results, hidden reasoning or telemetry.",
};
export interface PowerStatus {
  enabled: boolean; status: "idle" | "starting" | "working" | "tail" | "stopping" | "failed";
  until: string | null; diagnostic: string | null;
}
export interface GitHubConnection { login: string; id: number; boundary: "control-plane-gh-cli" }
export interface LinearConnection {
  credential: "configured" | "required";
  account: { id: string; name: string; workspaceId: string; workspaceName: string } | null;
}
export interface SqlConnection { enabled: boolean; endpoint: string; healthy: boolean; version: string | null; diagnostic: string }
export function sqlEndpoint(input: string): URL {
  const url = new URL(input);
  if (input !== input.trim() || /[\u0000-\u001f\u007f]/.test(input) || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    throw new Error("Use an explicit HTTPS daemon origin or loopback HTTP origin, without credentials, paths, query or fragment.");
  }
  return url;
}
