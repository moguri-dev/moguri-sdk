import { ClientError } from "../../client/src/index.ts";
import {
  ROUNDUP_DEFAULT_BOTS, RoundupFiltersSchema, activeRoundupRun, describeAutomationSchedule, parse,
  type AutomationSchedule, type RoundupFilters, type RoundupResponse, type RoundupRun, type SlashResult,
} from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

/** Dependency update roundups (protocol 119, #8): read-only and model-free over configured My Work sources. */
export function createRoundupsApi(sdk: MoguriSdk) {
  const settings = () => sdk.getState().snapshot?.dependencyRoundup ?? null;
  const runs = () => sdk.getState().snapshot?.dependencyRoundupRuns ?? [];
  const run = async (runId: string) => {
    await sdk.refresh();
    const found = runs().find((value) => value.id === runId);
    if (!found) throw new ClientError("roundup_run_missing", "This roundup run is not in the connected profile.");
    return found;
  };
  return {
    settings, runs,
    /** Saves the explicit sources (My Work source IDs), update bots and optional schedule. */
    configure: (input: { sourceIds: string[]; bots?: string[]; schedule?: AutomationSchedule | null; scheduleEnabled?: boolean },
      expectedRevision: number | null = settings()?.revision ?? null) => sdk.command({ type: "dependency_roundup.configure",
      bots: input.bots ?? [...ROUNDUP_DEFAULT_BOTS], sourceIds: input.sourceIds, schedule: input.schedule ?? null,
      scheduleEnabled: input.scheduleEnabled ?? false, expectedRevision }),
    /** The schedule switch; saves immediately. */
    setSchedule: (enabled: boolean, expectedRevision?: number) => {
      const current = settings();
      if (!current) throw new ClientError("roundup_settings", "Configure dependency roundups first.");
      return sdk.command({ type: "dependency_roundup.schedule", enabled, expectedRevision: expectedRevision ?? current.revision });
    },
    refresh: (options: { timeoutMs?: number; commandId?: string } = {}) =>
      sdk.command({ type: "dependency_roundup.refresh", ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }, options.commandId),
    /** Stops only this run's own GitHub readers. */
    cancel: (runId: string) => sdk.command({ type: "dependency_roundup.cancel", runId }),
    query: (filters: RoundupFilters = {}, signal?: AbortSignal) => sdk.query({ type: "dependency_roundup.query", filters }, signal),
    run,
    wait: async (runId: string, options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {}): Promise<RoundupRun> => {
      const deadline = Date.now() + (options.timeoutMs ?? 330_000);
      for (;;) {
        options.signal?.throwIfAborted();
        const current = await run(runId);
        if (!activeRoundupRun(current)) return current;
        if (Date.now() >= deadline) throw new ClientError("roundup_wait_timeout", "The roundup is still running. This wait did not stop or replay it.");
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.pollMs ?? 100, Math.max(0, deadline - Date.now()))));
      }
    },
  };
}
export type RoundupsApi = ReturnType<typeof createRoundupsApi>;

const when = (value: string | null) => value ? new Date(value).toLocaleString() : "never";
/** A readable roundup for the TUI and CLI. */
export function roundupSummary(response: RoundupResponse): string {
  if (!response.settings) return "Dependency roundups are not configured. Configure My Work sources first, then run /roundups configure SOURCE_IDS.";
  const settings = response.settings, run = response.latestRun;
  const lines = [
    `Dependency roundup: ${response.updates.length} update PR${response.updates.length === 1 ? "" : "s"} in ${response.groups.length} group${response.groups.length === 1 ? "" : "s"}${response.complete ? "" : " (incomplete or stale; see sources)"}`,
    `Bots: ${settings.bots.join(", ")}. Schedule: ${settings.schedule ? `${describeAutomationSchedule(settings.schedule)}, ${settings.status === "active" ? `next ${when(settings.nextAt)}` : "off"}` : "manual only"}.`,
    run ? `Latest run ${run.id.slice(0, 8)}: ${run.status} (${run.trigger}) ${when(run.createdAt)}${run.diagnostic ? ` - ${run.diagnostic}` : ""}` : "No runs yet. Use /roundups refresh.",
    ...response.sources.filter((source) => source.problem).map((source) => `  Source ${source.repository ?? source.sourceId.slice(0, 12)}: ${source.problem}${source.diagnostic ? ` - ${source.diagnostic}` : ""}`),
  ];
  const updates = new Map(response.updates.map((update) => [update.itemId, update]));
  for (const group of response.groups) {
    lines.push("", `${group.name}${group.ecosystems.length ? ` (${group.ecosystems.join(", ")})` : ""}${group.versions.length ? ` -> ${group.versions.join(", ")}` : ""}` +
      `${group.security ? " [security reported]" : ""}${group.likelyBreaking ? " [likely breaking]" : ""}${group.failingChecks ? ` [${group.failingChecks} failing]` : ""}`);
    for (const id of group.itemIds) {
      const update = updates.get(id);
      if (!update) continue;
      lines.push(`  ${update.repository}#${update.number} ${update.title} (${update.state}, CI ${update.ci ?? "unknown"}, ${update.freshness}) ${update.url}`);
      if (update.security) lines.push(`    Security (from the PR): ${update.security.signals.join(", ")}${update.security.advisories.length ? `; ${update.security.advisories.map((advisory) => advisory.id).join(", ")}` : ""}`);
    }
  }
  lines.push("", "No advisory in a PR is not a statement that a package is secure. Breaking marks are a version/text heuristic. Nothing was installed, pushed or merged.");
  return lines.join("\n");
}
/** Shared `/roundups` handling across desktop, TUI and CLI. */
export async function roundupsSlash(sdk: MoguriSdk, argument: string, client: "desktop" | "tui" | "cli"): Promise<SlashResult> {
  const match = argument.trim().match(/^(\S+)?(?:\s+([\s\S]*))?$/), action = match?.[1] ?? "show", rest = match?.[2]?.trim() ?? "";
  const parts = rest.split(/\s+/).filter(Boolean);
  if (action === "show") {
    const filters = parse(RoundupFiltersSchema, rest ? JSON.parse(rest) : {});
    if (client === "desktop") return { kind: "client-view", name: "dependency-roundup", argument: JSON.stringify(filters) };
    return { kind: "text", text: roundupSummary(await sdk.roundups.query(filters)) };
  }
  if (action === "status" && !rest) return { kind: "text", text: JSON.stringify({ settings: sdk.roundups.settings(), runs: sdk.roundups.runs().slice(0, 10) }, null, 2) };
  if (action === "refresh" && !rest) {
    const admitted = await sdk.roundups.refresh();
    return { kind: "ok", message: `Roundup ${admitted.id} is reading the configured sources. Nothing is installed, pushed or merged; use /roundups to see it.` };
  }
  if (action === "stop" && parts.length === 1) {
    const run = sdk.roundups.runs().find((value) => value.id === parts[0] || value.id.startsWith(parts[0]!));
    if (!run) throw new ClientError("roundup_run_missing", "Give a roundup run ID or unique prefix from /roundups status.");
    await sdk.roundups.cancel(run.id);
    return { kind: "ok", message: `Stop requested for roundup ${run.id.slice(0, 8)}. Only its own GitHub readers stop.` };
  }
  if (action === "configure" && parts.length >= 1 && parts.length <= 2) {
    const sourceIds = parts[0]!.split(",").filter(Boolean), bots = parts[1]?.split(",").filter(Boolean);
    const current = sdk.roundups.settings();
    await sdk.roundups.configure({ sourceIds, ...(bots ? { bots } : current ? { bots: current.bots } : {}), schedule: current?.schedule ?? null,
      scheduleEnabled: current?.status === "active" });
    return { kind: "ok", message: `Roundups read ${sourceIds.length} My Work source${sourceIds.length === 1 ? "" : "s"}. Run /roundups refresh to read them now.` };
  }
  if (action === "schedule" && (parts[0] === "on" || parts[0] === "off") && parts.length === 1) {
    await sdk.roundups.setSchedule(parts[0] === "on");
    return { kind: "ok", message: parts[0] === "on" ? "Scheduled roundups are on." : "Scheduled roundups are off. A running roundup continues until it finishes or you stop it." };
  }
  throw new ClientError("roundup_input", "Use /roundups [show [FILTERS_JSON]|status|refresh|stop RUN_ID|configure SOURCE_IDS [BOTS]|schedule on|off]. Roundups are read-only and never call a model.");
}
