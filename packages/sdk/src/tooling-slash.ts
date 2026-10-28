import { ClientError } from "../../client/src/index.ts";
import { SessionContextSchema, SessionControlSchema, parse } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import type { SlashResult } from "./slash.ts";

export async function toolingSlash(sdk: MoguriSdk, sessionId: string, name: string, argument: string): Promise<SlashResult> {
  const result = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
  if (name === "firewall") {
    const parts = argument.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length === 1 && parts[0] === "list") return result({ effective: sdk.webAllowlist.list(sessionId),
      all: sdk.webAllowlist.list(), boundary: "Local web/Agent-browser tools only, not OS filtering of approved shell scripts. Global means this profile." });
    if (parts.length === 2 && parts[0] === "remove") return result(await sdk.webAllowlist.remove(parts[1]!));
    if (parts.length === 3 && parts[0] === "add" && ["session", "project", "global"].includes(parts[1]!)) {
      const session = sdk.getState().snapshot?.sessions.find((entry) => entry.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an original session in this profile.");
      if (parts[1] === "project" && !session.projectId) throw new ClientError("web_allowlist_scope", "This session has no real project. Choose session or global; no inherited root was invented.");
      return result(await sdk.webAllowlist.add(parts[2]!, parts[1] === "session" ? { kind: "session", sessionId } :
        parts[1] === "project" && session.projectId ? { kind: "project", projectId: session.projectId } : { kind: "global" }));
    }
    throw new ClientError("firewall_arguments", "Use /firewall [list], /firewall add session|project|global HOST_ORIGIN, or /firewall remove ID.");
  }
  if (name === "home") {
    const parts = argument.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length === 1 && parts[0] === "status") return result(await sdk.workspaces.home(sessionId));
    if (parts.length === 4 && parts[0] === "acknowledge" && /^\d+$/.test(parts[2]!) && Number.isSafeInteger(Number(parts[2])) && parts[3] === "confirm-inspected") {
      await sdk.workspaces.acknowledgeHomeWriter(sessionId, parts[1]!, Number(parts[2]), true);
      return { kind: "ok", message: "Recorded actual-user inspection of that exact Home writer. This is risk acceptance, not cleanup proof, tool permission or queue resumption." };
    }
    throw new ClientError("home_arguments", "Use /home [status], or /home acknowledge WRITER_ID REVISION confirm-inspected only after inspecting its exact original files/processes.");
  }
  if (name === "tools") {
    const match = argument.match(/^(?:(\d+)(?:\s+|$))?([\s\S]*)$/)!;
    return result(await sdk.tools.catalog(sessionId, match[2] ?? "", Number(match[1] ?? 0)));
  }
  if (name === "tool") {
    const match = argument.match(/^(\S+)\s+([a-f0-9]{64})\s+([\s\S]+)$/);
    if (!match) throw new ClientError("tool_arguments", "Use /tool NAME SCHEMA_SHA ARGUMENTS_JSON. This admits an exact approved Local user job, not model-owned authority or successful execution.");
    return result(await sdk.tools.execute(sessionId, match[1]!, JSON.parse(match[3]!), match[2]!));
  }
  if (name === "tool-result") {
    const match = argument.match(/^(\S+)\s+(\S+)(?:\s+(\d+))?$/);
    if (!match) throw new ClientError("tool_arguments", "Use /tool-result STEP_ID CALL_ID [UTF8_OFFSET] in the exact retained session.");
    return result(await sdk.tools.result(sessionId, match[1]!, match[2]!, Number(match[3] ?? 0)));
  }
  if (name === "state") {
    if (!argument.trim()) throw new ClientError("state_arguments", "Use /state SELECT ... for canonical todo/memory views, not raw Moguri storage.");
    return result(await sdk.tools.state(sessionId, argument));
  }
  if (name === "watch") {
    const parts = argument.trim().split(/\s+/);
    if (parts[0] === "read" && parts[1] && parts.length <= 3 && (!parts[2] || /^\d+$/.test(parts[2]))) return result(await sdk.tools.command(sessionId, parts[1], Number(parts[2] ?? 0)));
    if (parts[0] === "acknowledge" && parts[1] && parts[2] && parts[3] === "confirm-inspected" && parts.length === 4) return result(await sdk.tools.acknowledgeCommand(sessionId, parts[1], parts[2], true));
    throw new ClientError("watch_arguments", "Use /watch read JOB_ID [UTF8_OFFSET], or /watch acknowledge JOB_ID INSPECTION_SHA confirm-inspected only after actual captured-root/process inspection.");
  }
  const split = argument.indexOf(" "), action = split < 0 ? argument : argument.slice(0, split), rest = split < 0 ? "" : argument.slice(split + 1).trim();
  if (!action || action === "list" || action === "inbox" || action === "snapshot") {
    if (rest) throw new ClientError("coordination_arguments", "Use /coordinate read INPUT_JSON for explicit cursors and selectors.");
    return result(await sdk.coordination.read(sessionId, { action: action === "inbox" ? "inbox" : action === "snapshot" ? "snapshot" : "list" }));
  }
  if (action === "read") return result(await sdk.coordination.read(sessionId, parse(SessionContextSchema, JSON.parse(rest))));
  if (action === "control") return result(await sdk.coordination.control(sessionId, parse(SessionControlSchema, JSON.parse(rest))));
  if (action === "preview" && rest && !/\s/.test(rest)) return result(await sdk.coordination.preview(sessionId, rest));
  if (action === "message") {
    const match = rest.match(/^(\S+)\s+([\s\S]+)$/);
    if (match) return result(await sdk.coordination.message(sessionId, match[1]!, match[2]!));
  }
  if (action === "grant") {
    const match = rest.match(/^(\S+)\s+([a-f0-9]{64})\s+(on|off)\s+confirm-reviewed$/);
    if (match) return result(await sdk.coordination.grant(sessionId, match[1]!, match[2]!, match[3] === "on", true));
  }
  throw new ClientError("coordination_arguments", "Use /coordinate list|inbox|snapshot, read INPUT_JSON, message TARGET TEXT, control INPUT_JSON, preview CHILD, or grant CHILD SHA on|off confirm-reviewed. Answers and approvals use their original owning APIs.");
}
