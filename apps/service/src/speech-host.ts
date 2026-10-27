import { spawn } from "node:child_process";

const [executable, ...args] = process.argv.slice(2);
if (!executable) throw new Error("The private speech host needs its exact configured executable.");
const child = spawn(executable, args, { stdio: ["ignore", "inherit", "inherit"] });
let stopping = false, escalation: ReturnType<typeof setTimeout> | undefined;
const stop = () => {
  if (stopping) return;
  stopping = true; child.kill("SIGTERM");
  escalation = setTimeout(() => child.kill("SIGKILL"), 1500);
};
process.stdin.resume();
process.stdin.once("end", stop);
process.stdin.once("error", stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
child.once("error", () => { console.error("The exact pinned speech runtime could not start. No alternate executable or recognizer was used."); });
child.once("close", (code) => {
  clearTimeout(escalation);
  process.stdin.destroy();
  process.exitCode = stopping ? 0 : code !== null && code >= 0 ? code : 1;
});
