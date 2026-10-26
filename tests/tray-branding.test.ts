import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

test("the menu-bar mascot is a transparent monochrome silhouette, not the opaque application-icon square", async () => {
  const source = await readFile(new URL("../assets/moguri-tray.svg", import.meta.url), "utf8");
  const rendered = new Resvg(source).render().asPng(), { data, info } = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 22); assert.equal(info.height, 18);
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
  for (const [x, y] of [[0, 0], [21, 0], [0, 17], [21, 17]] as const) assert.equal(alpha(x, y), 0);
  let transparent = 0, visible = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) transparent++;
    else { visible++; assert.equal(data[offset], 0); assert.equal(data[offset + 1], 0); assert.equal(data[offset + 2], 0); }
  }
  assert.ok(transparent > info.width * info.height / 3); assert.ok(visible > 40);
});
