import { readFile, lstat, realpath } from "node:fs/promises";
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import { startService } from "../../apps/service/src/server.ts";

const [directory] = process.argv.slice(2);
if (!directory || process.env.MOGURI_TEST_WINDOW !== "hidden") throw new Error("Generated private update service needs an explicit hidden fixture directory.");
const manifestBytes = await readFile(join(directory, "manifest.json")), manifest = JSON.parse(manifestBytes), archive = await readFile(join(directory, "release.zip"));
const values = new Map(), vault = { read: async (id) => values.get(id) ?? null, write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } };
const original = "https://api.github.com/repos/mbianchidev/moguri", base = "https://api.github.com/repositories/42";
const provider = { state: { status: "disconnected", models: [], login: null, diagnostic: null }, onChange: () => {}, refresh: async () => {}, logout: async () => {}, cancel: async () => {},
  login: () => { throw new Error("Personal login is forbidden in generated updater tests."); }, prepare: async () => { throw new Error("No model request is allowed in generated updater tests."); } };
const service = await startService({
  stateDir: join(directory, "state"), provider, retentionKey: Buffer.alloc(32, 0x6b), platform: { vault },
  updates: { version: "0.30.0-alpha.1", arch: "arm64", vault, installationRoot: await realpath(join(directory, "Applications", "Moguri.app")), homebrewPrefixes: [],
    installerSource: resolve("dist/update-installer.mjs"), installerRuntime: process.execPath, quarantine: async () => {},
    fetch: async (input) => {
      const url = String(input);
      if (url === original) return Response.json({ id: 42, full_name: "mbianchidev/moguri", private: true });
      if (url === `${base}/releases?per_page=10`) return Response.json([{ id: 101, tag_name: manifest.version, draft: false, prerelease: true, published_at: new Date().toISOString(),
        assets: [{ id: 201, name: `Moguri-${manifest.version}-macos-arm64.manifest.json`, size: manifestBytes.length }, { id: 202, name: manifest.archive.name, size: archive.length }] }]);
      if (url === `${base}/releases/assets/201`) return new Response(manifestBytes);
      if (url === `${base}/releases/assets/202`) return new Response(archive);
      throw new Error("Unrecognized generated update request; no external network is permitted.");
    },
  },
});
const watching = watch(join(directory, "state"), (_event, filename) => {
  if (filename !== "connection.json") return;
  void lstat(join(directory, "state", "connection.json")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    watching.close(); if (process.connected) process.disconnect();
  });
});
process.send?.({ type: "ready", connection: service.connection });
process.once("SIGTERM", () => { watching.close(); void service.close().finally(() => { if (process.connected) process.disconnect(); }); });
