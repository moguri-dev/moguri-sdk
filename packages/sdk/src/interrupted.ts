import { ClientError } from "../../client/src/index.ts";
import { describeInterruption, interruptedSessions, type Session } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

const sessionTitle = (session: Session) => session.titleSource === "factory" ? "New session" : session.title;
const line = (session: Session) => `${session.id.slice(0, 8)} ${sessionTitle(session)}: ${describeInterruption(session.interruption!)}`;
/** A readable list of chats a quit, restart or crash interrupted, shared by the TUI and CLI. */
export function interruptedSummary(sessions: readonly Session[], always: boolean): string {
  const interrupted = interruptedSessions(sessions);
  if (!interrupted.length) return `No interrupted chats. After a restart Moguri ${always ? "continues them automatically" : "asks before continuing them"}.`;
  return [`${interrupted.length} interrupted chat${interrupted.length === 1 ? "" : "s"}:`, ...interrupted.map(line),
    "Use /interrupted continue ID, continue all, dismiss ID, or always to continue all automatically after future restarts."].join("\n");
}
/** Shared `/interrupted` and `moguri interrupted` handling: list, continue ID|all, dismiss ID, always, ask. */
export async function executeInterruptedCommand(sdk: MoguriSdk, argument: string): Promise<string> {
  const [action = "list", target, ...rest] = argument.trim().split(/\s+/).filter(Boolean);
  const sessions = sdk.getState().snapshot?.sessions ?? [], settings = sdk.settings.get();
  const always = settings?.values.interactions.continueInterrupted === "always";
  if (rest.length) throw new ClientError("interrupted_command", "Use /interrupted list, continue ID, continue all, dismiss ID, always or ask.");
  if (action === "list" && !target) return interruptedSummary(sessions, always);
  if ((action === "always" || action === "ask") && !target) {
    if (!settings) throw new ClientError("settings_unavailable", "Reconnect this profile before changing the restart setting.");
    await sdk.settings.update({ ...settings.values, interactions: { ...settings.values.interactions, continueInterrupted: action } }, settings.revision);
    return action === "always" ? "After a restart Moguri continues interrupted chats automatically." : "After a restart Moguri asks before continuing interrupted chats.";
  }
  if (action === "continue" && target === "all") {
    const results = await sdk.sessions.continueAllInterrupted(), failed = results.filter((result) => result.error);
    return [`Continued ${results.length - failed.length} of ${results.length} interrupted chats.`, ...failed.map((result) => `${result.sessionId.slice(0, 8)}: ${result.error}`)].join("\n");
  }
  const matches = target ? interruptedSessions(sessions).filter((session) => session.id === target || session.id.startsWith(target)) : [];
  if (matches.length !== 1 || !["continue", "dismiss"].includes(action)) throw new ClientError("interrupted_command", "Give one interrupted chat ID or unique prefix from /interrupted, or use continue all.");
  const session = matches[0]!;
  if (action === "continue") { await sdk.sessions.continueInterrupted(session.id); return `Continued ${sessionTitle(session)}.`; }
  await sdk.sessions.dismissInterruption(session.id);
  return `Dismissed the interruption in ${sessionTitle(session)}. Its held prompts stay held.`;
}
