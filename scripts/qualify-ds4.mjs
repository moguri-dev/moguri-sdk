import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createRuntime } from "../dist/sdk/node.mjs";
import { isRecord, MoguriSdk, PROTOCOL_VERSION } from "../dist/sdk/index.mjs";

const { values } = parseArgs({ options: {
  live: { type: "boolean" },
  "base-url": { type: "string" },
  model: { type: "string" },
  "context-window": { type: "string" },
  "max-tokens": { type: "string", default: "1024" },
  tools: { type: "boolean" },
} });
if (!values.live || !values["base-url"] || !values.model || !values["context-window"]) {
  throw new Error("Explicit live inference is required: --live --base-url LOOPBACK/v1 --model EXACT_ID --context-window TOKENS [--max-tokens TOKENS] [--tools]. Start your existing ds4 server yourself; this probe never installs or starts a model.");
}
const base = new URL(values["base-url"].replace(/\/?$/, "/"));
assert.ok(base.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(base.hostname) &&
  !base.username && !base.password && !base.search && !base.hash && base.pathname === "/v1/",
  "Use an exact numeric loopback HTTP /v1 endpoint without credentials.");
const contextWindow = Number(values["context-window"]), maxTokens = Number(values["max-tokens"]);
assert.ok(Number.isSafeInteger(contextWindow) && contextWindow >= 8192 &&
  Number.isSafeInteger(maxTokens) && maxTokens >= 64 && maxTokens < contextWindow,
  "Use an explicit supported working ceiling and a smaller bounded output ceiling.");
const response = await fetch(new URL("models", base), { redirect: "error", signal: AbortSignal.timeout(5000) });
assert.equal(response.status, 200, "The exact configured ds4 catalog must respond successfully.");
assert.ok(response.body, "The exact DS4 endpoint must return a model catalog body.");
const reader = response.body.getReader(), chunks = [];
let bytes = 0;
try {
  while (true) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 256 * 1024) { await reader.cancel(); throw new Error("The DS4 catalog exceeded 256 KiB."); }
    chunks.push(part.value);
  }
} finally { reader.releaseLock(); }
const catalogue = JSON.parse(Buffer.concat(chunks).toString("utf8"));
assert.ok(isRecord(catalogue) && Array.isArray(catalogue.data), "Expect a DS4 OpenAI-style model catalog.");
const loaded = catalogue.data.find((entry) => isRecord(entry) && entry.id === values.model);
assert.ok(loaded?.owned_by === "ds4.c", "The explicit model must be advertised by this DS4 endpoint.");
assert.ok(Number.isSafeInteger(loaded.context_length) && contextWindow <= loaded.context_length,
  "The requested working ceiling cannot exceed the server's observed allocation.");
assert.ok(isRecord(loaded.architecture) && Array.isArray(loaded.architecture.input_modalities) &&
  loaded.architecture.input_modalities.includes("text") && Array.isArray(loaded.architecture.output_modalities) &&
  loaded.architecture.output_modalities.includes("text") && Array.isArray(loaded.supported_parameters) &&
  loaded.supported_parameters.includes("stream"), "The exact endpoint must declare streamed text.");
if (values.tools) assert.ok(loaded.supported_parameters?.includes("tools"), "This endpoint does not declare tools.");

const workerSha256 = createHash("sha256").update(await readFile(new URL("../dist/worker.mjs", import.meta.url))).digest("hex");
const moguriVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const directory = await mkdtemp(join(tmpdir(), "moguri-ds4-qualification-"));
const home = join(directory, "home"), project = join(directory, "generated-project");
const vault = { read: async () => null, write: async () => { throw new Error("This generated probe has no credentials."); },
  remove: async () => {} };
const provider = {
  state: { status: "disconnected", models: [], diagnostic: "Live DS4-only generated qualification; no hosted account." },
  onChange: () => {},
  refresh: async () => {},
  login: () => { throw new Error("Hosted authorization is forbidden in this probe."); },
  cancel: async () => {}, logout: async () => {}, close: async () => {},
  prepare: async () => { throw new Error("Provider substitution is forbidden in this probe."); },
};
const program = async () => { throw new Error("Personal GitHub and external integration programs are forbidden in this generated probe."); };
let runtime, sdk, failure;
const report = { kind: "live-ds4-moguri-qualification", observedAt: new Date().toISOString(),
  moguriVersion,
  protocolVersion: PROTOCOL_VERSION, node: process.version,
  workerSha256,
  endpoint: base.href, loadedModel: loaded, workingContextWindow: contextWindow, outputCeiling: maxTokens,
  results: [], cleanup: "unconfirmed",
  limitations: "Generated task context only. No model-quality, natural maximum context, hardware capacity, billed-cost, Remote or Sandbox qualification. Server ownership/cleanup is the caller's responsibility." };

try {
  await mkdir(home, { mode: 0o700 });
  await mkdir(project, { mode: 0o700 });
  runtime = await createRuntime({ stateDir: join(directory, "state"), provider, retentionKey: randomBytes(32),
    platform: { models: { vault }, terminal: { defaultRoot: home, vault }, integrations: { program }, github: { runProgram: program } } });
  sdk = await new MoguriSdk(runtime.connection).ready();
  const settings = sdk.settings.get();
  await sdk.settings.update({ ...settings.values,
    systemPrompt: "This is a generated Moguri compatibility lab. Follow the user's exact output and file instructions. Never access other files, credentials, programs, networks or repositories.",
    chatTitles: { enabled: false, modelId: null },
    localModels: [{ id: "ds4-qualification", name: "Explicit live DS4 qualification", enabled: true, baseUrl: base.href, auth: "none",
      models: [{ id: values.model, name: "Explicit installed DS4 model", contextWindow, maxTokens, imageInput: false, toolInput: false }] }],
  }, settings.revision, true);
  await sdk.models.refresh();
  const model = sdk.getState().snapshot.provider.models.find((candidate) => candidate.source === "local" && candidate.apiModelId === values.model);
  assert.ok(model, "Only the exact configured and advertised local model can be selected.");
  const added = await sdk.projects.add(project);
  const created = await sdk.sessions.create(added.id, "Generated live DS4 lab", { env: "Local", modelId: model.id, autonomy: "Manual" });
  const sessionId = created.id;
  const current = () => runtime.controller.snapshot().sessions.find((session) => session.id === sessionId);
  const events = (after) => runtime.controller.events(after).filter((event) => event.session_id === sessionId);
  const until = async (read, timeout = 150_000) => {
    const deadline = Date.now() + timeout;
    do {
      const value = await read(); if (value) return value;
      await sleep(25);
    } while (Date.now() < deadline);
    throw new Error("The exact owned live turn did not settle before its observation deadline.");
  };
  const begin = async (text) => {
    const after = runtime.controller.events(0).at(-1)?.seq ?? 0;
    const saved = await sdk.command({ type: "draft.save", sessionId, expectedRevision: current().draft.revision, text, attachments: [] });
    assert.ok(Number.isSafeInteger(saved.revision));
    await sdk.command({ type: "message.send", sessionId, expectedRevision: saved.revision, delivery: "queue" });
    return after;
  };
  const turn = async (label, text, approveWrite = false) => {
    const started = performance.now(), after = await begin(text);
    let writeApproved = false;
    const finished = await until(async () => {
      const approval = current().pendingApproval;
      if (approval) {
        const allowed = approveWrite && !writeApproved && approval.call.name === "write_file" &&
          approval.call.arguments.path === "ds4-generated.txt" &&
          approval.call.arguments.text === "MOGURI_DS4_FILE_READY\n" &&
          approval.call.arguments.expectedDigest === "absent";
        if (!allowed) throw new Error(`Unexpected tool approval ${approval.call.name}; no permission granted.`);
        writeApproved = true;
        await sdk.command({ type: "approval.respond", sessionId, approvalId: approval.id, allow: true });
      }
      return events(after).find((event) => event.event_type === "turn.finished");
    }, approveWrite ? 375_000 : 150_000);
    const usage = events(after).filter((event) => event.event_type === "model.completed" && event.turn_id === finished.turn_id).map((event) => event.payload.usage);
    const deltas = events(after).filter((event) => event.event_type === "assistant.delta" && event.turn_id === finished.turn_id);
    const assistant = current().messages.filter((message) => message.turnId === finished.turn_id && message.role === "assistant").map((message) => message.text).join("");
    report.results.push({ label, outcome: finished.payload.outcome, diagnostic: finished.payload.diagnostic,
      elapsedMs: performance.now() - started, env: current().controls.env, visibleStreamDeltas: deltas.length, text: assistant, usage });
    assert.equal(finished.payload.outcome, "completed", `${label}: ${finished.payload.diagnostic}`);
    if (approveWrite) assert.equal(writeApproved, true, "Require an actual inspected one-use file approval, not a model's claim.");
    assert.ok(usage.length && usage.every((entry) => entry.modelId === model.id && entry.apiModelId === values.model &&
      entry.source === "local" && entry.providerId === "local.ds4-qualification" && current().controls.env === "Local" && entry.billedUsd === null),
      "Retain the actual local model, Env and accounting provenance without substitution or invented billing.");
    const completions = events(after).filter((event) => event.event_type === "model.completed");
    assert.ok(deltas.length && deltas.every((delta) => delta.seq < completions.at(-1).seq),
      "Observe actual visible output through the event stream before model completion; short answers may be one server chunk.");
    return assistant.trim();
  };

  assert.equal(await turn("streamed ordinary turn", "Reply with exactly MOGURI_DS4_READY. No other visible text."), "MOGURI_DS4_READY");
  assert.equal(await turn("ordinary history follow-up", "What exact marker did you return in the preceding response? Repeat only that marker."), "MOGURI_DS4_READY");
  await sdk.refresh();
  await assert.rejects(() => sdk.sessions.configure(sessionId, { ...current().controls, modelOptions: { thinkingEffort: "low" } }), /not supported/i);
  const exactWindow = contextWindow - 1;
  await sdk.sessions.configure(sessionId, { ...current().controls, modelOptions: { contextWindow: exactWindow } });
  assert.equal(current().controls.modelOptions.contextWindow, exactWindow);
  report.results.push({ label: "shared controls", exactWorkingWindow: exactWindow, thinking: "Unsupported override explicitly rejected; the generic local adapter leaves DS4 thinking server-controlled." });

  if (values.tools) {
    const configured = sdk.settings.get();
    await sdk.settings.update({ ...configured.values, localModels: configured.values.localModels.map((endpoint) => ({
      ...endpoint, models: endpoint.models.map((entry) => ({ ...entry, toolInput: true })),
    })) }, configured.revision);
    await sdk.models.refresh();
    await turn("explicit approved generated-file tool round trip",
      "Create one generated file using write_file (discover that tool if needed): path ds4-generated.txt, text MOGURI_DS4_FILE_READY followed by one newline, expectedDigest absent. Do not run commands or touch any other path. After the approved tool result, reply only MOGURI_DS4_FILE_READY.", true);
    assert.equal(await readFile(join(project, "ds4-generated.txt"), "utf8"), "MOGURI_DS4_FILE_READY\n");
  }
  const cancelAfter = await begin("Generate a very long numbered explanation of a fictional generated counting algorithm. Continue for at least 100 paragraphs.");
  await until(() => events(cancelAfter).some((event) => event.event_type === "model.started"));
  await sleep(1500);
  const stoppedAt = performance.now();
  await sdk.command({ type: "session.stop", sessionId });
  const stopped = await until(() => events(cancelAfter).find((event) => event.event_type === "turn.finished"), 15_000);
  assert.equal(stopped.payload.outcome, "stopped", "A cancelled local turn must never be reported completed.");
  report.results.push({ label: "live cancellation", outcome: stopped.payload.outcome, elapsedMs: performance.now() - stoppedAt,
    usage: events(cancelAfter).filter((event) => event.event_type === "model.completed" && event.turn_id === stopped.turn_id).map((event) => event.payload.usage) });
} catch (error) {
  failure = error;
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  sdk?.disconnect();
  try {
    await runtime?.close();
    await rm(directory, { recursive: true });
    report.cleanup = "All probe-owned Moguri state, generated files and workers removed; the caller-owned DS4 server was not stopped.";
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], "Live qualification and cleanup both failed.") : error;
    report.cleanup = "Unconfirmed: generated state retained. Inspect the original probe; do not infer teardown.";
  }
}
console.log(JSON.stringify(report, null, 2));
if (failure) throw failure;
