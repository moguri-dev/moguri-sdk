import { writeFileSync } from "node:fs";
const marker = process.argv.indexOf("--started-marker");
const ready = () => {
  if (marker >= 0) writeFileSync(process.argv[marker + 1], String(process.pid));
  if (process.argv.includes("--live") && !process.argv.includes("--no-ready")) process.stderr.write('[live] listening on "Generated audio device" at 16000 Hz; press Ctrl-C to stop\n');
};
const live = process.argv.includes("--live");
if (process.argv.includes("--unconfirmed-output")) {
  console.log("Generated unconfirmed output.");
} else if (process.argv.includes("--fail-with-diagnostic")) {
  console.error("Generated recognizer could not initialize the audio device.");
  process.exitCode = 23;
} else if (process.argv.includes("--ignore-signals")) {
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1000);
  ready();
  process.stdout.write(Buffer.alloc(130 * 1024, "x"));
} else if (live) {
  const hold = setInterval(() => {}, 1000);
  const delay = process.argv.indexOf("--finalize-delay");
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => { clearInterval(hold); console.log("Generated local dictation."); }, delay < 0 ? 0 : Number(process.argv[delay + 1]));
  });
  ready();
} else {
  ready();
  console.log("Generated local dictation.");
}
