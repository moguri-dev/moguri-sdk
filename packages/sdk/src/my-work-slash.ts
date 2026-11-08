import { ClientError } from "../../client/src/index.ts";
import { MyWorkFiltersSchema, parse, type Session, type SlashResult } from "../../protocol/src/index.ts";
import { gitSessionScope } from "./git.ts";
import type { MoguriSdk } from "./index.ts";

export async function myWorkSlash(sdk: MoguriSdk, session: Session, argument: string, client: "desktop" | "tui" | "cli"): Promise<SlashResult> {
  const match = argument.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/), action = match?.[1] ?? "query", rest = match?.[2] ?? "";
  const parts = rest.split(/\s+/).filter(Boolean), text = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
  if (action === "query") {
    const filters = parse(MyWorkFiltersSchema, rest ? JSON.parse(rest) : {});
    return client === "cli" ? text(await sdk.myWork.query(filters)) : { kind: "client-view", name: "my-work", argument: JSON.stringify(filters) };
  }
  if (action === "status" && !rest) return text(await sdk.myWork.status());
  if (action === "refresh") {
    const admitted = await sdk.myWork.refresh(parts.length ? parts : undefined);
    return { kind: "ok", message: `Inbox refresh admitted: ${admitted.id}. Use /my-work to inspect retained observations or /my-work status for its exact lifecycle. No watch, scheduler or write was started.` };
  }
  if (action === "source" && parts.length <= 2) {
    const scope = parts[0] ? { env: "Local" as const, projectId: parts[0], ...(parts[1] ? { workspaceId: parts[1] } : {}) } : gitSessionScope(sdk, session.id);
    return text(await sdk.myWork.previewSource(scope));
  }
  if (action === "configure" && parts.length === 2 && parts[1] === "confirm-read-only") {
    const { preview } = await sdk.myWork.previewSource(gitSessionScope(sdk, session.id));
    if (preview.digest !== parts[0]) throw new ClientError("my_work_review", "The exact current Local source review changed. Run /my-work source again; no source was saved.");
    return text(await sdk.myWork.configure(preview, true));
  }
  if (action === "disable" && parts.length === 2 && /^\d+$/.test(parts[1]!)) return text(await sdk.myWork.toggle(parts[0]!, Number(parts[1]), false));
  if (action === "read" && parts.length >= 1 && parts.length <= 2) return text(await sdk.myWork.read(parts[0]!, { ...(parts[1] ? { sourceId: parts[1] } : {}) }));
  if (action === "stop" && parts.length === 1) return text(await sdk.myWork.cancel(parts[0]!));
  if (action === "inspect" && parts.length === 4 && parts[3] === "confirm-inspected") return text(await sdk.myWork.inspect(parts[0]!, Number(parts[1]), parts[2]!, true));
  if (action === "navigate" && parts.length === 2) {
    const value = await sdk.myWork.navigate(parts[0]!, parts[1]!);
    if (client === "cli") return text(value);
    if (value.navigation.sessionIds.length !== 1) throw new ClientError("my_work_session", "Choose an exact related session from /my-work when there are zero or multiple associations. No first session was guessed.");
    return { kind: "session", sessionId: value.navigation.sessionIds[0]!, side: false };
  }
  if (action === "followup" && parts.length === 2) return text(await sdk.myWork.previewFollowup(parts[0]!, parts[1]!));
  if (action === "start" && parts.length === 4 && parts[3] === "confirm-idle-session") {
    const preview = await sdk.myWork.previewFollowup(parts[0]!, parts[1]!);
    if (preview.digest !== parts[2]) throw new ClientError("my_work_review", "The exact follow-up source changed. Review it again before creating an idle session.");
    const started = await sdk.myWork.start(preview, parts[1]!, true);
    return client === "cli" ? text(started) : { kind: "session", sessionId: started.id!, side: false };
  }
  if (action === "mark-read" && parts.length === 1) return text(await sdk.myWork.markRead(parts[0]!));
  throw new ClientError("my_work_input", "Use /my-work [query FILTERS_JSON|status|refresh [SOURCE_IDS]|source [PROJECT [WORKSPACE]]|configure SHA confirm-read-only|disable SOURCE REV|read REFRESH [SOURCE]|stop REFRESH|inspect REFRESH REV INPUT_SHA confirm-inspected|navigate ITEM SOURCE|followup ITEM SOURCE|start ITEM SOURCE SHA confirm-idle-session|mark-read ITEM]. Viewing and refresh never authorize writes.");
}
