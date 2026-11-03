import { join } from "node:path";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { startService } from "../../apps/service/src/server.ts";

const stateDir = process.env.MOGURI_STATE_DIR;
if (!stateDir) throw new Error("The generated startup service requires its explicit fixture root.");
let delayMs = 0;
try {
  const value: unknown = JSON.parse(await readFile(join(stateDir, "generated-startup-delay.json"), "utf8"));
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 15000) throw new Error("Generated startup delay must be a whole number from zero to 15000 milliseconds.");
  delayMs = value;
} catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
const paths = process.env.PATH?.split(":") ?? [];
await writeFile(join(stateDir, "generated-startup-environment.json"), JSON.stringify({
  preferredPathFirst: paths[0] === "/generated/preferred-bin",
  homebrewAvailable: paths.includes("/opt/homebrew/bin"),
  usrLocalAvailable: paths.includes("/usr/local/bin"),
  ambientValueForwarded: process.env.MOGURI_GENERATED_UNFORWARDED !== undefined,
}), { mode: 0o600 });
const provider = {
  state: { status: "disconnected" as const, models: [], login: null, diagnostic: null }, onChange: () => {},
  refresh: async () => { if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs)); }, logout: async () => {}, cancel: async () => {},
  login: () => { throw new Error("Personal authorization is forbidden in generated startup checks."); },
  prepare: async () => { throw new Error("No model call is allowed in generated startup checks."); },
};
const values = new Map<string, string>(), vault = {
  read: async (id: string) => values.get(id) ?? null,
  write: async (id: string, value: string) => { values.set(id, value); },
  remove: async (id: string) => { values.delete(id); },
};
const service = await startService({ stateDir, provider, retentionKey: Buffer.alloc(32, 0x67), platform: { vault, terminal: { vault, defaultRoot: join(stateDir, "console") } } });
await appendFile(join(stateDir, "generated-startup-owners.jsonl"), JSON.stringify({ pid: service.connection.pid }) + "\n", { mode: 0o600 });
process.once("SIGTERM", () => { void service.close().catch((error: unknown) => { console.error(error); process.exitCode = 1; }); });
