import { lstat } from "node:fs/promises";
import { join, isAbsolute, relative } from "node:path";
import { _electron, chromium, type Browser, type ElectronApplication, type Page } from "playwright-core";
import { parse, MoguriError } from "../../../packages/protocol/src/core.ts";
import { PlaywrightToolSchema } from "../../../packages/protocol/src/playwright-tools.ts";
import { browserUrl } from "../../../packages/protocol/src/browser.ts";
import { webAccessAllows, type WebAccess } from "../../../packages/protocol/src/web-policy.ts";
import type { ToolDelivery } from "../../../packages/protocol/src/chat-outputs.ts";

export async function runOwnedPlaywright(root: string, input: Record<string, unknown>, temporary: string, access?: WebAccess) {
  const args = parse(PlaywrightToolSchema, input), deadline = Date.now() + 25000;
  if (!isAbsolute(args.launch.executable)) throw new MoguriError("playwright_executable", "Choose one exact installed executable path. No browser download, PATH search or fallback.");
  const owner = await lstat(temporary);
  if (!owner.isDirectory() || owner.isSymbolicLink() || owner.uid !== process.getuid?.()) throw new MoguriError("playwright_owner", "The parent-owned temporary profile changed. No directory was adopted.");
  let electron: ElectronApplication | undefined, browser: Browser | undefined, page: Page | undefined;
  let dispatched = false, closed = false;
  const observations: unknown[] = [], deliveries: ToolDelivery[] = [];
  let diagnostic: string | null = null;
  const timeout = () => Math.max(1, Math.min(10000, deadline - Date.now()));
  try {
    if (args.launch.kind === "electron") {
      const entry = args.launch.entry === "." ? root : join(root, args.launch.entry);
      const scoped = relative(root, entry);
      if (isAbsolute(args.launch.entry) || scoped === ".." || scoped.startsWith("../")) throw new MoguriError("playwright_entry", "Electron entrypoints must remain in the approved root. No personal app was adopted.");
      dispatched = true;
      electron = await _electron.launch({ executablePath: args.launch.executable, args: [entry, `--user-data-dir=${temporary}`],
        cwd: root, timeout: timeout(), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: temporary, TMPDIR: temporary, NO_COLOR: "1" } });
      page = await electron.firstWindow({ timeout: timeout() });
    } else {
      const url = browserUrl(args.launch.url);
      if (!access || !webAccessAllows(access, url.href)) throw new MoguriError("playwright_website", "This exact Chromium URL has no admitted website scope. No page was opened.", 403);
      dispatched = true;
      browser = await chromium.launch({ executablePath: args.launch.executable, headless: true, timeout: timeout(),
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: temporary, TMPDIR: temporary, NO_COLOR: "1" } });
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: false });
      await context.route("**/*", (route) => webAccessAllows(access!, route.request().url()) ? route.continue() : route.abort("blockedbyclient"));
      page = await context.newPage(); await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: timeout() });
    }
    page.on("dialog", (dialog) => { void dialog.dismiss().catch((error: unknown) => console.error("Owned app dialog dismissal failed:", error instanceof Error ? error.message : "unconfirmed dialog")); });
    page.on("popup", (popup) => { void popup.close().catch((error: unknown) => console.error("Owned app popup cleanup failed:", error instanceof Error ? error.message : "unconfirmed popup")); });
    let imageBytes = 0;
    for (const action of args.actions) {
      if (Date.now() >= deadline) throw new MoguriError("tool_partial", "The owned app batch exceeded 25 seconds. No remaining input was replayed.");
      if (action.action === "click" || action.action === "type") {
        const locator = page.locator(action.selector);
        await locator.waitFor({ state: "visible", timeout: timeout() });
        if (await locator.count() !== 1) throw new MoguriError("playwright_selector", "The explicit selector must identify exactly one element. No first or guessed element was selected.");
        const usable = await locator.evaluate((node) => node instanceof HTMLElement && !node.closest("[inert]") &&
          !(node instanceof HTMLInputElement && ["file", "password", "hidden"].includes(node.type)));
        if (!usable) throw new MoguriError("playwright_field", "Password/file/hidden/inert inputs are not app-control targets.");
        if (action.action === "click") await locator.click({ timeout: timeout() });
        else {
          await locator.fill(action.text, { timeout: timeout() });
          if (await locator.inputValue() !== action.text) throw new MoguriError("tool_partial", "The app did not accept the complete requested text. Inspect the partial result; no input replay.");
        }
        observations.push({ action: action.action, url: page.url(), acknowledged: true });
      } else if (action.action === "wait") {
        if (action.selector) await page.locator(action.selector).waitFor({ state: "visible", timeout: Math.min(timeout(), Math.max(1, action.milliseconds)) });
        else {
          if (action.milliseconds > deadline - Date.now()) throw new MoguriError("tool_partial", "The complete requested wait no longer fits this batch's remaining deadline. No shorter wait was called successful.");
          await page.waitForTimeout(action.milliseconds);
        }
        observations.push({ action: "wait", url: page.url() });
      } else if (action.action === "snapshot") {
        const text = await page.locator("body").innerText({ timeout: timeout() });
        if (Buffer.byteLength(text) > 16000) throw new MoguriError("playwright_snapshot", "The app snapshot exceeds 16 KiB. Narrow the app view; no text was silently truncated.");
        observations.push({ action: "snapshot", url: page.url(), text, untrusted: true });
      } else {
        if (deliveries.length >= 4) throw new MoguriError("playwright_images", "A batch supports at most four screenshots. No image was dropped.");
        const bytes = await page.screenshot({ type: "png", timeout: timeout(), animations: "disabled" });
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new MoguriError("playwright_image", "The actual page screenshot exceeds its 8 MiB bound. No desktop screenshot or truncated image was substituted.");
        imageBytes += bytes.length;
        if (imageBytes > 8 * 1024 * 1024) throw new MoguriError("playwright_images", "The complete screenshot set exceeds its bounded delivery. No image was silently dropped.");
        deliveries.push({ kind: "image", name: action.name ?? "Owned app screenshot", data: bytes.toString("base64") });
        observations.push({ action: "take_screenshot", bytes: bytes.length, url: page.url(), delivery: "chat response; not implicit model context" });
      }
    }
    if (electron) await electron.close(); else await browser!.close();
    closed = true;
  } catch (error) {
    if (dispatched) diagnostic = `${error instanceof Error ? error.message : "Owned Playwright batch failed."} An app or input may already have run. No action was replayed; inspect the original result.`;
    else throw error;
  } finally {
    if (!closed) {
      try { if (electron) await electron.close(); if (browser) await browser.close(); closed = !dispatched || Boolean(electron || browser); }
      catch (error) { diagnostic = `${diagnostic ?? ""} Known app cleanup is unconfirmed: ${error instanceof Error ? error.message : "inspect its original owner"}. Its private profile was retained.`; }
    }
  }
  return { observations, deliveries, closedKnownTarget: closed, outcome: diagnostic ? "partial" : "completed", diagnostic,
    boundary: "New owned Electron/Chromium instance only, not native OS control or a personal browser. Local Electron code is uncontained host execution; known target closure is not detached-descendant confinement." };
}
