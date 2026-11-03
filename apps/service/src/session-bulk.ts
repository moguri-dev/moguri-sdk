import { createHash } from "node:crypto";
import { MoguriError, sessionSubtree, type BulkSessionInput, type BulkSessionPreview, type Session, type Snapshot } from "../../../packages/protocol/src/index.ts";

export function previewSessionBulk(snapshot: Snapshot, input: BulkSessionInput): BulkSessionPreview {
  const ids = new Set(input.sessionIds);
  if (ids.size !== input.sessionIds.length || ids.size < 2 || ids.size > 100) throw new MoguriError("session_bulk_selection", "Select two to 100 distinct sessions in one project. Nothing was changed.", 409);
  const selected = input.sessionIds.map((id) => {
    const session = snapshot.sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("session_bulk_missing", "An exact selected session was removed or is outside this profile. No other session was substituted.", 409);
    return session;
  });
  const source = selected[0]!;
  if (selected.some((session) => session.projectId !== source.projectId || !source.projectId && session.projectFolderId !== source.projectFolderId)) {
    throw new MoguriError("session_bulk_project", "Bulk actions cannot cross projects or captured project-free folder scopes.", 409);
  }
  const roots = selected.filter((session) => {
    const visited = new Set<string>();
    for (let id = session.parentSessionId; id; id = snapshot.sessions.find((value) => value.id === id)?.parentSessionId) {
      if (visited.has(id)) throw new MoguriError("session_cycle", "The retained session tree is cyclic. Inspect it before a bulk action.", 409);
      visited.add(id);
      if (ids.has(id)) return false;
    }
    return true;
  });
  const tree = [...new Map(roots.flatMap((session) => sessionSubtree(snapshot.sessions, session.id)).map((session) => [session.id, session])).values()];
  if (tree.length > 1000 || tree.some((session) => session.projectId !== source.projectId)) throw new MoguriError("session_bulk_tree", "The complete selected tree exceeds its bound or changed project scope. Nothing was changed.", 409);
  if (input.action === "attach" || input.action === "detach") {
    const attached = selected.map((session) => Boolean(session.parentSessionId));
    if (attached.some((value) => value !== attached[0]) || (input.action === "attach" ? attached[0] : !attached[0])) {
      throw new MoguriError("session_bulk_homogeneous", "Attach requires all selected sessions to be detached; detach requires all to be attached. A mixed selection cannot be partially changed.", 409);
    }
    if (tree.some((session) => session.turnId || session.kind === "subagent")) throw new MoguriError("session_bulk_busy", "Stop selected tree work before attachment changes. Model-owned subagents cannot acquire independent navigation authority.", 409);
    const target = input.targetSessionId ? snapshot.sessions.find((session) => session.id === input.targetSessionId) : undefined;
    if (input.action === "attach" && (!target || target.projectId !== source.projectId || target.projectFolderId !== source.projectFolderId ||
      target.kind === "subagent" || target.status === "archived" || ids.has(target.id))) throw new MoguriError("session_bulk_target", "Choose another exact unarchived session in this project as the attachment target.", 409);
    if (input.action === "detach" && input.targetSessionId || input.children) throw new MoguriError("session_bulk_input", "Attachment actions do not accept a child-retention choice or a detach target.", 409);
    const next = snapshot.sessions.map((session) => ids.has(session.id) ? { ...session, parentSessionId: target?.id } : session);
    for (const session of tree) {
      const visited = new Set<string>([session.id]);
      for (let parent = next.find((value) => value.id === session.id)?.parentSessionId; parent; parent = next.find((value) => value.id === parent)?.parentSessionId) {
        if (visited.has(parent) || visited.size > 8) throw new MoguriError("session_cycle", "The complete bulk attachment must stay acyclic and at most eight levels deep.", 409);
        visited.add(parent);
      }
    }
  } else {
    if (input.targetSessionId) throw new MoguriError("session_bulk_input", "Archive/delete cannot adopt an attachment target.", 409);
    if (input.action === "archive" && selected.some((session) => session.status === "archived")) throw new MoguriError("session_bulk_archived", "Select unarchived sessions for archive. No mixed lifecycle action was performed.", 409);
    const descendants = tree.filter((session) => !ids.has(session.id));
    if (descendants.length && !input.children) throw new MoguriError("session_bulk_children", "Review whether to cascade the action or detach unselected children before changing this selected set.", 409);
    if (input.children === "detach" && tree.some((session) => session.kind === "subagent" && session.parentSessionId && ids.has(session.parentSessionId) && !ids.has(session.id))) {
      throw new MoguriError("session_bulk_children", "An unselected model-owned subagent cannot be detached. Select cascade or review the selected tree again.", 409);
    }
  }
  const bindings = (sessions: Session[]) => sessions.map((session) => ({
    id: session.id, revision: session.revision, projectId: session.projectId, projectFolderId: session.projectFolderId,
    workspaceId: session.workspaceId, parentSessionId: session.parentSessionId, status: session.status, turnId: session.turnId,
    draftRevision: session.draft.revision, queueRevision: session.queueRevision,
    kind: session.kind, controls: session.controls, homeRoot: session.homeRoot, repositories: session.repositories,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const target = input.targetSessionId ? snapshot.sessions.filter((session) => session.id === input.targetSessionId) : [];
  const digest = createHash("sha256").update(JSON.stringify([snapshot.profileId, input, bindings(tree), bindings(target),
    snapshot.policy.revision, snapshot.settings.permissionRevision,
    snapshot.projectConfigurations.filter((configuration) => configuration.projectId === source.projectId)])).digest("hex");
  return { digest, input: structuredClone(input), roots: (input.children === "detach" ? selected : roots).map((session) => session.id),
    selected: selected.map(({ id, title, revision, projectId, status, parentSessionId }) => ({ id, title, revision, projectId, status, parentSessionId })),
    descendants: tree.filter((session) => !ids.has(session.id) && session.parentSessionId).map((session) => ({
      sessionId: session.id, parentSessionId: session.parentSessionId!, title: session.title,
    })) };
}
