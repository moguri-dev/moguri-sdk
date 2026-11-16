// Generated transcribe.cpp host speaking the private JSON-lines protocol. It never loads weights or opens a microphone.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const flag = (name) => process.argv.includes(name);
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
if (flag("--started-marker")) writeFileSync(argument("--started-marker"), `${process.pid}\n`, { flag: "a" });
let loaded = false, streaming = false, frames = 0;
const describe = (path) => {
  const whisper = readFileSync(path).includes("whisper");
  return { architecture: whisper ? "whisper" : "moonshine_streaming", variant: "generated", backend: "CPU", sampleRate: 16000, streaming: !whisper, languages: ["en"] };
};
const handle = (request) => {
  switch (request.op) {
    case "probe": return describe(request.path);
    case "load": {
      if (flag("--fail-load")) throw new Error("Generated recognizer could not load this model.");
      const info = describe(request.path);
      if (!info.streaming) throw new Error("This model cannot stream 16-kHz live dictation. No other model was loaded.");
      loaded = true; return info;
    }
    case "begin": if (!loaded) throw new Error("Load first."); streaming = true; frames = 0; return {};
    case "feed":
      if (!streaming) throw new Error("No active stream.");
      if (flag("--crash-on-feed")) process.exit(9);
      frames++; return { text: frames === 1 ? "Generated" : "Generated transcribe" };
    case "finish": streaming = false; return { text: flag("--empty-transcript") ? "" : "Generated transcribe dictation." };
    case "reset": streaming = false; return {};
    default: throw new Error("Unsupported private transcribe request.");
  }
};
createInterface({ input: process.stdin }).on("line", (line) => {
  let reply;
  try { reply = { ok: true, ...handle(JSON.parse(line)) }; } catch (error) { reply = { ok: false, error: error.message }; }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}).once("close", () => process.exit(0));
