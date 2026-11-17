import { Type, type Static, type TProperties } from "typebox";
import { Value } from "typebox/value";

/**
 * Optional Stainless browser integration. Stainless publishes no automation, MCP or deep-link contract yet
 * (mbianchidev/stainless#22), so Moguri launches the user's installed build itself: a new headless instance with a
 * disposable Moguri-owned profile, driven by the existing owned Playwright tool. See docs/architecture/stainless.md.
 */
const object = <P extends TProperties>(properties: P) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
export const STAINLESS_BUNDLE_ID = "dev.stainless.browser";
export const STAINLESS_EXECUTABLE_NAME = "Stainless";
/** Builds whose owned headless automation path passed `npm run spike:stainless`. Other builds need a passing check. */
export const STAINLESS_TESTED_BUILDS: readonly { version: string; build: number; chromium: string }[] = [
  { version: "0.1.0-preview.7", build: 7, chromium: "158.0.8127.37" },
];
export const StainlessSettingsSchema = object({
  enabled: Type.Boolean(),
  /** Exact absolute Stainless.app bundle. Null searches /Applications, then ~/Applications. */
  appPath: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
});
export type StainlessSettings = Static<typeof StainlessSettingsSchema>;
export const defaultStainlessSettings = (): StainlessSettings => ({ enabled: false, appPath: null });
export interface StainlessInstallation {
  appPath: string; executable: string; bundleId: string;
  /** Stainless product version and build from Info.plist; null when the bundle does not declare them. */
  version: string | null; build: number | null; channel: string | null;
  /** The Chromium version the bundle declares (CFBundleShortVersionString). */
  chromium: string;
}
export interface StainlessCheck {
  outcome: "passed" | "failed"; checkedAt: string; durationMs: number;
  /** Identity of the exact bundle the check launched. A later replacement needs its own check. */
  identity: string; reportedVersion: string | null; diagnostic: string | null;
}
export type StainlessAutomation = "off" | "unavailable" | "needs_check" | "incompatible" | "ready";
export interface StainlessStatus {
  enabled: boolean;
  supported: boolean;
  availability: "missing" | "invalid" | "found";
  installation: StainlessInstallation | null;
  /** True when this exact version/build/Chromium triple is in STAINLESS_TESTED_BUILDS. */
  tested: boolean;
  check: StainlessCheck | null;
  automation: StainlessAutomation;
  diagnostic: string;
}
export const StainlessCommandSchema = Type.Union([
  object({ type: Type.Literal("stainless.check") }),
  object({ type: Type.Literal("stainless.open"), sessionId: id, url: Type.String({ minLength: 1, maxLength: 4096 }) }),
]);
export type StainlessCommand = Static<typeof StainlessCommandSchema>;
export const isStainlessCommand = (value: unknown): value is StainlessCommand => Value.Check(StainlessCommandSchema, value);
export const StainlessQuerySchema = object({ type: Type.Literal("stainless.status") });
export type StainlessResponse = { type: "stainless.status"; stainless: StainlessStatus };
export const isTestedStainless = (installation: Pick<StainlessInstallation, "version" | "build" | "chromium">): boolean =>
  STAINLESS_TESTED_BUILDS.some((tested) => tested.version === installation.version && tested.build === installation.build && tested.chromium === installation.chromium);
/** One short sentence for status rows in every client. */
export function stainlessSummary(status: StainlessStatus): string {
  const build = status.installation ? `Stainless ${status.installation.version ?? status.installation.chromium}` : "Stainless";
  if (!status.supported) return "Stainless runs on macOS only.";
  if (status.availability === "missing") return status.enabled ? "Stainless is not installed. Install it in /Applications or choose its app in Settings." : "Stainless is not installed.";
  if (status.availability === "invalid") return status.diagnostic;
  if (!status.enabled) return `${build} is installed. Turn it on in Settings > Stainless to use it.`;
  switch (status.automation) {
    case "ready": return `${build} is ready${status.tested ? "" : " (checked on this Mac)"}.`;
    case "needs_check": return `${build} is untested. Run Check compatibility before agents can use it.`;
    case "incompatible": return `${build} failed its compatibility check. ${status.check?.diagnostic ?? ""}`.trim();
    default: return status.diagnostic;
  }
}
