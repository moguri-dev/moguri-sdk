import { fileURLToPath } from "node:url";
import type { Message } from "@earendil-works/pi-ai";
import { localWorker } from "../../apps/service/src/worker-connection.ts";
import { parse } from "../../packages/protocol/src/index.ts";
import { WorkerRequestSchema, type WorkerRequest, type WorkerReply, type BoundaryReply } from "../../apps/service/src/worker-protocol.ts";
import type { PreparedModel } from "../../apps/service/src/provider.ts";
import { fixtureProvider, waitFor, type GeneratedProviderOptions } from "../fixture.ts";

export async function ownedRoleWorker(options: {
  steps?: number; phase?: BoundaryReply["phase"]; root?: string | null; readOnly?: boolean;
  first?: GeneratedProviderOptions; outputLimit?: number; accepted?: boolean; unacknowledged?: boolean;
  holdAt?: number; rejectAt?: number; slowCritic?: boolean; toolDraft?: boolean;
  admit?: (input: { index: number; stepId: string; prepared: PreparedModel; context: Message[]; systemPrompt: string; output: number }) => number | Promise<number>;
  retain?: (request: Extract<WorkerRequest, { kind: "model.complete" }>, index: number) => void | Promise<void>;
  finish?: (request: Extract<WorkerRequest, { kind: "finished" }>) => void | Promise<void>;
} = {}) {
  const providers: Awaited<ReturnType<typeof fixtureProvider>>[] = [];
  try {
    for (let index = 0; index < 3; index++) providers.push(await fixtureProvider({
      responseMode: "text", maxOutputTokens: 64, replyText: `GENERATED_OWNED_ROLE_${index}_RESULT_NOT_CONTEXT`,
      ...(index === 0 ? options.first : {}), ...(index === 0 && options.toolDraft ? { responseMode: "auto" } : {}),
    }));
  } catch (error) { for (const provider of providers) await provider.close(); throw error; }
  const worker = localWorker(process.env.MOGURI_TEST_ROLE_WORKER ?? fileURLToPath(new URL("../../apps/service/src/worker.ts", import.meta.url)), "generated-owned-role-sequence");
  const requests: WorkerRequest[] = [], completions: Extract<WorkerRequest, { kind: "model.complete" }>[] = [];
  const retentionFailures: unknown[] = [];
  const boundaries: string[] = [];
  let failure: unknown, ended = false, release: (() => void) | undefined;
  const exited = new Promise<void>((resolve) => worker.events.once("exit", () => { ended = true; resolve(); }));
  worker.events.on("error", (error) => { failure = error; worker.kill("SIGTERM"); });
  let chain = Promise.resolve();
  worker.events.on("message", (raw: unknown) => {
    chain = chain.then(async () => {
      const request = parse(WorkerRequestSchema, raw); requests.push(request);
      if (request.kind === "boundary") {
        const index = completions.length, provider = providers[index % providers.length]!;
        boundaries.push(request.stepId);
        const context: Message[] = [{ role: "user", content: options.toolDraft && index === 0 ? "generated forbidden write" :
          options.slowCritic && index === 1 ? "generated slow owned critic" : `GENERATED_HOST_CANONICAL_ROLE_${index}`, timestamp: 0 }];
        const prepared = await provider.provider.prepare(provider.modelId, AbortSignal.timeout(5000));
        const systemPrompt = "Generated owned-role protocol only. Return one tool-less result; no effects or permission.";
        const output = options.admit ? await options.admit({ index, stepId: request.stepId, prepared, context, systemPrompt, output: options.outputLimit ?? 64 }) : options.outputLimit ?? 64;
        worker.send({ kind: "reply", requestId: request.requestId, value: { ...prepared, phase: options.phase ?? "candidate",
          maxTokens: output, steers: [], context, systemPrompt,
          mode: "read-only", folders: { denied: [], readOnly: [] }, tools: [] } });
      } else if (request.kind === "model.complete") {
        const index = completions.length; completions.push(request);
        try { await options.retain?.(request, index); }
        catch (error) {
          retentionFailures.push(error);
          worker.send({ kind: "reply", requestId: request.requestId, halt: true, error: "Generated owned-role completion could not be durably retained. No next role." }); return;
        }
        const reply: WorkerReply = { kind: "reply", requestId: request.requestId,
          ...(options.rejectAt === index ? { halt: true, error: "Generated durable model-completion append failed." } :
            options.unacknowledged ? {} :
            { value: { accepted: options.accepted ?? true, ...(index + 1 < (options.steps ?? 3) ? { continue: true } : {}) } }) };
        if (options.holdAt === index) release = () => { release = undefined; worker.send(reply); };
        else worker.send(reply);
      } else if (request.kind === "finished") { await options.finish?.(request); worker.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } }); }
      else if (["approval", "delegate", "process", "output", "tool.complete"].includes(request.kind)) throw new Error("A tool-less owned role attempted an unapproved operation.");
    }).catch((error: unknown) => { failure = error; worker.kill("SIGTERM"); });
  });
  const close = async () => {
    if (!ended) worker.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); })]);
      if (!ended) { worker.kill("SIGKILL"); await exited; }
    } finally { clearTimeout(timer); for (const provider of providers) await provider.close(); }
  };
  worker.send({ kind: "start", root: options.root ?? null, context: [], readOnly: options.readOnly ?? true, env: "Local" });
  return { worker, providers, requests, completions, boundaries, retentionFailures, get held() { return release !== undefined; }, release: () => release?.(), close,
    settled: async () => {
      const terminal = await waitFor(() => { if (failure) throw failure; return requests.find((request) => request.kind === "finished"); });
      await exited; await chain; if (failure) throw failure; return terminal;
    } };
}
