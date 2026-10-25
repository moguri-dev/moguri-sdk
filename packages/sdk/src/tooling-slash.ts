import { ClientError } from "../../client/src/index.ts";
import { SessionContextSchema, SessionControlSchema, parse } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import type { SlashResult } from "./slash.ts";

export async function toolingSlash(sdk: MoguriSdk, sessionId: string, name: string, argument: string): Promise<SlashResult> {
  const result = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
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
