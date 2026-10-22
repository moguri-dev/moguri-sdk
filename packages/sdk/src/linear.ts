import { ClientError } from "../../client/src/index.ts";
import type {
  LinearCatalogResource, LinearPreview, LinearQuery, LinearResponse, LinearScope, LinearWorkflowInput,
} from "../../protocol/src/linear-workflows.ts";
import type { MoguriSdk } from "./index.ts";

export function createLinearWorkflowApi(sdk: MoguriSdk) {
  const query = <Q extends LinearQuery>(input: Q): Promise<Extract<LinearResponse, { type: Q["type"] }>> => sdk.query(input);
  const read = (operationId: string) => query({ type: "linear.workflow.read", operationId });
  return {
    catalog: (projectId: string, resource: LinearCatalogResource, options: { issueId?: string; cursor?: string } = {}) =>
      query({ type: "linear.workflow.catalog", projectId, resource, ...options }),
    issue: (projectId: string, issueId: string) => query({ type: "linear.workflow.issue", projectId, issueId }),
    preview: (scope: LinearScope, input: LinearWorkflowInput) => query({ type: "linear.workflow.preview", ...scope, input }),
    execute: (scope: LinearScope, input: LinearWorkflowInput, expectedDigest: string, confirm: true, commandId?: string) =>
      sdk.command({ type: "linear.workflow.execute", ...scope, input, expectedDigest, confirm }, commandId),
    accept: (preview: LinearPreview, confirm: true, commandId?: string) => {
      if (preview.document.binding.profileId !== sdk.profileId) throw new ClientError("linear_profile", "The Linear review belongs to a different immutable profile; it was not sent.");
      return sdk.command({
        type: "linear.workflow.execute", projectId: preview.document.binding.projectId,
        ...(preview.document.binding.sessionId ? { sessionId: preview.document.binding.sessionId } : {}),
        input: preview.document.input, expectedDigest: preview.digest, confirm,
      }, commandId);
    },
    cancel: (operationId: string) => sdk.command({ type: "linear.workflow.cancel", operationId }),
    read,
    history: (projectId?: string) => query({ type: "linear.workflow.list", ...(projectId ? { projectId } : {}) }),
    wait: async (operationId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
      const before = await read(operationId);
      await sdk.jobs.wait(before.operation.jobId, options);
      return read(operationId);
    },
  };
}
