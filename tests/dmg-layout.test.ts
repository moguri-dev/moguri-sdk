import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { buildDmg, dmgBackground, DMG_LAYOUT, prepareDmgTools, verifyDmgLayout } from "../scripts/dmg-layout.ts";

const run = promisify(execFile);
test("DMG artwork matches the reference window, icon proportions and centered dashed arrow at both densities", async () => {
  assert.deepEqual(DMG_LAYOUT, { width: 540, height: 380, x: 100, y: 100, iconSize: 80, textSize: 12, app: [130, 220], applications: [410, 220] });
  for (const scale of [1, 2]) {
    const { data, info } = await sharp(await dmgBackground(scale)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 540 * scale); assert.equal(info.height, 380 * scale);
    assert.deepEqual([...data.subarray(0, 4)], [236, 236, 236, 255]);
    const pixels: [number, number][] = [];
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4;
      if (data[offset] !== 236 || data[offset + 1] !== 236 || data[offset + 2] !== 236) pixels.push([x, y]);
    }
    assert.ok(pixels.length > 150 * scale);
    assert.ok(pixels.every(([x, y]) => x >= 243 * scale && x < 294 * scale && y >= 193 * scale && y < 254 * scale));
    assert.ok(DMG_LAYOUT.app[0]! + DMG_LAYOUT.iconSize / 2 < 243);
    assert.ok(DMG_LAYOUT.applications[0]! - DMG_LAYOUT.iconSize / 2 > 294);
  }
});

test("a real headless DMG retains exact Finder geometry and portable retina artwork and rejects altered bounds", { skip: process.platform !== "darwin", timeout: 180_000 }, async () => {
  const parent = resolve(".moguri"); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "generated-dmg-layout-")), mountpoint = join(directory, "mount");
  let mounted = false;
  try {
    const app = join(directory, "Moguri.app"), image = join(directory, "generated.dmg"), version = "0.0.0-fixture";
    await mkdir(join(app, "Contents"), { recursive: true });
    await writeFile(join(app, "Contents", "Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Moguri</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
    await buildDmg(app, image, version);
    await mkdir(mountpoint);
    const attachment = await run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountpoint, "-plist", image], { timeout: 60_000, maxBuffer: 64 * 1024 });
    const details: unknown = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: attachment.stdout, encoding: "utf8" }));
    assert.ok(typeof details === "object" && details !== null && "system-entities" in details && Array.isArray(details["system-entities"]));
    assert.ok(details["system-entities"].some((entity) => typeof entity === "object" && entity !== null && "mount-point" in entity && entity["mount-point"] === mountpoint));
    mounted = true;
    const layout = await verifyDmgLayout(mountpoint, version);
    assert.equal(layout.backgroundVolume, "Moguri 0.0.0-fixture-arm64");
    assert.deepEqual((await readdir(mountpoint)).filter((name) => !name.startsWith(".")).sort(), ["Applications", "Moguri.app"]);
    const corrupt = join(directory, "corrupt"); await mkdir(corrupt);
    await copyFile(join(mountpoint, ".DS_Store"), join(corrupt, ".DS_Store"));
    const python = await prepareDmgTools();
    await run(python, ["-c", "from ds_store import DSStore; import sys\nwith DSStore.open(sys.argv[1], 'r+') as store:\n window=store['.']['bwsp']; window['WindowBounds']='{{100, 100}, {1080, 760}}'; store['.']['bwsp']=window\n", join(corrupt, ".DS_Store")], { timeout: 15_000 });
    await assert.rejects(() => verifyDmgLayout(corrupt, version), /540x380-point bounds/);
  } finally {
    if (mounted) await run("/usr/bin/hdiutil", ["detach", mountpoint], { timeout: 30_000, maxBuffer: 4096 });
    let safe = true;
    try { safe = (await stat(mountpoint)).dev === (await stat(directory)).dev; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (!safe) throw new Error("The generated DMG mount was not confirmed detached. Its exact test directory was retained.");
    await rm(directory, { recursive: true, force: true });
  }
});
