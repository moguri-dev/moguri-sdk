import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
export const cacheRuntimeFiles = ["dist/cacache.cjs", "dist/cacache.mjs", "dist/cache-NOTICES.txt"];
export const cacheImports = {
  name: "distributed-cache",
  setup(context) {
    context.onResolve({ filter: /^cacache$/ }, () => {
      if (!context.initialOptions.outfile) throw new Error("The distributed cache needs an exact output file.");
      const path = relative(dirname(resolve(context.initialOptions.outfile)), resolve("dist/cacache.mjs")).replaceAll("\\", "/");
      return { path: path.startsWith(".") ? path : `./${path}`, external: true };
    });
  },
};
export async function buildCache() {
  const result = await build({ entryPoints: [require.resolve("cacache")], outfile: "dist/cacache.cjs",
    bundle: true, packages: "bundle", platform: "node", format: "cjs", target: "node26", metafile: true, legalComments: "inline" });
  await writeFile(cacheRuntimeFiles[1], 'import cache from "./cacache.cjs";\nexport const { get, put, rm, ls, tmp, verify, clearMemoized } = cache;\n');
  const roots = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const parts = input.replaceAll("\\", "/").split("/"), index = parts.lastIndexOf("node_modules");
    if (index >= 0) roots.add(parts.slice(0, index + (parts[index + 1]?.startsWith("@") ? 3 : 2)).join("/"));
  }
  const notices = [];
  for (const root of [...roots].sort()) {
    const metadata = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
    const licenses = (await readdir(root)).filter((name) => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name)).sort();
    if (!licenses.length) throw new Error(`Bundled cache dependency ${metadata.name} has no retained license/notice file.`);
    const texts = await Promise.all(licenses.map(async (name) => `${name}\n${await readFile(`${root}/${name}`, "utf8")}`));
    notices.push(`${metadata.name} ${metadata.version}\nDeclared license: ${metadata.license}\n${texts.join("\n")}`);
  }
  await writeFile(cacheRuntimeFiles[2], `Third-party notices for Moguri's distributed cache dependency closure.\n\n${notices.join("\n\n====================\n\n")}\n`);
}
