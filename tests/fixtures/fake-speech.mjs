import { writeFileSync } from "node:fs";
const marker = process.argv.indexOf("--started-marker");
const live = process.argv.includes("--live");
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
if (process.argv.includes("--stderr-bytes")) process.stderr.write(Buffer.alloc(Number(argument("--stderr-bytes")), "x"));
if (process.argv.includes("--exit-signal")) {
  console.error("Generated native capture failed.");
  process.kill(process.pid, argument("--exit-signal"));
} else if (process.argv.includes("--exit-code")) {
  console.error("Generated native model backend is unavailable.");
  process.exitCode = Number(argument("--exit-code"));
} else if (process.argv.includes("--ignore-signals")) {
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1000);
  process.stdout.write(Buffer.alloc(130 * 1024, "x"));
} else if (live) {
  const hold = setInterval(() => {}, 1000);
  let finishing = false;
  process.on("SIGINT", () => {
    if (process.argv.includes("--ignore-stop")) return;
    if (finishing) { console.error("Generated duplicate stop interrupted finalization."); process.exit(9); }
    finishing = true;
    setTimeout(() => { clearInterval(hold); console.log("Generated local dictation."); },
      process.argv.includes("--finalize-delay") ? Number(argument("--finalize-delay")) : 0);
  });
} else {
  console.log("Generated local dictation.");
}
if (marker >= 0) writeFileSync(process.argv[marker + 1], String(process.pid));
