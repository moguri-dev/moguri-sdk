import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { prepareSpeech, prepareTranscribe } from "./prepare-speech.mjs";
import { buildCache, cacheImports } from "./build-cache.mjs";
import { writeThirdPartyNotices } from "./third-party-notices.mjs";
import { dirname, relative, resolve, sep } from "node:path";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const speech = await prepareSpeech(), transcribe = await prepareTranscribe();
await cp(new URL("../.native/speech", import.meta.url), "dist/native/speech", { recursive: true });
await cp(new URL("../.native/transcribe", import.meta.url), "dist/native/transcribe", { recursive: true });
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const define = { __MOGURI_BUILD_VERSION__: JSON.stringify(version) };
await buildCache();
await mkdir("dist/worker-image", { recursive: true });
for (const manifest of ["package.json", "package-lock.json"]) await cp(manifest, `dist/worker-image/${manifest}`);
const nodeSdkImports = {
  name: "moguri-node-sdk-location",
  setup(build) {
    build.onResolve({ filter: /\/packages\/sdk\/src\/node\.ts$/ }, ({ kind }) => {
      if (kind === "entry-point") return;
      // Node SDK runtime paths belong to dist/sdk, not an inlining client's import.meta.url.
      const path = relative(dirname(build.initialOptions.outfile), "dist/sdk/node.mjs").split(sep).join("/");
      return { path: path.startsWith(".") ? path : `./${path}`, external: true };
    });
  },
};
// The other entrypoints share the root bundle (which re-exports the protocol) instead of inlining their own copies,
// so clients that combine entrypoints load one MoguriSdk, protocol schema and error-class instance.
const sharedRoot = {
  name: "moguri-shared-sdk-root",
  setup(build) {
    const roots = new Set(["packages/sdk/src/index.ts", "packages/protocol/src/index.ts"].map((path) => resolve(path)));
    build.onResolve({ filter: /index\.ts$/ }, ({ kind, path, resolveDir }) =>
      kind !== "entry-point" && roots.has(resolve(resolveDir, path)) ? { path: "./index.mjs", external: true } : undefined);
  },
};
const bundle = (options) => build({ ...options, metafile: true });
const nodeBuild = { bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", define, plugins: [cacheImports, nodeSdkImports] };
const bundled = await Promise.all([
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/main.ts"], outfile: "dist/service.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/update-installer.ts"], outfile: "dist/update-installer.mjs", packages: "bundle" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/bundle-tree.ts"], outfile: "dist/update-tools.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/sandbox-distribution.ts"], outfile: "dist/sandbox-tools.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/server.ts"], outfile: "dist/runtime.mjs" }),
  // Test support sits beside the service bundles because the service resolves its workers next to itself.
  bundle({ ...nodeBuild, entryPoints: ["packages/sdk/src/testing.ts"], outfile: "dist/testing.mjs" }),
  bundle({ entryPoints: ["apps/service/src/worker.ts"], outfile: "dist/worker.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", plugins: [cacheImports] }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/mcp-worker.ts"], outfile: "dist/mcp-worker.mjs" }),
  // The Claude Agent SDK is a pinned devDependency bundled here; its optional bundled Claude binaries are stubbed out and never shipped.
  bundle({ entryPoints: ["apps/service/src/claude-agent-worker.ts"], outfile: "dist/claude-agent-worker.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "bundle",
    banner: { js: "import { createRequire as __moguriCreateRequire } from 'node:module'; const require = __moguriCreateRequire(import.meta.url);" } }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/codex-agent-worker.ts"], outfile: "dist/codex-agent-worker.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/remote-bridge.ts"], outfile: "dist/remote-bridge.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/terminal-broker.ts"], outfile: "dist/terminal-broker.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/terminal-bridge.ts"], outfile: "dist/terminal-bridge.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/document-worker.ts"], outfile: "dist/document-worker.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/data-worker.ts"], outfile: "dist/data-worker.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/playwright-worker.ts"], outfile: "dist/playwright-worker.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/speech-host.ts"], outfile: "dist/speech-host.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/service/src/transcribe-host.ts"], outfile: "dist/transcribe-host.mjs" }),
  bundle({ entryPoints: ["packages/sdk/src/index.ts"], outfile: "dist/sdk/index.mjs", bundle: true, platform: "browser", format: "esm", target: "es2024", packages: "external" }),
  bundle({ ...nodeBuild, entryPoints: ["packages/sdk/src/node.ts"], outfile: "dist/sdk/node.mjs", plugins: [...nodeBuild.plugins, sharedRoot] }),
  bundle({ ...nodeBuild, entryPoints: ["packages/sdk/src/mcp-server.ts"], outfile: "dist/sdk/mcp.mjs", plugins: [...nodeBuild.plugins, sharedRoot] }),
  bundle({ entryPoints: ["packages/sdk/src/react.ts"], outfile: "dist/sdk/react.mjs", bundle: true, platform: "browser", format: "esm", target: "es2024", packages: "external", plugins: [sharedRoot] }),
]);
const bundledIds = bundled.flatMap((result) => [
  ...Object.keys(result?.metafile?.inputs ?? {}),
  ...[result].flat().flatMap((output) => output?.output ?? []).flatMap((chunk) => chunk.moduleIds ?? Object.keys(chunk.modules ?? {})),
]);
const notices = await writeThirdPartyNotices(bundledIds, "dist/THIRD_PARTY_NOTICES.md");
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.sdk.json"], { stdio: "inherit" });
console.log(`Third-party notices: ${notices.length} bundled packages in dist/THIRD_PARTY_NOTICES.md.`);
console.log(`Built the SDK entrypoints/types, service, runtime and workers. Pinned local speech runtimes: ${speech}, ${transcribe}. No model weights downloaded.`);
