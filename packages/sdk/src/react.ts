export { useMoguri } from "../../client/src/react.ts";
import { useEffect, useState } from "react";
import { TASK_PROGRESS_INTERVAL_MS, type Session, type TaskProgress } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

export function useTaskProgress(sdk: MoguriSdk, session: Session | undefined, connected: boolean) {
  const [state, setState] = useState<{ scope: string; progress: TaskProgress | null; error: string | null }>({ scope: "", progress: null, error: null });
  const scope = JSON.stringify([sdk.profileId, session?.id, session?.turnId, session?.controls.env, session?.workspaceId, session?.sandboxWorkspaceId, session?.taskPlan?.revision]);
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
