import { writeFileSync } from "node:fs";
const marker = process.argv.indexOf("--started-marker");
const ready = () => {
  if (process.argv.includes("--live") && !process.argv.includes("--no-ready")) process.stderr.write('[live] listening on "Generated audio device" at 16000 Hz; press Ctrl-C to stop\n');
  if (marker >= 0) writeFileSync(process.argv[marker + 1], String(process.pid));
};
const live = process.argv.includes("--live");
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
if (process.argv.includes("--stderr-bytes")) process.stderr.write(Buffer.alloc(Number(argument("--stderr-bytes")), "x"));
if (process.argv.includes("--unconfirmed-output")) {
  console.log("Generated unconfirmed output.");
} else if (process.argv.includes("--fail-with-diagnostic")) {
  console.error("Generated recognizer could not initialize the audio device.");
  process.exitCode = 23;
} else if (process.argv.includes("--exit-signal")) {
  console.error("Generated native capture failed.");
  process.kill(process.pid, argument("--exit-signal"));
} else if (process.argv.includes("--exit-code")) {
  console.error("Generated native model backend is unavailable.");
  process.exitCode = Number(argument("--exit-code"));
} else if (process.argv.includes("--ignore-signals")) {
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1000);
  ready();
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
  ready();
} else {
  ready();
  if (process.argv.includes("--transcribe-delay")) setTimeout(() => console.log("Generated local dictation."), Number(argument("--transcribe-delay")));
  else console.log("Generated local dictation.");
}
