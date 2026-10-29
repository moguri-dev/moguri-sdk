import { writeFileSync } from "node:fs";
const marker = process.argv.indexOf("--started-marker");
const ready = () => {
  if (marker >= 0) writeFileSync(process.argv[marker + 1], String(process.pid));
  if (process.argv.includes("--live") && !process.argv.includes("--no-ready")) process.stderr.write('[live] listening on "Generated audio device" at 16000 Hz; press Ctrl-C to stop\n');
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
  const server = createServer((request, response) => {
    if (request.url === "/ready") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ready: true, device: argument("--backend"), capabilities: ["asr"] }));
    } else if (request.url === "/v1/models") {
      if (process.argv.includes("--reject-readiness")) { response.writeHead(401).end(); return; }
      if (process.argv.includes("--redirect-readiness")) { response.writeHead(302, { Location: "https://generated-forbidden.invalid/models" }).end(); return; }
      if (request.headers.authorization !== `Bearer ${process.env.NEMO_SPEECH_HTTP_API_KEY}`) { response.writeHead(401).end(); return; }
      if (process.argv.includes("--oversized-readiness")) { response.writeHead(200).end("x".repeat(128 * 1024)); return; }
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "list",
        data: process.argv.includes("--no-asr-readiness") ? [] : [{ id: "generated-local-recognizer", object: "model", owned_by: "local", capability: "transcription", device: argument("--backend") }] }));
    } else response.writeHead(404).end();
  }), sockets = new WebSocketServer({ noServer: true });
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
  const listen = () => server.listen(port, "127.0.0.1", () => {
    ready();
    if (!process.argv.includes("--buffered-ready")) console.log(JSON.stringify({ event: "listener.ready", transport: "http", url: `http://127.0.0.1:${port}/`, capabilities: ["asr"] }));
  });
  if (process.argv.includes("--listener-delay")) setTimeout(listen, Number(argument("--listener-delay")));
  else listen();
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
