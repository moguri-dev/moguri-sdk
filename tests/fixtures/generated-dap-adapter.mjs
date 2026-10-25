import { writeFileSync } from "node:fs";
let buffer = Buffer.alloc(0), seq = 0;
const send = (value) => {
  const body = JSON.stringify({ seq: ++seq, ...value });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const at = buffer.indexOf("\r\n\r\n");
    if (at < 0) return;
    const length = Number(buffer.subarray(0, at).toString().match(/Content-Length: (\d+)/i)?.[1]);
    if (!Number.isSafeInteger(length) || length < 1 || length > 1024 * 1024) throw new Error("Invalid generated DAP framing.");
    if (buffer.length < at + 4 + length) return;
    const request = JSON.parse(buffer.subarray(at + 4, at + 4 + length).toString("utf8"));
    buffer = buffer.subarray(at + 4 + length);
    if (request.arguments?.expression === "generated never reply") continue;
    const target = process.argv[2];
    if (request.command === "disconnect" && process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(request.arguments));
    const cleanupMatches = request.command !== "disconnect" || !target || request.arguments?.terminateDebuggee === (target === "launch") && request.arguments?.suspendDebuggee === false;
    send({ type: "response", request_seq: request.seq, command: request.command, success: cleanupMatches,
      body: request.command === "threads" ? { threads: [{ id: 1, name: "Generated worker" }] } : request.command === "evaluate" ? { result: "Generated value", variablesReference: 0 } : {} });
    if (request.command === "disconnect") { process.stdin.destroy(); process.exitCode = 0; }
  }
});
