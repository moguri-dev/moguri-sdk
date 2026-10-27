import { writeFileSync } from "node:fs";
const marker = process.argv.indexOf("--started-marker");
const ready = () => {
  if (process.argv.includes("--live") && !process.argv.includes("--no-ready")) process.stderr.write('[live] listening on "Generated audio device" at 16000 Hz; press Ctrl-C to stop\n');
  if (marker >= 0) writeFileSync(process.argv[marker + 1], String(process.pid));
};
const live = process.argv.includes("--live");
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const transcript = process.argv.includes("--empty-transcript") ? "" : process.argv.includes("--long-transcript") ? "Generated paged local dictation. ".repeat(2000).trim() : process.argv.includes("--escaped-transcript") ? '"'.repeat(80_000) : "Generated local dictation.";
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
} else if (process.argv.includes("serve")) {
  const { createServer } = await import("node:http");
  const { WebSocketServer } = await import("ws");
  const server = createServer((_, response) => response.end("{}")), sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.headers.authorization !== `Bearer ${process.env.NEMO_SPEECH_HTTP_API_KEY}`) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, (connection) => {
      let frames = 0;
      connection.send(JSON.stringify({ type: "session.created", session: { sample_rate: 16000, input_audio_format: "pcm16" } }));
      connection.on("message", (data, binary) => {
        if (binary) {
          frames++;
          if (transcript && frames <= 2) connection.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: frames === 1 ? "Generated " : "local " }));
          return;
        }
        const event = JSON.parse(data.toString());
        if (event.type === "session.update") connection.send(JSON.stringify({ type: "session.updated" }));
        else if (event.type === "input_audio_buffer.commit") {
          const finish = () => {
            if (connection.readyState !== 1) return;
            connection.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript }));
            connection.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
          };
          if (process.argv.includes("--transcribe-delay")) setTimeout(finish, Number(argument("--transcribe-delay")));
          else finish();
        }
      });
    });
  });
  const port = Number(argument("--port"));
  server.listen(port, "127.0.0.1", () => {
    ready();
    console.log(JSON.stringify({ event: "listener.ready", transport: "http", url: `http://127.0.0.1:${port}/`, capabilities: ["asr"] }));
  });
  process.on("SIGTERM", () => { for (const socket of sockets.clients) socket.terminate(); server.close(() => process.exit(0)); });
} else if (live) {
  const hold = setInterval(() => {}, 1000);
  let finishing = false;
  process.on("SIGINT", () => {
    if (process.argv.includes("--ignore-stop")) return;
    if (finishing) { console.error("Generated duplicate stop interrupted finalization."); process.exit(9); }
    finishing = true;
    setTimeout(() => { clearInterval(hold); console.log(transcript); },
      process.argv.includes("--finalize-delay") ? Number(argument("--finalize-delay")) : 0);
  });
  ready();
} else {
  ready();
  if (process.argv.includes("--transcribe-delay")) setTimeout(() => console.log(transcript), Number(argument("--transcribe-delay")));
  else console.log(transcript);
}
