import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { startService } from "../../apps/service/src/server.ts";
import type { ProviderAdapter } from "../../apps/service/src/provider.ts";
import { isRecord, type StoredEvent } from "../../packages/protocol/src/index.ts";
import { GeneratedFileVault } from "./generated-vault.ts";
import { GENERATED_RETENTION_KEY } from "../fixture.ts";
import { createRemoteFrameGate } from "./remote-frame-gate.ts";
import { randomUUID } from "node:crypto";

process.once("message", (raw: unknown) => {
  void (async () => {
    if (!isRecord(raw) || typeof raw.stateDir !== "string" || typeof raw.vaultPath !== "string" || typeof raw.modelId !== "string" || typeof raw.baseUrl !== "string") throw new Error("Invalid generated child bootstrap.");
    const base = githubCopilotProvider().getModels().find((model) => model.id === raw.modelId);
    if (!base) throw new Error("Generated provider model is absent.");
    const model = { ...base, baseUrl: raw.baseUrl };
    const provider: ProviderAdapter = {
      state: { status: "connected", models: [{ id: model.id, name: "Generated crash-recovery solver", contextWindow: model.contextWindow, maxTokens: model.maxTokens, imageInput: false }], login: null, diagnostic: null },
      onChange: () => {}, refresh: async () => {}, cancel: async () => {}, logout: async () => {},
      login: () => { throw new Error("Personal authorization is forbidden in generated recovery fixtures."); },
      prepare: async (id, signal) => { signal.throwIfAborted(); if (id !== model.id) throw new Error("Generated model mismatch."); return { model, auth: { apiKey: "generated-test-only", baseUrl: model.baseUrl } }; },
    };
    const vault = new GeneratedFileVault(raw.vaultPath);
    if (raw.nativeCommand !== undefined && (!Array.isArray(raw.nativeCommand) || !raw.nativeCommand.every((part) => typeof part === "string"))) throw new Error("Invalid generated native command.");
    const service = await startService({ stateDir: raw.stateDir, provider, retentionKey: GENERATED_RETENTION_KEY, platform: {
      remote: { vault, modelsVault: vault }, ...(Array.isArray(raw.nativeCommand) ? { sandbox: { vault, command: raw.nativeCommand } } : {}), terminal: raw.rawTerminal === true ?
        { vault, executable: process.execPath, args: ["-e", "process.stdin.setRawMode(true); process.stdin.on('data',d=>process.stdout.write(d)); process.stdout.write('GENERATED_CHILD_TERMINAL_READY\\n');"] } :
        { vault, executable: "/bin/sh", args: ["-c", "printf 'GENERATED_CHILD_TERMINAL_READY\\n'; exec cat"] },
    } });
    if (raw.holdNativeResult === true) {
      const gate = createRemoteFrameGate("model.complete", (frame) => process.send?.({ kind: "held-native-model", executionId: frame?.executionId }));
      const launch = service.controller.sandbox.launch.bind(service.controller.sandbox);
      service.controller.sandbox.launch = (...args) => {
        const connection = launch(...args);
        return { ...gate.wrap(connection), acknowledge: connection.acknowledge.bind(connection), verified: connection.verified, finished: connection.finished,
          query: connection.query.bind(connection) };
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
    process.send?.({ kind: "connection", connection: service.connection });
  })().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Generated runtime bootstrap failed."); process.exitCode = 1; process.disconnect?.(); });
});
