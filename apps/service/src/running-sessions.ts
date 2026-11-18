import { MoguriError, type Snapshot } from "../../../packages/protocol/src/index.ts";
import { runningSessionNames, runningSessions } from "../../../packages/protocol/src/sessions.ts";

const verbs = { archive: "Archiving", delete: "Deleting", "remove-project": "Removing the project" } as const;

/**
 * Archiving or deleting stops a running session's work, so every client must show the user a warning first. The service is the
 * backstop: without `confirmRunning` it refuses and changes nothing, whatever "don't ask again" preferences a client saved.
 */
export function assertRunningConfirmed(snapshot: Pick<Snapshot, "sessions" | "jobs">, rootIds: readonly string[], confirmRunning: boolean | undefined,
  action: keyof typeof verbs): void {
  if (confirmRunning) return;
  const running = runningSessions(snapshot.sessions, snapshot.jobs, rootIds);
  if (!running.length) return;
  const one = running.length === 1;
  throw new MoguriError("session_running", `${runningSessionNames(running)} ${one ? "is" : "are"} still running. ${verbs[action]} stops ${one ? "its" : "their"} current work. ` +
    "Confirm that you want to stop it to continue; nothing was changed.", 409);
}
