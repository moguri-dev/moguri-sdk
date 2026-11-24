import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Holds a launched service before it reaches the writer lock, as a slow shared runner can.
const stateDir = process.env.MOGURI_STATE_DIR;
if (!stateDir) throw new Error("The generated gated startup requires its explicit fixture root.");
await writeFile(join(stateDir, "generated-startup-gated.pid"), String(process.pid), { flag: "wx", mode: 0o600 });
const deadline = Date.now() + 60_000;
while (!existsSync(join(stateDir, "generated-startup-gate"))) {
  if (Date.now() > deadline) throw new Error("The generated startup gate never opened.");
  await delay(20);
}
await import("./startup-service.ts");
