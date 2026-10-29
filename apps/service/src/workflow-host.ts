import type { CapabilityJob, EventInput, Project, ProjectConfiguration, Snapshot, StoredEvent } from "../../../packages/protocol/src/index.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import type { GithubReviewDocument } from "../../../packages/protocol/src/github-workflows.ts";

export interface WorkflowHost {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  project(projectId: string, workspaceId?: string): Project;
  configuration(projectId: string): ProjectConfiguration;
  assertRoot(projectId: string, workspaceId: string | undefined, signal: AbortSignal): Promise<void>;
  branchEvents?(document: GithubReviewDocument, branch: string, operationId: string): EventInput[];
  rootBusy(root: string, exceptJobId?: string, permitRebaseRecovery?: boolean, ownerSessionId?: string): boolean;
  closing(projectId: string): boolean;
  commit(events: EventInput[]): void;
  job(
    kind: string, projectId: string, workspaceId: string | undefined,
    execute: (signal: AbortSignal, progress: (text: string) => void, jobId: string) => Promise<unknown>,
    start: (job: CapabilityJob) => void, settled?: () => void, lifecycle?: CandidateJobLifecycle, sessionId?: string,
  ): string;
}
