import { ClientError } from "../../client/src/index.ts";
import {
  commandViewKey, terminalCommandExecution, type CommandClient, type CommandExecution, type CommandResult, type Connection,
  type QueuedCommandCommand, type QueueItem, type SlashResult, type CommandClaim, type QueueableControlCommand,
} from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import { listSlashCommands } from "./slash-catalog.ts";

export interface CommandViewContext {
  sdk: MoguriSdk; sessionId: string; clientId: string; claim: CommandClaim; execution: CommandExecution; item: QueueItem; result: SlashResult; signal: AbortSignal;
}
export interface CommandViewOutcome { outcome: "completed" | "cancelled" | "failed" | "partial"; diagnostic?: string; restoreInput?: boolean }
export type CommandViewHandler = (context: CommandViewContext) => Promise<CommandViewOutcome>;
export interface CommandClientAttachment { clientId: string; wake(): void; dispose(): Promise<void> }
type TerminalCommand = Extract<QueuedCommandCommand, { type: "slash.client.complete" | "slash.client.detach" }>;
export interface CommandClientOptions { canApply?(execution: CommandExecution): boolean; onError?(error: Error): void }
function viewOutcome(task: Promise<CommandViewOutcome>, signal: AbortSignal): Promise<CommandViewOutcome> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new ClientError("command_cancelled", "The original UI action owner ended before acknowledgement."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void task.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

export function createCommandsApi(sdk: MoguriSdk, terminal: (command: TerminalCommand, connection: Connection) => Promise<CommandResult>) {
  const attachments = new Set<CommandClientAttachment>(), attaching = new Set<Promise<CommandClientAttachment>>();
  const read = (executionId: string, signal?: AbortSignal) => sdk.query({ type: "slash.read", executionId }, signal);
  const claim = async (clientId: string, executionId: string, expectedRevision: number) => {
    const result = await sdk.command({ type: "slash.client.claim", clientId, executionId, expectedRevision });
    if (!result.commandClaim || result.commandClaim.executionId !== executionId) throw new ClientError("command_claim", "The service did not acknowledge the exact original UI claim. No action was applied.");
    return result.commandClaim;
  };
  return {
    list: (sessionId: string, signal?: AbortSignal) => listSlashCommands(sdk, sessionId, signal),
    submit: (sessionId: string, options: { client: CommandClient; expectedDraftRevision?: number; delivery?: "queue" | "steer" | "interrupt"; held?: boolean }) => {
      const session = sdk.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose the actual command session before submitting its draft.");
      return sdk.command({ type: "message.send", sessionId, expectedRevision: options.expectedDraftRevision ?? session.draft.revision,
        delivery: options.delivery ?? "queue", client: options.client, ...(options.held ? { held: true } : {}) });
    },
    restore: (sessionId: string, client: CommandClient, expectedRevision?: number, held = false) => {
      const session = sdk.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose the actual archived command owner. No replacement session was used.");
      return sdk.command({ type: "slash.restore.enqueue", sessionId, client, expectedRevision: expectedRevision ?? session.revision, ...(held ? { held: true } : {}) });
    },
    /** Queues a control change (for example `model`, `GPT_ID`) as its exact slash command; the user's draft is untouched. */
    control: (sessionId: string, name: QueueableControlCommand, argument: string, client: CommandClient = "desktop") =>
      sdk.command({ type: "slash.control.enqueue", sessionId, client, name, argument }),
    read, claim,
    complete: (clientId: string, executionId: string, expectedRevision: number, token: string, outcome: CommandViewOutcome) =>
      sdk.command({ type: "slash.client.complete", clientId, executionId, expectedRevision, token, ...outcome }),
    choose: (clientId: string, claim: CommandClaim, choice: "kanban" | "prompt") =>
      sdk.command({ type: "slash.client.choose", clientId, executionId: claim.executionId, expectedRevision: claim.revision, token: claim.token, choice }),
    detachAll: async (): Promise<void> => {
      await Promise.all([...attaching]);
      await Promise.all([...attachments].map((attachment) => attachment.dispose()));
    },
    attach: (client: CommandClient, handlers: Readonly<Record<string, CommandViewHandler>>, options: CommandClientOptions = {}): Promise<CommandClientAttachment> => {
      const opening = (async () => {
      const clientId = crypto.randomUUID(), connection = sdk.connection;
      const names = Object.keys(handlers);
      if (!names.length) throw new ClientError("command_handlers", "Register actual compatible UI handlers before attaching a command client.");
      await sdk.command({ type: "slash.client.attach", clientId, client, handlers: names });
      let closing = false, pumping = false, scheduled = false, disposal: Promise<void> | undefined;
      let active: { id: string; abort: AbortController; task: Promise<void>; handoff: boolean } | undefined;
      const report = (error: unknown) => {
        const value = error instanceof Error ? error : new Error("The original queued UI action could not be acknowledged.");
        if (options.onError) options.onError(value);
        else console.error("Queued UI action remains unconfirmed:", value.message);
      };
      const pump = async (): Promise<boolean> => {
        const candidates = sdk.getState().snapshot?.commandExecutions.filter((entry) => entry.status === "waiting-client" && entry.client === client &&
          (options.canApply?.(entry) ?? true)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) ?? [];
        for (const candidate of candidates) {
          const retained = await read(candidate.id);
          if (closing || sdk.connection !== connection || sdk.getState().status !== "connected") return false;
          if (!retained.result) throw new ClientError("command_result", "The original queued UI action has no retained result. It was not reconstructed or replayed.");
          const result = retained.result, handler = handlers[commandViewKey(result)];
          if (!handler) continue;
          let owned: CommandClaim;
          try { owned = await claim(clientId, candidate.id, retained.execution.revision); }
          catch (error) {
            if (error instanceof ClientError && ["command_revision", "command_client_busy", "command_client_incompatible"].includes(error.code)) continue;
            throw error;
          }
          const abort = new AbortController();
          const task = Promise.resolve().then(async () => {
            let outcome: CommandViewOutcome;
            try {
              abort.signal.throwIfAborted();
              if (closing || sdk.connection !== connection || !(options.canApply?.(retained.execution) ?? true)) throw new ClientError("command_client_changed", "The original UI owner changed before applying its action. No replacement view was used.");
              outcome = await viewOutcome(handler({ sdk, sessionId: retained.execution.sessionId, clientId, claim: owned,
                execution: retained.execution, item: retained.item, result, signal: abort.signal }), abort.signal);
            } catch (error) {
              report(error);
              outcome = { outcome: "partial", diagnostic: error instanceof Error ? error.message.slice(0, 4096) : "The original client action did not return an acknowledgement." };
            }
            const current = sdk.getState().snapshot?.commandExecutions.find((entry) => entry.id === candidate.id);
            if (current && terminalCommandExecution(current.status)) return;
            try { await terminal({ type: "slash.client.complete", clientId, executionId: candidate.id, expectedRevision: owned.revision, token: owned.token, ...outcome }, connection); }
            catch (error) { report(error); }
          });
          active = { id: candidate.id, abort, task, handoff: result.kind === "profile" || result.kind === "client-view" && result.name === "quit" };
          await task; active = undefined; return true;
        }
        return false;
      };
      const wake = () => {
        if (closing || pumping || scheduled || sdk.getState().status !== "connected" || sdk.connection !== connection) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false; if (closing || pumping) return;
          pumping = true;
          void pump().then((worked) => { pumping = false; if (worked) wake(); }).catch((error: unknown) => { pumping = false; report(error); });
        });
      };
      const unsubscribe = sdk.subscribe(() => {
        if (active) {
          const owner = active, current = sdk.getState().snapshot?.commandExecutions.find((entry) => entry.id === owner.id);
          if (!current || current.stopRequested || current.status !== "claimed" && current.status !== "completed" ||
            sdk.getState().status !== "connected" && !owner.handoff) owner.abort.abort(new ClientError("command_cancelled", "The original service/client claim ended. No later UI action may inherit it."));
        }
        wake();
      });
      wake();
      const attachment: CommandClientAttachment = { clientId, wake, dispose: () => {
        disposal ??= (async () => {
          closing = true; unsubscribe();
          if (active && !active.handoff) active.abort.abort(new ClientError("command_client_closed", "The original command client closed before its UI action settled."));
          await active?.task;
          await terminal({ type: "slash.client.detach", clientId }, connection);
          attachments.delete(attachment);
        })();
        return disposal;
      } };
      attachments.add(attachment);
      return attachment;
      })();
      attaching.add(opening);
      void opening.then(() => attaching.delete(opening), () => attaching.delete(opening));
      return opening;
    },
  };
}
