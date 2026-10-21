import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { startService } from "../../apps/service/src/server.ts";
import type { ProviderAdapter } from "../../apps/service/src/provider.ts";
import { isRecord } from "../../packages/protocol/src/index.ts";
import { GeneratedFileVault } from "./generated-vault.ts";
import { GENERATED_RETENTION_KEY } from "../fixture.ts";
import { createRemoteFrameGate } from "./remote-frame-gate.ts";

process.once("message", (raw: unknown) => {
  void (async () => {
    if (!isRecord(raw) || typeof raw.stateDir !== "string" || typeof raw.vaultPath !== "string" || typeof raw.modelId !== "string" || typeof raw.baseUrl !== "string") throw new Error("Invalid generated child bootstrap.");
    const base = githubCopilotProvider().getModels().find((model) => model.id === raw.modelId);
    if (!base) throw new Error("Generated provider model is absent.");
    const model = { ...base, baseUrl: raw.baseUrl };
    const provider: ProviderAdapter = {
      state: { status: "connected", models: [{ id: model.id, name: "Generated crash-recovery solver", contextWindow: model.contextWindow, imageInput: false }], login: null, diagnostic: null },
      onChange: () => {}, refresh: async () => {}, cancel: async () => {}, logout: async () => {},
      login: () => { throw new Error("Personal authorization is forbidden in generated recovery fixtures."); },
      prepare: async (id, signal) => { signal.throwIfAborted(); if (id !== model.id) throw new Error("Generated model mismatch."); return { model, auth: { apiKey: "generated-test-only", baseUrl: model.baseUrl } }; },
    };
    const vault = new GeneratedFileVault(raw.vaultPath);
    const service = await startService({ stateDir: raw.stateDir, provider, retentionKey: GENERATED_RETENTION_KEY, platform: {
      remote: { vault, modelsVault: vault }, terminal: raw.rawTerminal === true ?
        { vault, executable: process.execPath, args: ["-e", "process.stdin.setRawMode(true); process.stdin.on('data',d=>process.stdout.write(d)); process.stdout.write('GENERATED_CHILD_TERMINAL_READY\\n');"] } :
        { vault, executable: "/bin/sh", args: ["-c", "printf 'GENERATED_CHILD_TERMINAL_READY\\n'; exec cat"] },
    } });
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
    process.send?.({ kind: "connection", connection: service.connection });
  })().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Generated runtime bootstrap failed."); process.exitCode = 1; process.disconnect?.(); });
});
