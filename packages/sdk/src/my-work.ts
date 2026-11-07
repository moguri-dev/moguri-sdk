import type { MoguriSdk } from "./index.ts";
import { ClientError } from "../../client/src/index.ts";
import type { GithubScope, MyWorkFilters, MyWorkSourcePreview, MyWorkResponse } from "../../protocol/src/index.ts";

export function createMyWorkApi(sdk: MoguriSdk) {
  const read = (refreshId: string, options: { sourceId?: string; metadataOnly?: boolean; signal?: AbortSignal } = {}) =>
    sdk.query({ type: "my_work.read", refreshId, ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      ...(options.metadataOnly !== undefined ? { metadataOnly: options.metadataOnly } : {}) }, options.signal);
  return {
    previewSource: (scope: GithubScope, signal?: AbortSignal) => sdk.query({ type: "my_work.source.preview", scope }, signal),
    configure: (preview: MyWorkSourcePreview, confirm: true, commandId?: string) => sdk.command({
      type: "my_work.configure", scope: { env: "Local", projectId: preview.source.binding.projectId,
        ...(preview.source.binding.workspaceId ? { workspaceId: preview.source.binding.workspaceId } : {}) },
      expectedDigest: preview.digest, expectedRevision: preview.expectedRevision, confirm,
    }, commandId),
    toggle: (sourceId: string, expectedRevision: number, enabled: boolean) =>
      sdk.command({ type: "my_work.source.toggle", sourceId, expectedRevision, enabled }),
    query: (filters: MyWorkFilters = {}, options: { offset?: number; limit?: number; signal?: AbortSignal } = {}) =>
      sdk.query({ type: "my_work.query", filters, offset: options.offset ?? 0, limit: options.limit ?? 30 }, options.signal),
    status: () => sdk.query({ type: "my_work.status" }),
    read,
    inspect: (refreshId: string, expectedRevision: number, expectedInputDigest: string, confirm: true, commandId?: string) =>
      sdk.command({ type: "my_work.inspect", refreshId, expectedRevision, expectedInputDigest, confirm }, commandId),
    refresh: (sourceIds?: string[], options: { timeoutMs?: number; commandId?: string } = {}) =>
      sdk.command({ type: "my_work.refresh", ...(sourceIds ? { sourceIds } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }, options.commandId),
    cancel: async (refreshId: string) => sdk.command({ type: "job.cancel", jobId: (await read(refreshId, { metadataOnly: true })).refresh.jobId }),
    navigate: (itemId: string, sourceId: string) => sdk.query({ type: "my_work.navigate", itemId, sourceId }),
    previewFollowup: (itemId: string, sourceId: string, signal?: AbortSignal) => sdk.query({ type: "my_work.followup", itemId, sourceId }, signal),
    start: (preview: Extract<MyWorkResponse, { type: "my_work.followup" }>, sourceId: string, confirm: true, commandId?: string) =>
      sdk.command({ type: "my_work.start", itemId: preview.navigation.itemId, sourceId, expectedDigest: preview.digest, confirm }, commandId),
    markRead: async (itemId: string) => {
      await sdk.refresh();
      const ids = sdk.getState().snapshot?.attention.filter((entry) => entry.reason === "my-work" && entry.messageId === itemId &&
        entry.active && !entry.acknowledged).map((entry) => entry.id) ?? [];
      if (!ids.length) {
        if (!sdk.getState().snapshot?.myWorkRefreshes.some((refresh) => refresh.attention.some((entry) => entry.itemId === itemId)) &&
          !(await sdk.myWork.query({ itemId, state: "all" }, { limit: 1 })).entries.length) {
          throw new ClientError("my_work_item", "This inbox attention item is unavailable in the exact current profile. No read acknowledgement was invented.");
        }
        return {};
      }
      return sdk.attention.acknowledge(ids.slice(0, 100));
    },
    wait: async (refreshId: string, options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {}) => {
      const deadline = Date.now() + (options.timeoutMs ?? 330_000);
      for (;;) {
        options.signal?.throwIfAborted();
        await sdk.refresh();
        const result = await read(refreshId, { signal: options.signal, metadataOnly: true });
        if (result.refresh.status !== "running") return result;
        if (Date.now() >= deadline) throw new ClientError("my_work_wait_timeout", "The original inbox refresh is still running. This wait did not cancel or replay it; inspect its retained status.");
        await new Promise<void>((resolve, reject) => {
          const finish = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
          const timer = setTimeout(finish, Math.min(options.pollMs ?? 100, deadline - Date.now()));
          const abort = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); reject(options.signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
          options.signal?.addEventListener("abort", abort, { once: true });
          if (options.signal?.aborted) abort();
        });
      }
    },
  };
}
export type MyWorkApi = ReturnType<typeof createMyWorkApi>;
