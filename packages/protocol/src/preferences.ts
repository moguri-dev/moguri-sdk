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
export const ThemePaletteSchema = Type.Union([
  Type.Literal("moguri"), Type.Literal("ocean"), Type.Literal("orchid"), Type.Literal("rose"),
  Type.Literal("terminal"), Type.Literal("aubergine"), Type.Literal("ember"), Type.Literal("monochrome"),
  Type.Literal("vaporwave"), Type.Literal("crystal"), Type.Literal("custom"),
]);
export type ThemePalette = Static<typeof ThemePaletteSchema>;
export const themePalettes = [
  { id: "moguri", name: "Moguri", description: "Soft sage and neutral surfaces" },
  { id: "ocean", name: "Ocean", description: "Cool blue accents" },
  { id: "orchid", name: "Orchid", description: "Soft violet accents" },
  { id: "rose", name: "Rose", description: "Pink accents and rose-tinted surfaces" },
  { id: "terminal", name: "Terminal", description: "Phosphor green on ink-black, with a light counterpart" },
  { id: "aubergine", name: "Aubergine", description: "Deep eggplant and lilac" },
  { id: "ember", name: "Ember", description: "Warm red and copper" },
  { id: "monochrome", name: "Monochrome", description: "Black, white and grayscale only" },
  { id: "vaporwave", name: "Vaporwave", description: "Cyan, pink and violet" },
  { id: "crystal", name: "Crystal", description: "Original cobalt and silver JRPG menus" },
  { id: "custom", name: "Custom", description: "Your saved element colors" },
] as const satisfies readonly { id: ThemePalette; name: string; description: string }[];
export const AppearanceSchema = Type.Object({
  theme: Type.Union([Type.Literal("dark"), Type.Literal("light"), Type.Literal("system")]),
  palette: Type.Optional(ThemePaletteSchema),
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
  rose: {
    dark: {
      text: "#f4e3ed", canvas: "#21151e", surface: "#291c27", sidebar: "#1c111a", subtle: "#2d202b",
      line: "#584052", controlLine: "#987b90", muted: "#d5afc6",
      accent: "#f0b2d0", accentHover: "#f8c5dd", accentActive: "#e29abb", onAccent: "#38192c",
      selected: "#493044", selectionText: "#f9ddea", hover: "#3d2c3a", active: "#473140",
      hoverLine: "#aa8da4", softLine: "#45313e", code: "#20131c",
    },
    light: {
      text: "#382330", canvas: "#fff5f9", surface: "#fffafc", sidebar: "#faedf3", subtle: "#fcf3f7",
      line: "#dfc4d2", controlLine: "#947184", muted: "#704a63",
      accent: "#923359", accentHover: "#782847", accentActive: "#602037",
      selected: "#f0dbe7", selectionText: "#64203f", hover: "#f2e3ec", active: "#e9d8e3",
      hoverLine: "#876477", softLine: "#ead7e2", code: "#f7eaf1",
    },
  },
  terminal: {
    dark: {
      text: "#c4f4ce", canvas: "#050b08", surface: "#09140e", sidebar: "#050b08", subtle: "#0d1b13",
      line: "#244631", controlLine: "#699775", muted: "#98c9a4",
      accent: "#76ee96", accentHover: "#a1f7b7", accentActive: "#60d781", onAccent: "#05200d",
      selected: "#193b25", selectionText: "#d2ffdc", hover: "#142c1d", active: "#1b3725",
      hoverLine: "#83b08e", softLine: "#173822", code: "#061009",
    },
    light: {
      text: "#153a22", canvas: "#f0f8f1", surface: "#f8fff8", sidebar: "#e8f2e9", subtle: "#f2faf2",
      line: "#c4d7c8", controlLine: "#6e8b75", muted: "#3e6349",
      accent: "#1a6733", accentHover: "#14522a", accentActive: "#0d3d1c",
      selected: "#d2e8d8", selectionText: "#124626", hover: "#dceade", active: "#d1e2d4",
      hoverLine: "#567960", softLine: "#d5e6d9", code: "#eaf4eb",
    },
  },
  aubergine: {
    dark: {
      text: "#f0e5f6", canvas: "#201728", surface: "#291e34", sidebar: "#19131f", subtle: "#30243c",
      line: "#584064", controlLine: "#967eaa", muted: "#c7b1d5",
      accent: "#d9b5ed", accentHover: "#ecd1fb", accentActive: "#c79bdd", onAccent: "#321c41",
      selected: "#493456", selectionText: "#f4dfff", hover: "#3a2c46", active: "#44334f",
      hoverLine: "#b09bc1", softLine: "#45334f", code: "#1e1627",
    },
    light: {
      text: "#35253e", canvas: "#f7f1fb", surface: "#fdfaff", sidebar: "#f0e7f6", subtle: "#f8f2fc",
      line: "#d9c9e2", controlLine: "#90749c", muted: "#634b72",
      accent: "#70418d", accentHover: "#5a3372", accentActive: "#442657",
      selected: "#e8d7f0", selectionText: "#4c2863", hover: "#e9dfee", active: "#e0d3e8",
      hoverLine: "#7f618b", softLine: "#e8dced", code: "#efe5f5",
    },
  },
  ember: {
    dark: {
      text: "#f5e5e0", canvas: "#231716", surface: "#2b1d1b", sidebar: "#1c1211", subtle: "#32211f",
      line: "#5c413a", controlLine: "#9e7c72", muted: "#d6b7ae",
      accent: "#ffb3a5", accentHover: "#ffccbf", accentActive: "#e99b8c", onAccent: "#3b1b16",
      selected: "#4c302b", selectionText: "#ffe0d8", hover: "#412d2a", active: "#4a3530",
      hoverLine: "#bd958a", softLine: "#45312c", code: "#211412",
    },
    light: {
      text: "#3d2721", canvas: "#fff5f1", surface: "#fffbf9", sidebar: "#f9ece6", subtle: "#fdf4ef",
      line: "#dfc8bd", controlLine: "#94766b", muted: "#745046",
      accent: "#9a3e2d", accentHover: "#7d3123", accentActive: "#60251a",
      selected: "#f4dcd2", selectionText: "#6b281d", hover: "#f0e1da", active: "#e9d6cb",
      hoverLine: "#836055", softLine: "#ead9d0", code: "#f5e8e1",
    },
  },
  monochrome: {
    dark: {
      text: "#ececec", canvas: "#141414", surface: "#1b1b1b", sidebar: "#101010", subtle: "#222222",
      line: "#424242", controlLine: "#818181", muted: "#bdbdbd",
      accent: "#e2e2e2", accentHover: "#f2f2f2", accentActive: "#cbcbcb", onAccent: "#171717",
      selected: "#383838", selectionText: "#ffffff", danger: "#eeeeee",
      hover: "#303030", active: "#383838", hoverLine: "#959595", softLine: "#303030", code: "#101010",
      warningBg: "#2a2a2a", warningText: "#e5e5e5", warningLine: "#929292", warningCode: "#202020",
      errorBg: "#292929", errorText: "#f4f4f4", errorLine: "#a0a0a0",
    },
    light: {
      text: "#232323", canvas: "#f6f6f6", surface: "#ffffff", sidebar: "#eeeeee", subtle: "#f7f7f7",
      line: "#d7d7d7", controlLine: "#7d7d7d", muted: "#515151",
      accent: "#363636", accentHover: "#262626", accentActive: "#161616", onAccent: "#ffffff",
      selected: "#dddddd", selectionText: "#242424", danger: "#353535",
      hover: "#e8e8e8", active: "#dddddd", hoverLine: "#737373", softLine: "#e9e9e9", code: "#efefef",
      warningBg: "#f2f2f2", warningText: "#3c3c3c", warningLine: "#777777", warningCode: "#e7e7e7",
      errorBg: "#eeeeee", errorText: "#303030", errorLine: "#777777",
    },
  },
  vaporwave: {
    dark: {
      text: "#f0e6ff", canvas: "#17122d", surface: "#211a3a", sidebar: "#120e24", subtle: "#272041",
      line: "#57436e", controlLine: "#a080ba", muted: "#c7b8e3",
      accent: "#71e6e5", accentHover: "#a0f4ed", accentActive: "#58cfdb", onAccent: "#092e37",
      selected: "#48305e", selectionText: "#ffcdf2", danger: "#ffb5ce",
      hover: "#33294f", active: "#3d325c", hoverLine: "#c497db", softLine: "#39284f", code: "#130f27",
    },
    light: {
      text: "#372249", canvas: "#fbf2ff", surface: "#fffaff", sidebar: "#f2e5fc", subtle: "#faf1ff",
      line: "#dcc2e6", controlLine: "#8e739e", muted: "#6a4e7a",
      accent: "#00616d", accentHover: "#004e59", accentActive: "#003b45",
      selected: "#eed4f3", selectionText: "#692a74", danger: "#963662",
      hover: "#ecdef4", active: "#e3d4ed", hoverLine: "#7c5b8d", softLine: "#ead7f2", code: "#f2e6fa",
    },
  },
  crystal: {
    dark: {
      text: "#f0f3ff", canvas: "#0b1536", surface: "#15264f", sidebar: "#0b1536", subtle: "#192e5c",
      line: "#48649c", controlLine: "#88a4d8", muted: "#c0cdef",
      accent: "#b5dfff", accentHover: "#d4ecff", accentActive: "#94c8ed", onAccent: "#10254b",
      selected: "#304572", selectionText: "#f0f3ff", hover: "#243d69", active: "#2d4877",
      hoverLine: "#a3bdec", softLine: "#263c68", code: "#0b1738",
    },
    light: {
      text: "#1e3155", canvas: "#f4f7ff", surface: "#fbfcff", sidebar: "#e9eefb", subtle: "#f0f4ff",
      line: "#c4d0e9", controlLine: "#7588ac", muted: "#495b83",
      accent: "#295694", accentHover: "#214578", accentActive: "#18345b",
      selected: "#dce6fa", selectionText: "#183a70", hover: "#e1e9fa", active: "#d6e0f6",
      hoverLine: "#637ba7", softLine: "#dbe4f6", code: "#eaf0fc",
    },
  },
} satisfies Record<Exclude<ThemePalette, "moguri" | "custom">, Record<ThemeMode, Partial<ThemeColors>>>;
export function appearanceColors(appearance: Appearance, mode: ThemeMode): ThemeColors {
  const palette = appearance.palette ?? "moguri";
  return { ...colors[mode], ...(palette === "custom" ? appearance.custom?.[mode] : palette === "moguri" ? {} : palettes[palette][mode]) };
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
