import { ClientError } from "../../client/src/index.ts";
import { activeAutomationRun, describeAutomationSchedule, describeAutomationStep, type Automation, type AutomationRun } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

const when = (value: string | null) => value ? new Date(value).toLocaleString() : "none";
const runLine = (run: AutomationRun) => `  ${run.id.slice(0, 8)} ${run.status}${run.missed ? ` (+${run.missed} missed)` : ""} ${run.trigger} ${run.localTime.replace("T", " ")}` +
  `${run.sessionId ? ` chat ${run.sessionId.slice(0, 8)}` : ""}${run.diagnostic ? ` - ${run.diagnostic}` : ""}`;
/** A readable list of automations with their next occurrence and recent runs, shared by the TUI and CLI. */
export function automationsSummary(automations: Automation[], runs: AutomationRun[], projectName: (id: string) => string = (id) => id): string {
  if (!automations.length) return "No automations. Create one with `moguri automations create WORKFLOW_FILE --project ID` (or `--no-project`) or in the desktop Automations view.";
  return automations.map((automation) => {
    const recent = runs.filter((run) => run.automationId === automation.id).slice(0, 3);
    return [`${automation.name} [${automation.id.slice(0, 8)}] ${automation.status === "active" ? "Active" : "Paused"} ${automation.projectId === null ? "without a project" : `in ${projectName(automation.projectId)}`}`,
      `  ${describeAutomationSchedule(automation.schedule)}; next ${automation.status === "active" ? when(automation.nextAt) : "paused"}`,
      `  ${automation.controls.env}, ${automation.controls.modelId ?? "no model"}, ${automation.controls.autonomy}, budget ${automation.controls.budget.kind}`,
      ...automation.steps.map((step, index) => `  ${index + 1}. ${describeAutomationStep(step)}`),
      ...recent.map(runLine)].join("\n");
  }).join("\n\n");
}
function find<T extends { id: string }>(values: T[], prefix: string | undefined, label: string): T {
  const matches = prefix ? values.filter((value) => value.id === prefix || value.id.startsWith(prefix)) : [];
  if (matches.length !== 1) throw new ClientError("automation_missing", `Give one ${label} ID or unique prefix from /automations.`);
  return matches[0]!;
}
/** Shared `/automations` handling: list, runs, enable, pause, run, stop and delete. Creation and editing use a workflow file or the desktop. */
export async function executeAutomationsCommand(sdk: MoguriSdk, argument: string): Promise<string> {
  const [action = "list", target, flag, ...rest] = argument.trim().split(/\s+/).filter(Boolean);
  const automations = sdk.automations.list(), runs = sdk.automations.runs();
  const names = (id: string) => sdk.getState().snapshot?.projects.find((project) => project.id === id)?.name ?? id;
  if (action === "list" && !target) return automationsSummary(automations, runs, names);
  if (rest.length || flag && !(action === "delete" && flag === "stop-running")) throw new ClientError("automation_command", "Use /automations list, runs ID, enable ID, pause ID, run ID, stop RUN_ID or delete ID [stop-running].");
  if (action === "runs") {
    const owner = find(automations, target, "automation"), lines = runs.filter((run) => run.automationId === owner.id).map(runLine);
    return lines.length ? lines.join("\n") : "No runs yet.";
  }
  if (action === "stop") {
    const run = find(runs.filter(activeAutomationRun), target, "active run");
    await sdk.automations.stopRun(run.id); return `Stop requested for run ${run.id.slice(0, 8)}. Later steps will not run.`;
  }
  const automation = find(automations, target, "automation");
  if (action === "enable") { await sdk.automations.enable(automation.id); return `${automation.name} is active. It runs only at its scheduled times.`; }
  if (action === "pause") { await sdk.automations.pause(automation.id); return `${automation.name} is paused. Active runs continue until they finish or you stop them.`; }
  if (action === "run") { await sdk.automations.runNow(automation.id); return `${automation.name} started in a new ${automation.projectId === null ? "project-free " : ""}chat.`; }
  if (action === "delete") { await sdk.automations.delete(automation.id, { stopRunning: flag === "stop-running" }); return `${automation.name} was deleted. Its run chats are kept.`; }
  throw new ClientError("automation_command", "Use /automations list, runs ID, enable ID, pause ID, run ID, stop RUN_ID or delete ID [stop-running].");
}
