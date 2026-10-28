import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { startService } from "../../apps/service/src/server.ts";

const stateDir = process.env.MOGURI_STATE_DIR;
if (!stateDir) throw new Error("The generated startup service requires its explicit fixture root.");
const paths = process.env.PATH?.split(":") ?? [];
await writeFile(join(stateDir, "generated-startup-environment.json"), JSON.stringify({
  preferredPathFirst: paths[0] === "/generated/preferred-bin",
  homebrewAvailable: paths.includes("/opt/homebrew/bin"),
  usrLocalAvailable: paths.includes("/usr/local/bin"),
  ambientValueForwarded: process.env.MOGURI_GENERATED_UNFORWARDED !== undefined,
}), { mode: 0o600 });
const provider = {
  state: { status: "disconnected" as const, models: [], login: null, diagnostic: null }, onChange: () => {},
  refresh: async () => {}, logout: async () => {}, cancel: async () => {},
  login: () => { throw new Error("Personal authorization is forbidden in generated startup checks."); },
  prepare: async () => { throw new Error("No model call is allowed in generated startup checks."); },
};
const values = new Map<string, string>(), vault = {
  read: async (id: string) => values.get(id) ?? null,
  write: async (id: string, value: string) => { values.set(id, value); },
  remove: async (id: string) => { values.delete(id); },
};
const service = await startService({ stateDir, provider, retentionKey: Buffer.alloc(32, 0x67), platform: { vault, terminal: { vault, defaultRoot: join(stateDir, "console") } } });
process.once("SIGTERM", () => { void service.close().catch((error: unknown) => { console.error(error); process.exitCode = 1; }); });
