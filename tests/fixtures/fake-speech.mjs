import { writeFileSync } from "node:fs";
const marker = process.argv.indexOf("--started-marker");
if (marker >= 0) writeFileSync(process.argv[marker + 1], String(process.pid));
const live = process.argv.includes("--live");
if (process.argv.includes("--ignore-signals")) {
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1000);
  process.stdout.write(Buffer.alloc(130 * 1024, "x"));
} else if (live) {
  const hold = setInterval(() => {}, 1000);
  process.on("SIGINT", () => { clearInterval(hold); console.log("Generated local dictation."); });
} else {
  console.log("Generated local dictation.");
}
