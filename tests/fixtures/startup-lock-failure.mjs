import { writeFile } from "node:fs/promises";
import { join } from "node:path";

if (!process.env.MOGURI_STATE_DIR) throw new Error("The generated failed startup requires its exact state directory.");
await writeFile(join(process.env.MOGURI_STATE_DIR, "service.lock"), JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
console.error("Generated startup failed with its original writer cleanup unconfirmed.");
process.exitCode = 17;
