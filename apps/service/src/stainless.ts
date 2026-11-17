import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { MoguriError, isRecord } from "../../../packages/protocol/src/core.ts";
import { browserUrl } from "../../../packages/protocol/src/browser.ts";
import { STAINLESS_BUNDLE_ID, STAINLESS_EXECUTABLE_NAME, isTestedStainless, type StainlessCheck, type StainlessInstallation,
  type StainlessSettings, type StainlessStatus } from "../../../packages/protocol/src/stainless.ts";
import type { Session } from "../../../packages/protocol/src/index.ts";
import { runDataTask } from "./data-tools.ts";

const run = promisify(execFile);
export interface StainlessOptions {
  /** Reads an Info.plist as JSON. Defaults to /usr/bin/plutil, which never launches the app. */
  readPlist?: (path: string) => Promise<unknown>;
  /** Hands one URL to the exact bundle. Defaults to /usr/bin/open -a APP URL. */
  open?: (appPath: string, url: string) => Promise<void>;
  platform?: NodeJS.Platform;
  home?: string;
}
interface Detected { status: Omit<StainlessStatus, "enabled" | "automation" | "check">; identity: string | null }

const defaultReadPlist = async (path: string): Promise<unknown> => {
  const { stdout } = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", path], { timeout: 5000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
};
const defaultOpen = async (appPath: string, url: string): Promise<void> => { await run("/usr/bin/open", ["-a", appPath, url], { timeout: 10000 }); };
const text = (value: unknown, max = 128) => typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

/**
 * Optional Stainless browser integration. Detection only reads the bundle's Info.plist. A check launches one new
 * headless instance with a disposable profile through the same owned Playwright path agents use.
 * See docs/architecture/stainless.md.
 */
export class StainlessIntegration {
  private readonly checks = new Map<string, StainlessCheck>();
  private checking: Promise<StainlessStatus> | undefined;
  private readonly abort = new AbortController();
  constructor(private readonly settings: () => StainlessSettings | undefined, private readonly options: StainlessOptions = {}) {}

  async status(): Promise<StainlessStatus> {
    const settings = this.settings(), enabled = settings?.enabled === true;
    const { status, identity } = await this.detect(settings?.appPath ?? null);
    const check = identity ? this.checks.get(identity) ?? null : null;
    const automation = !enabled ? "off" : status.availability !== "found" ? "unavailable" : check?.outcome === "failed" ? "incompatible" :
      status.tested || check?.outcome === "passed" ? "ready" : "needs_check";
    return { ...status, enabled, check, automation };
  }
  /** The executable an approved Stainless batch may launch, or undefined when automation is not ready. */
  async agentExecutable(): Promise<string | undefined> {
    const status = await this.status();
    return status.automation === "ready" ? status.installation?.executable : undefined;
  }
  /** Runs one owned headless compatibility check against a generated loopback page. Concurrent callers share it. */
  check(): Promise<StainlessStatus> {
    this.checking ??= this.runCheck().finally(() => { this.checking = undefined; });
    return this.checking;
  }
  async open(session: Session | undefined, url: string): Promise<void> {
    if (!session) throw new MoguriError("session_missing", "Choose an existing session. Nothing was opened.", 404);
    if (session.controls.env !== "Local") throw new MoguriError("stainless_env", `This session runs in ${session.controls.env}, so its preview is not on this Mac. Stainless was not opened and no Local replacement was used.`, 409);
    let target: URL;
    try { target = browserUrl(url); } catch (error) { throw new MoguriError("stainless_url", error instanceof Error ? error.message : "Use an HTTPS or loopback HTTP URL.", 400); }
    const status = await this.status();
    if (!status.enabled) throw new MoguriError("stainless_disabled", "Stainless is off. Turn it on in Settings > Stainless. Nothing was opened.", 409);
    if (status.availability !== "found" || !status.installation) throw new MoguriError("stainless_missing", status.diagnostic, 409);
    try { await (this.options.open ?? defaultOpen)(status.installation.appPath, target.href); }
    catch (error) {
      console.error("Stainless open failed:", error instanceof Error ? error.message : error);
      throw new MoguriError("stainless_open", "macOS did not confirm that Stainless opened the page. Nothing was retried.", 502);
    }
  }
  close(): void { this.abort.abort(); }

  private async runCheck(): Promise<StainlessStatus> {
    const settings = this.settings();
    if (settings?.enabled !== true) throw new MoguriError("stainless_disabled", "Turn on Stainless in Settings before checking it. Nothing was launched.", 409);
    const { status, identity } = await this.detect(settings.appPath);
    if (status.availability !== "found" || !status.installation || !identity) throw new MoguriError("stainless_missing", status.diagnostic, 409);
    const marker = randomBytes(16).toString("hex"), path = `/${randomBytes(16).toString("hex")}`;
    const server = createServer((request, response) => {
      if (request.url !== path) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html><title>Moguri Stainless check</title><main>Generated check ${marker}</main><script>console.info("moguri-check")</script>`);
    });
    const root = await mkdtemp(join(tmpdir(), "moguri-stainless-check-"));
    const started = performance.now();
    let check: StainlessCheck;
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!isRecord(address) || typeof address.port !== "number") throw new Error("The generated loopback page did not start.");
      const url = `http://127.0.0.1:${address.port}${path}`;
      const value = await runDataTask({ kind: "playwright", root, stainlessExecutable: status.installation.executable,
        webAccess: { version: 1, unrestricted: false, sites: [], origins: [new URL(url).origin] },
        arguments: { launch: { kind: "stainless", url }, actions: [{ action: "snapshot" }, { action: "diagnostics" }] } }, this.abort.signal);
      const observations = isRecord(value) && Array.isArray(value.observations) ? value.observations : [];
      const snapshot = observations.find((entry) => isRecord(entry) && entry.action === "snapshot");
      const passed = isRecord(value) && value.outcome === "completed" && value.closedKnownTarget === true && isRecord(snapshot) && String(snapshot.text).includes(marker);
      check = { outcome: passed ? "passed" : "failed", checkedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), identity,
        reportedVersion: isRecord(value) ? text(value.reportedVersion) : null,
        diagnostic: passed ? null : isRecord(value) && typeof value.diagnostic === "string" ? value.diagnostic : "Stainless did not load the generated page." };
    } catch (error) {
      check = { outcome: "failed", checkedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), identity, reportedVersion: null,
        diagnostic: `${error instanceof Error ? error.message : "The headless launch failed."}`.slice(0, 600) };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true }).catch((error: unknown) => console.error("Stainless check root cleanup failed:", error instanceof Error ? error.message : error));
    }
    if (check.outcome === "failed") console.error("Stainless compatibility check failed:", check.diagnostic);
    this.checks.set(identity, check);
    return this.status();
  }

  private async detect(appPath: string | null): Promise<Detected> {
    const base = { supported: true, tested: false, installation: null } as const;
    if ((this.options.platform ?? process.platform) !== "darwin") return { status: { ...base, supported: false, availability: "missing", diagnostic: "Stainless runs on macOS only." }, identity: null };
    const candidates = appPath ? [appPath] : ["/Applications/Stainless.app", join(this.options.home ?? homedir(), "Applications/Stainless.app")];
    let bundle: string | undefined;
    for (const candidate of candidates) {
      if (!isAbsolute(candidate)) continue;
      try { if ((await lstat(candidate)).isDirectory() || (await realpath(candidate)) !== candidate) { bundle = candidate; break; } }
      catch (error) { if (!(isRecord(error) && error.code === "ENOENT")) console.error("Stainless detection could not read", candidate, error instanceof Error ? error.message : error); }
    }
    const missing = appPath ? `No Stainless app was found at ${appPath}. Nothing else was searched.` : "Stainless was not found in /Applications or ~/Applications.";
    if (!bundle) return { status: { ...base, availability: "missing", diagnostic: missing }, identity: null };
    const invalid = (diagnostic: string): Detected => ({ status: { ...base, availability: "invalid", diagnostic }, identity: null });
    let real: string, plist: unknown;
    try { real = await realpath(bundle); }
    catch { return invalid(`${bundle} could not be resolved.`); }
    if (!(await lstat(real)).isDirectory()) return invalid(`${bundle} is not an app bundle.`);
    try { plist = await (this.options.readPlist ?? defaultReadPlist)(join(real, "Contents/Info.plist")); }
    catch (error) { return invalid(`${bundle} has no readable Info.plist: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`); }
    if (!isRecord(plist) || plist.CFBundleIdentifier !== STAINLESS_BUNDLE_ID || plist.CFBundleExecutable !== STAINLESS_EXECUTABLE_NAME) {
      return invalid(`${bundle} is not Stainless (expected bundle ${STAINLESS_BUNDLE_ID}).`);
    }
    const chromium = text(plist.CFBundleShortVersionString);
    if (!chromium) return invalid(`${bundle} declares no version.`);
    const executable = join(real, "Contents/MacOS", STAINLESS_EXECUTABLE_NAME);
    let file;
    try { file = await lstat(executable); } catch { return invalid(`${bundle} has no ${STAINLESS_EXECUTABLE_NAME} executable.`); }
    if (!file.isFile() || file.isSymbolicLink() || !(file.mode & 0o111)) return invalid(`${bundle} has no regular ${STAINLESS_EXECUTABLE_NAME} executable.`);
    const installation: StainlessInstallation = { appPath: real, executable, bundleId: STAINLESS_BUNDLE_ID, chromium,
      version: text(plist.StainlessVersion), build: Number.isSafeInteger(plist.StainlessBuild) ? Number(plist.StainlessBuild) : null, channel: text(plist.StainlessChannel) };
    const identity = createHash("sha256").update(JSON.stringify([real, installation.version, installation.build, chromium, file.dev, file.ino, file.size, file.mtimeMs])).digest("hex");
    const tested = isTestedStainless(installation);
    return { status: { supported: true, availability: "found", installation, tested,
      diagnostic: tested ? "Tested build." : "This Stainless build has not been tested with Moguri. Run Check compatibility before agents use it." }, identity };
  }
}
