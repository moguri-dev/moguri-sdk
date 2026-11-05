import { fork } from "node:child_process";
import { resolve } from "node:path";
import { isRecord, type Connection, type ModelInfo } from "../../packages/protocol/src/index.ts";

export async function launchRuntimeChild(input: { stateDir: string; vaultPath: string; modelId: string; baseUrl: string; homeRoot?: string; modelInfo?: ModelInfo; intakeAt?: string; projectWork?: boolean; nativeCommand?: string[]; holdRepositoryImport?: boolean; holdNativeResult?: boolean; holdDecisionEffect?: boolean; holdQueuedFile?: boolean; holdNativePublication?: "before" | "after-first"; holdUserPlan?: "approval" | "result"; holdUserMcp?: "authorization" | "result"; holdTerminalInput?: boolean; rawTerminal?: boolean; holdMemory?: boolean; holdMemoryStream?: boolean; planBudgetOnStart?: boolean; holdGeneration?: "before-admission" | "before-result"; holdCandidate?: "stage-before" | "stage-after-first" | "apply-before" | "apply-after-first" }) {
  const child = fork(resolve("tests/fixtures/runtime-child.ts"), [], { execPath: process.execPath, execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let heldExecution: string | null = null;
  let heldDecisionId: string | null = null;
  let heldTerminalInput: string | null = null;
  let heldMemoryRoot: string | null = null;
  let heldCandidateId: string | null = null;
  let plannedBudgetId: string | null = null;
  let heldGenerationId: string | null = null;
  let heldNativePublicationId: string | null = null;
  let heldQueuedCommandId: string | null = null;
  let heldRepositoryImportId: string | null = null;
  let intakeInstant: string | null = null;
  let projectWorkFixture: { directory: string; stateDir: string; root: string; projectId: string; sessionId: string } | null = null;
  child.on("message", (raw: unknown) => {
    if (!isRecord(raw)) return;
    if (["held-user-plan", "held-user-mcp", "held-native-model"].includes(String(raw.kind)) && typeof raw.executionId === "string") heldExecution = raw.executionId;
    if (raw.kind === "held-decision-effect" && typeof raw.decisionId === "string") heldDecisionId = raw.decisionId;
    if (raw.kind === "held-terminal-input" && typeof raw.terminalId === "string") heldTerminalInput = raw.terminalId;
    if (raw.kind === "held-memory-source" && typeof raw.root === "string") heldMemoryRoot = raw.root;
    if (raw.kind === "held-candidate" && typeof raw.candidateId === "string") heldCandidateId = raw.candidateId;
    if (raw.kind === "planned-budget" && typeof raw.planId === "string") plannedBudgetId = raw.planId;
    if (raw.kind === "held-generation" && typeof raw.generationId === "string") heldGenerationId = raw.generationId;
    if (raw.kind === "held-native-publication" && typeof raw.publicationId === "string") heldNativePublicationId = raw.publicationId;
    if (raw.kind === "held-queued-command" && typeof raw.executionId === "string") heldQueuedCommandId = raw.executionId;
    if (raw.kind === "held-repository-import" && typeof raw.batchId === "string") heldRepositoryImportId = raw.batchId;
    if (raw.kind === "intake.advanced" && typeof raw.at === "string") intakeInstant = raw.at;
  });
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } };
  try {
    const ready = new Promise<Connection>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Generated child runtime did not start.")), 8000);
      child.once("error", reject);
      child.once("message", (raw: unknown) => {
        clearTimeout(deadline);
        if (!isRecord(raw) || !isRecord(raw.connection)) { reject(new Error("Invalid generated runtime connection.")); return; }
        const value = raw.connection;
        if (typeof value.protocolVersion !== "number" || typeof value.baseUrl !== "string" || typeof value.wsUrl !== "string" || typeof value.token !== "string" || typeof value.pid !== "number") { reject(new Error("Incomplete generated connection.")); return; }
        if (isRecord(raw.projectWork) && typeof raw.projectWork.directory === "string" && typeof raw.projectWork.stateDir === "string" &&
          typeof raw.projectWork.root === "string" && typeof raw.projectWork.projectId === "string" && typeof raw.projectWork.sessionId === "string") {
          projectWorkFixture = { directory: raw.projectWork.directory, stateDir: raw.projectWork.stateDir, root: raw.projectWork.root,
            projectId: raw.projectWork.projectId, sessionId: raw.projectWork.sessionId };
        }
        resolve({ protocolVersion: value.protocolVersion, baseUrl: value.baseUrl, wsUrl: value.wsUrl, token: value.token, pid: value.pid });
      });
    });
    child.send(input);
    return { child, exited, connection: await ready, get projectWorkFixture() { return projectWorkFixture; }, get heldExecution() { return heldExecution; }, get heldDecisionId() { return heldDecisionId; }, get heldTerminalInput() { return heldTerminalInput; }, get heldMemoryRoot() { return heldMemoryRoot; }, get heldCandidateId() { return heldCandidateId; }, get plannedBudgetId() { return plannedBudgetId; }, get heldGenerationId() { return heldGenerationId; }, get heldNativePublicationId() { return heldNativePublicationId; }, get heldQueuedCommandId() { return heldQueuedCommandId; }, get heldRepositoryImportId() { return heldRepositoryImportId; }, get intakeInstant() { return intakeInstant; }, stop };
  } catch (error) { await stop(); throw error; }
}
