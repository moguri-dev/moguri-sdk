import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { startService } from "../../apps/service/src/server.ts";
import type { ProviderAdapter } from "../../apps/service/src/provider.ts";
import { isRecord, ThinkingEffortSchema, type StoredEvent } from "../../packages/protocol/src/index.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { GeneratedFileVault } from "./generated-vault.ts";
import { GENERATED_RETENTION_KEY } from "../fixture.ts";
import { createRemoteFrameGate } from "./remote-frame-gate.ts";
import { randomUUID } from "node:crypto";
import { githubApplicationFixture } from "../github-workflows-fixture.ts";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GeneratedIntakeClock } from "./intake-clock.ts";

const generatedModelSchema = Type.Object({
  id: Type.String(), name: Type.String(), contextWindow: Type.Integer({ minimum: 8192, maximum: 10_000_000 }),
  maxTokens: Type.Integer({ minimum: 1 }), imageInput: Type.Boolean(),
  supportedContextWindows: Type.Optional(Type.Array(Type.Integer({ minimum: 8192 }))),
  thinkingLevels: Type.Optional(Type.Array(ThinkingEffortSchema)),
  kupoThinkingLevels: Type.Optional(Type.Array(ThinkingEffortSchema)),
  kupoThinkingMinimumOutput: Type.Optional(Type.Record(Type.String({ pattern: "^(off|minimal|low|medium|high|xhigh|max)$" }), Type.Integer({ minimum: 1 }))),
}, { additionalProperties: false });

process.once("message", (raw: unknown) => {
  let release: (() => Promise<void>) | undefined;
  void (async () => {
    if (!isRecord(raw) || typeof raw.stateDir !== "string" || typeof raw.vaultPath !== "string" || typeof raw.modelId !== "string" || typeof raw.baseUrl !== "string") throw new Error("Invalid generated child bootstrap.");
    if (raw.homeRoot !== undefined && typeof raw.homeRoot !== "string") throw new Error("Invalid generated Home directory.");
    const home = raw.homeRoot ?? join(dirname(raw.stateDir), "home");
    await mkdir(home, { recursive: true, mode: 0o700 });
    const base = githubCopilotProvider().getModels().find((model) => model.id === raw.modelId);
    if (!base) throw new Error("Generated provider model is absent.");
    const metadata = raw.modelInfo === undefined ? undefined : Value.Parse(generatedModelSchema, raw.modelInfo);
    if (metadata && metadata.id !== raw.modelId) throw new Error("Generated recovery metadata lost its exact model.");
    if (raw.intakeAt !== undefined && (typeof raw.intakeAt !== "string" || !Number.isFinite(Date.parse(raw.intakeAt)))) throw new Error("Invalid generated recovery clock.");
    const clock = typeof raw.intakeAt === "string" ? new GeneratedIntakeClock(raw.intakeAt) : undefined;
    const model = { ...base, baseUrl: raw.baseUrl, ...(metadata ? { name: metadata.name, contextWindow: metadata.contextWindow, maxTokens: metadata.maxTokens } : {}) };
    const provider: ProviderAdapter = {
      state: { status: "connected", models: [metadata ?? { id: model.id, name: "Generated crash-recovery solver", contextWindow: model.contextWindow, maxTokens: model.maxTokens, imageInput: false }], login: null, diagnostic: null },
      onChange: () => {}, refresh: async () => {}, cancel: async () => {}, logout: async () => {},
      login: () => { throw new Error("Personal authorization is forbidden in generated recovery fixtures."); },
      prepare: async (id, signal) => { signal.throwIfAborted(); if (id !== model.id) throw new Error("Generated model mismatch."); return { model, auth: { apiKey: "generated-test-only", baseUrl: model.baseUrl } }; },
    };
    const vault = new GeneratedFileVault(raw.vaultPath);
    if (raw.nativeCommand !== undefined && (!Array.isArray(raw.nativeCommand) || !raw.nativeCommand.every((part) => typeof part === "string"))) throw new Error("Invalid generated native command.");
    const projectWork = raw.projectWork === true ? await githubApplicationFixture({ provider, ownedNetwork: true, retentionKey: GENERATED_RETENTION_KEY }) : null;
    const service = projectWork?.service ?? await startService({ stateDir: raw.stateDir, provider, retentionKey: GENERATED_RETENTION_KEY, platform: {
      ...(clock ? { intakeClock: clock } : {}), remote: { vault, modelsVault: vault }, ...(Array.isArray(raw.nativeCommand) ? { sandbox: { vault, command: raw.nativeCommand } } : {}), terminal: raw.rawTerminal === true ?
        { vault, defaultRoot: home, executable: process.execPath, args: ["-e", "process.stdin.setRawMode(true); process.stdin.on('data',d=>process.stdout.write(d)); process.stdout.write('GENERATED_CHILD_TERMINAL_READY\\n');"] } :
        { vault, defaultRoot: home, executable: "/bin/sh", args: ["-c", "printf 'GENERATED_CHILD_TERMINAL_READY\\n'; exec cat"] },
    } });
    release = projectWork ? projectWork.close : () => service.close();
    if (clock) process.on("message", (message: unknown) => {
      if (!isRecord(message) || message.kind !== "intake.advance") return;
      if (typeof message.ms !== "number" || !Number.isSafeInteger(message.ms) || message.ms < 0 || message.ms > 86400_000) {
        throw new Error("Invalid generated intake-clock advance.");
      }
      clock.advanceBy(message.ms); process.send?.({ kind: "intake.advanced", at: new Date(clock.now()).toISOString() });
    });
    if (raw.holdNativeResult === true) {
      const gate = createRemoteFrameGate("model.complete", (frame) => process.send?.({ kind: "held-native-model", executionId: frame?.executionId }));
      const launch = service.controller.sandbox.launch.bind(service.controller.sandbox);
      service.controller.sandbox.launch = (...args) => {
        const connection = launch(...args);
        return { ...gate.wrap(connection), acknowledge: connection.acknowledge.bind(connection), verified: connection.verified, finished: connection.finished,
          query: connection.query.bind(connection) };
      };
    }
    if (raw.holdDecisionEffect === true) {
      let held = false;
      service.controller.on("change", () => {
        const decision = service.controller.snapshot().decisions.find((record) => record.status === "ready");
        if (decision && !held) {
          held = true; process.send?.({ kind: "held-decision-effect", decisionId: decision.id });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
      });
    }
    if (raw.holdQueuedFile === true) {
      const query = service.controller.platform.managed.query.bind(service.controller.platform.managed); let held = false;
      service.controller.platform.managed.query = async (...args) => {
        const command = service.controller.snapshot().commandExecutions.find((entry) => entry.status === "running" && entry.name === "file");
        if (command && args[0].type === "session.file" && !held) { held = true; process.send?.({ kind: "held-queued-command", executionId: command.id }); await new Promise<void>(() => {}); }
        return query(...args);
      };
    }
    if (raw.holdNativePublication === "before" || raw.holdNativePublication === "after-first") {
      const assert = service.controller.platform.managed.assert.bind(service.controller.platform.managed); let held = false;
      service.controller.platform.managed.assert = async (...args) => {
        const publication = service.controller.snapshot().sandboxPublications?.find((value) => value.status === "publishing" &&
          value.publishedPaths.length === (raw.holdNativePublication === "after-first" ? 1 : 0));
        if (publication && !held) { held = true; process.send?.({ kind: "held-native-publication", publicationId: publication.id }); await new Promise<void>(() => {}); }
        return assert(...args);
      };
    }
    if (raw.holdUserPlan === "approval" || raw.holdUserPlan === "result") {
      const gate = createRemoteFrameGate(raw.holdUserPlan === "approval" ? "approval" : "user-plan.complete",
        (frame) => process.send?.({ kind: "held-user-plan", executionId: frame?.executionId }));
      const launch = service.controller.remote.launch.bind(service.controller.remote);
      service.controller.remote.launch = (...args) => gate.wrap(launch(...args));
    }
    if (raw.holdCandidateTransport === "result" || raw.holdCandidateTransport === "terminal" ||
      raw.holdCandidateTransport === "stage-result" || raw.holdCandidateTransport === "apply-terminal") {
      const gate = createRemoteFrameGate(String(raw.holdCandidateTransport).endsWith("result") ? "candidate.complete" : "finished",
        (frame) => process.send?.({ kind: "held-candidate-transport", transportId: frame?.executionId }),
        (request) => {
          if (!isRecord(request)) return false;
          if (raw.holdCandidateTransport === "result") return isRecord(request.result) && request.result.type === "created";
          if (raw.holdCandidateTransport === "stage-result") return isRecord(request.result) && request.result.type === "written" &&
            isRecord(request.result.result) && request.result.result.phase === "stage";
          return service.controller.platform.candidateEnvs.transports.records().some((record) => record.status === "running" &&
            (raw.holdCandidateTransport === "terminal" ? record.ownerKind === "workspace" :
              record.ownerKind === "candidate" && service.controller.snapshot().candidates.some((candidate) => candidate.applyIntent?.jobId === record.id)));
        });
      const launch = service.controller.remote.launch.bind(service.controller.remote);
      service.controller.remote.launch = (...args) => gate.wrap(launch(...args));
    }
    if (raw.holdUserMcp === "authorization" || raw.holdUserMcp === "result") {
      const gate = createRemoteFrameGate(raw.holdUserMcp === "authorization" ? "delegate" : "mcp.complete",
        (frame) => process.send?.({ kind: "held-user-mcp", executionId: frame?.executionId }));
      const launch = service.controller.remote.launch.bind(service.controller.remote);
      service.controller.remote.launch = (...args) => gate.wrap(launch(...args));
    }
    if (raw.holdTerminalInput === true) {
      const manager = service.controller.platform.sessions.terminals, input = manager.input.bind(manager);
      let held = false;
      manager.input = async (request) => {
        await input(request);
        if (!held && request.action === "input") {
          held = true; process.send?.({ kind: "held-terminal-input", terminalId: request.terminalId });
          await new Promise<void>(() => {});
        }
      };
    }
    if (raw.holdMemory === true) {
      const capture = service.controller.remote.captureMemory.bind(service.controller.remote);
      service.controller.remote.captureMemory = async (...args) => {
        const result = await capture(...args); process.send?.({ kind: "held-memory-source", root: args[0] });
        await new Promise<void>(() => {}); return result;
      };
    }
    if (raw.holdMemoryStream === true) {
      const connect = service.controller.remote.connect.bind(service.controller.remote);
      service.controller.remote.connect = async (...args) => {
        const connection = await connect(...args); let files = 0;
        connection.wire.on("message", (value: unknown) => {
          if (isRecord(value) && value.kind === "memory" && isRecord(value.frame) && value.frame.kind === "source.file" && ++files === 25) {
            connection.child.stdout.pause();
            process.send?.({ kind: "held-memory-source", root: "streaming" });
          }
        });
        return connection;
      };
    }
    if (typeof raw.holdCandidate === "string" && ["stage-before", "stage-after-first", "apply-before", "apply-after-first"].includes(raw.holdCandidate)) {
      const assert = service.controller.platform.managed.assert.bind(service.controller.platform.managed), phase = raw.holdCandidate.startsWith("stage") ? "staging" : "applying";
      const afterFirst = raw.holdCandidate.endsWith("after-first"); let held = false;
      service.controller.platform.managed.assert = async (...args) => {
        const candidate = service.controller.snapshot().candidates.find((candidate) => candidate.status === phase &&
          (afterFirst ? (phase === "staging" ? candidate.stagedPaths.length : candidate.appliedPaths.length) === 1 :
            (phase === "staging" ? candidate.stageAttemptedPaths?.length ?? 0 : candidate.attemptedPaths.length) === 0));
        if (!held && candidate) { held = true; process.send?.({ kind: "held-candidate", candidateId: candidate.id }); await new Promise<void>(() => {}); }
        return assert(...args);
      };
    }
    if (raw.holdGeneration === "before-admission" || raw.holdGeneration === "before-result") {
      const check = service.controller.generations.check.bind(service.controller.generations); let held = false;
      service.controller.generations.check = async (...args) => {
        const result = await check(...args);
        if (!held && (raw.holdGeneration === "before-admission" ? result.record.stepId === null : result.record.stepId !== null)) {
          held = true; process.send?.({ kind: "held-generation", generationId: result.record.id }); await new Promise<void>(() => {});
        }
        return result;
      };
    }
    if (raw.planBudgetOnStart === true) {
      let saved = false;
      service.controller.on("change", (events: StoredEvent[]) => {
        if (saved) return;
        const started = events.find((event) => event.event_type === "model.started" && event.session_id && event.turn_id);
        if (!started || !started.session_id || !started.turn_id) return;
        const session = service.controller.snapshot().sessions.find((session) => session.id === started.session_id);
        if (!session) throw new Error("Generated budget owner disappeared before reservation.");
        saved = true;
        const planned = service.controller.platform.budgets.plan(session, { id: randomUUID(), turnId: started.turn_id, modelId: model.id, providerId: model.provider, apiModelId: model.id,
          role: "checkpoint", inputEstimate: 10, maxOutputTokens: 20, authorityDigest: "a".repeat(64) });
        service.store.commit([planned.event]); service.controller.refreshProfile();
        process.send?.({ kind: "planned-budget", planId: planned.plan.id });
      });
    }
    if (raw.holdRepositoryImport === true) {
      let held = false;
      service.controller.on("change", (events: StoredEvent[]) => {
        const event = events.find((event) => event.event_type === "repository.import_recorded" && event.payload.batch.items.some((item) => item.status === "running"));
        if (!held && event?.event_type === "repository.import_recorded") {
          held = true; process.send?.({ kind: "held-repository-import", batchId: event.payload.batch.id });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
      });
    }
    process.send?.({ kind: "connection", connection: service.connection, ...(projectWork ? { projectWork: {
      directory: projectWork.directory, stateDir: projectWork.stateDir, root: projectWork.root, projectId: projectWork.projectId, sessionId: projectWork.sessionId,
    } } : {}) });
  })().catch(async (error: unknown) => {
    const diagnostic = error instanceof Error ? error.message : "Generated runtime bootstrap failed.";
    console.error(diagnostic);
    try { await release?.(); }
    catch (cleanup) { console.error("Generated runtime bootstrap cleanup is unconfirmed:", cleanup instanceof Error ? cleanup.message : cleanup); }
    process.send?.({ kind: "fixture.failed", diagnostic });
    process.exitCode = 1; process.disconnect?.();
  });
});
