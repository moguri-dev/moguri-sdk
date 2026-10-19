import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const original = await readFile("/workspace/generated.txt", "utf8");
const originalDigest = createHash("sha256").update(original).digest("hex");
const proof = { pid: process.pid, uid: process.getuid(), transport: "generated-fetch-fixture-not-network", enforcedProxy: process.env.NODE_USE_ENV_PROXY === "1" && Boolean(process.env.HTTPS_PROXY && process.env.ALL_PROXY), status: (await readFile("/proc/self/status", "utf8")).split("\n").filter((line) => /^(NoNewPrivs|Seccomp|CapEff):/.test(line)), requests: [] };
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options);
  if (request.url !== "https://generated.native.invalid/v1/chat/completions") throw new Error("Generated fixture refuses every real network destination.");
  if (request.signal.aborted) throw new DOMException("Generated fixture cancelled.", "AbortError");
  const text = await request.text();
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error("Generated provider request exceeded 16 MiB.");
  const body = JSON.parse(text);
  if (request.headers.has("authorization")) throw new Error("Generated keyless model fixture received an unexpected Authorization header.");
  const images = body.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url").map((part) => {
    if (!part.image_url.url.startsWith("data:image/png;base64,")) throw new Error("Unexpected generated image format.");
    const content = Buffer.from(part.image_url.url.slice("data:image/png;base64,".length), "base64");
    return { bytes: content.length, digest: createHash("sha256").update(content).digest("hex") };
  }) : []);
  proof.requests.push({ model: body.model, bytes: Buffer.byteLength(text), images, authorization: false });
  await writeFile("/workspace/generated-provider-proof.json", JSON.stringify(proof), { mode: 0o600 });
  const call = proof.requests.length === 1 ? { name: "read_file", arguments: { path: "generated.txt" } } :
    proof.requests.length === 2 ? { name: "write_file", arguments: { path: "generated.txt", text: "Generated real guest worker replacement.\n", expectedDigest: originalDigest } } : null;
  const chunks = [];
  const chunk = (delta, finishReason = null) => chunks.push(`data: ${JSON.stringify({ id: `generated-native-${proof.requests.length}`, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
  if (call) chunk({ role: "assistant", tool_calls: [{ index: 0, id: `generated-native-call-${proof.requests.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] });
  else chunk({ role: "assistant", content: "GENERATED_NATIVE_WORKER_MODEL_AND_TOOLS_COMPLETE" });
  chunk({}, call ? "tool_calls" : "stop");
  chunks.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\n`, "data: [DONE]\n\n");
  return new Response(chunks.join(""), { headers: { "Content-Type": "text/event-stream" } });
};
