export { useMoguri } from "../../client/src/react.ts";
import { useEffect, useRef, useState } from "react";
import { TASK_PROGRESS_INTERVAL_MS, type ActivityCursor, type Session, type SessionActivity, type Snapshot, type TaskProgress } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

export function useTaskProgress(sdk: MoguriSdk, session: Session | undefined, connected: boolean) {
  const [state, setState] = useState<{ scope: string; progress: TaskProgress | null; error: string | null }>({ scope: "", progress: null, error: null });
  const scope = JSON.stringify([sdk.profileId, session?.id, session?.turnId, session?.controls.env, session?.workspaceId, session?.sandboxWorkspaceId]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    setState({ scope, progress: null, error: null });
    if (!session || !connected) return;
    const check = async () => {
      try {
        const result = await sdk.sessions.progress(session.id);
        if (active) setState({ scope, progress: result.progress, error: null });
      } catch (error) {
        if (active) setState({ scope, progress: null, error: error instanceof Error ? error.message : "Plan completion is unavailable; no estimate was substituted." });
      } finally { if (active) timer = setTimeout(() => void check(), TASK_PROGRESS_INTERVAL_MS); }
    };
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [sdk, scope, connected]);
  return state.scope === scope ? state : { scope, progress: null, error: null };
}

export function useSessionActivity(sdk: MoguriSdk, session: Session, snapshot: Snapshot, toolName?: string) {
  const scope = JSON.stringify([sdk.profileId, session.id, toolName ?? null]);
  const owner = useRef({ sdk, scope }); owner.current = { sdk, scope };
  const [state, setState] = useState<{ sdk: MoguriSdk; scope: string; activity: SessionActivity | null; error: string | null; loading: boolean }>({
    sdk, scope, activity: null, error: null, loading: true,
  });
  const [earlierLoading, setEarlierLoading] = useState(false);
  const stamp = JSON.stringify([
    session.turnId, session.status, session.draft.revision, session.messages.map((message) => [message.id, message.outcome, Boolean(message.reasoning)]),
    session.usage.map((usage) => [usage.stepId, usage.outcome, usage.requestMs, usage.totalTokens]),
    snapshot.operationEntries.filter((entry) => entry.sessionId === session.id).map((entry) => [entry.id, entry.revision]),
    snapshot.githubOperations.filter((entry) => entry.originSessionId === session.id).map((entry) => [entry.id, entry.revision]),
    snapshot.linearOperations.filter((entry) => entry.sessionId === session.id).map((entry) => [entry.id, entry.revision]),
  ]);
  const merge = (previous: SessionActivity | null, next: SessionActivity, earlier = false): SessionActivity => {
    const before = (a: ActivityCursor, b: ActivityCursor) => a.sequence < b.sequence || a.sequence === b.sequence && a.id.localeCompare(b.id) < 0;
    const boundary = next.nextBefore;
    const gap = previous && boundary !== null && previous.entries.every((entry) => before({ sequence: entry.updatedSequence, id: entry.id }, boundary));
    const older = previous && previous.sequence > next.sequence;
    const ordered = older ? [...next.entries, ...next.current, ...previous.entries] : [...(previous?.entries ?? []), ...next.entries, ...next.current];
    return {
      ...(older ? previous : next), sequence: Math.max(previous?.sequence ?? 0, next.sequence),
      entries: [...new Map(ordered.map((entry) => [entry.id, entry])).values()].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)),
      nextBefore: earlier || !previous || gap ? next.nextBefore : previous.nextBefore === null ? null :
        next.nextBefore === null || before(previous.nextBefore, next.nextBefore) ? previous.nextBefore : next.nextBefore,
      messageOrder: [...new Map([...(previous?.messageOrder ?? []), ...next.messageOrder].map((entry) => [entry.id, entry])).values()],
    };
  };
  useEffect(() => { setEarlierLoading(false); }, [sdk, scope]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const result = await sdk.activity.list(session.id, { ...(toolName === undefined ? {} : { toolName }) });
        if (result.activity.sessionId !== session.id) throw new Error("Activity returned a different session. No source was substituted.");
        if (active) setState((previous) => ({ sdk, scope, activity: merge(previous.sdk === sdk && previous.scope === scope ? previous.activity : null, result.activity), error: null, loading: false }));
        if (active && (session.turnId || result.activity.currentCount > 0 || result.activity.entries.some((entry) => entry.status === "pending"))) timer = setTimeout(() => void check(), 1000);
      } catch (error) {
        if (active) setState((previous) => ({ sdk, scope, activity: previous.sdk === sdk && previous.scope === scope ? previous.activity : null,
          error: error instanceof Error ? error.message : "Retained activity could not be read. Missing data is not an empty history.", loading: false }));
        if (active && session.turnId) timer = setTimeout(() => void check(), 1000);
      }
    };
    if (sdk.getState().status === "connected") void check();
    return () => { active = false; clearTimeout(timer); };
  }, [sdk, scope, stamp, sdk.getState().status]);
  const current = state.sdk === sdk && state.scope === scope;
  const loadEarlier = async () => {
    if (!current || state.activity?.nextBefore === null || state.activity?.nextBefore === undefined || earlierLoading) return;
    const captured = owner.current; setEarlierLoading(true);
    try {
      const result = await sdk.activity.list(session.id, { before: state.activity.nextBefore, ...(toolName === undefined ? {} : { toolName }) });
      if (result.activity.sessionId !== session.id) throw new Error("Earlier activity returned a different session. No source was substituted.");
      if (owner.current.sdk === captured.sdk && owner.current.scope === captured.scope) setState((previous) => ({ sdk, scope, activity: merge(previous.activity, result.activity, true), error: null, loading: false }));
    } catch (error) {
      if (owner.current.sdk === captured.sdk && owner.current.scope === captured.scope) setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : "Earlier activity could not be read." }));
    } finally { if (owner.current.sdk === captured.sdk && owner.current.scope === captured.scope) setEarlierLoading(false); }
  };
  return { activity: current ? state.activity : null, error: current ? state.error : null, loading: !current || state.loading, earlierLoading, loadEarlier };
}
