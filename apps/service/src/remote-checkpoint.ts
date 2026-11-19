import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { defaultProjectConfiguration, defaultSettings, MoguriError, type WinddownCommitResult } from "../../../packages/protocol/src/index.ts";
import { ExecutionJournal, inspectExecutionJournal } from "./execution-journal.ts";
import type { BridgeInfo, BridgeInit, BridgeStatus } from "./remote-protocol.ts";
import { readWorkspace } from "./workspace-reads.ts";
import { ProjectService } from "./project-service.ts";
import { sourceRootSync } from "./repository-source.ts";

export async function remoteCheckpoint(init: BridgeInit, info: BridgeInfo, signal: AbortSignal) {
  if (!init.runId || !init.key || !info.root || info.native || !init.checkpoint || init.checkpoint.document.version !== 3) {
    throw new MoguriError("checkpoint_transport", "Checkpoint Git requires the exact original model-free SSH owner, key, root and reviewed document. No native or controller mapping.", 409);
  }
  const { document, settings } = init.checkpoint, key = Buffer.from(init.key, "hex"), directory = join(init.stateDir, init.runId);
  if (document.transport.env !== "Remote" || document.transport.root !== info.root || document.transport.workerDigest !== info.workerDigest ||
    document.source.env !== "Remote" || document.source.root !== info.root || document.source.head !== document.base ||
    document.acceptedSource.sourceStateDigest !== document.sourceStateDigest ||
    JSON.stringify(document.acceptedSource.files) !== JSON.stringify(document.files) ||
    JSON.stringify(document.acceptedSource.source) !== JSON.stringify(document.source)) {
    throw new MoguriError("checkpoint_transport", "Reviewed peer source/accepted bytes/base lost their original transport binding. No Git effect was authorized.", 409);
  }
  const project = { id: document.source.projectId, name: "Original reviewed SSH source", path: info.root, createdAt: new Date().toISOString() };
  const configuration = { ...defaultProjectConfiguration(project.id), values: settings };
  const service = new ProjectService(() => ({ projects: [project], projectConfigurations: [configuration],
    settings: { revision: 0, permissionRevision: 0, defaults: defaultSettings(), values: defaultSettings() } }), directory);
  const identity = () => {
    signal.throwIfAborted();
    const current = sourceRootSync(info.root!);
    if (current.device !== document.source.device || current.inode !== document.source.inode) throw new MoguriError("checkpoint_source_changed", "The original peer directory was replaced. No alias, checkout or root transfer.", 409);
  };
  const check = async () => {
    identity();
    const read = await readWorkspace(info.root!, { query: { type: "checkpoint.source", paths: document.files.map((file) => file.path) },
      policy: { deniedFolders: settings.deniedFolders, planPath: settings.planPath } }, signal);
    if (read.type !== "checkpoint.source" || JSON.stringify(read.source) !== JSON.stringify({ root: document.source.root, device: document.source.device,
      inode: document.source.inode, gitCommonDir: document.source.gitCommonDir, head: document.source.head, branch: document.source.branch }) ||
      read.sourceStateDigest !== document.sourceStateDigest || JSON.stringify(read.files) !== JSON.stringify(document.files)) {
      throw new MoguriError("checkpoint_source_changed", "Exact accepted peer bytes, HEAD/index or modes changed after actual-user review. No source/reset fallback.", 409);
    }
    identity();
  };
  if (init.action === "checkpoint-inspect") {
    const saved = await inspectExecutionJournal(directory, key, 0), phases = saved.frames.map((frame) => frame.request);
    if (saved.info.root !== info.root || saved.info.workerDigest !== info.workerDigest || saved.status.runId !== init.runId ||
      saved.status.acknowledged !== 0 || saved.status.sequence !== phases.length ||
      phases.some((request) => request.kind !== "checkpoint.phase") ||
      phases[0]?.kind !== "checkpoint.phase" || phases[0].phase !== "intent" ||
      JSON.stringify(phases[0].document) !== JSON.stringify(document)) throw new MoguriError("checkpoint_transport", "Original encrypted checkpoint receipt changed or is incomplete. No result or effect was adopted.", 409);
    const checkpointPhases = phases.filter((request) => request.kind === "checkpoint.phase");
    const order = ["intent", "prepared", "published", "result", "settled"];
    if (checkpointPhases.some((request, index) => order.indexOf(request.phase) <= order.indexOf(checkpointPhases[index - 1]?.phase ?? "")) ||
      checkpointPhases.at(-1)?.phase !== "settled" || !["completed", "partial"].includes(saved.status.status)) {
      throw new MoguriError("checkpoint_unsettled", "The original peer operation has no complete authenticated terminal effect fence. Its writer remains quarantined; no PID ownership, cleanup or completion was inferred.", 409);
    }
    const prepared = checkpointPhases.find((request) => request.phase === "prepared")?.commit ?? null;
    const published = checkpointPhases.find((request) => request.phase === "published")?.commit ?? null;
    const result = checkpointPhases.find((request) => request.phase === "result")?.result;
    if (published && published !== prepared || result && (result.version !== 3 || result.commit !== prepared || result.commit !== published ||
      result.winddownId !== document.winddownId || result.branch !== document.branch || result.base !== document.base ||
      result.sourceStateDigest !== document.sourceStateDigest || JSON.stringify(result.source) !== JSON.stringify(document.source) ||
      JSON.stringify(result.transport) !== JSON.stringify(document.transport) ||
      JSON.stringify(result.files) !== JSON.stringify(document.files.map(({ path, digest }) => ({ path, digest }))))) {
      throw new MoguriError("checkpoint_receipt", "Original prepared/publication/result receipts disagree with their exact reviewed bytes. No result was repaired or adopted.", 409);
    }
    await check();
    const actualCommit = await service.inspectReviewedCommit(project, document.files, { branch: document.branch, base: document.base, commit: prepared }, signal);
    if ((published || result) && actualCommit !== prepared) throw new MoguriError("checkpoint_ref_changed", "The retained peer publication no longer exists at its exact ref. No historical receipt became current success.", 409);
    await check();
    return { kind: "checkpoint-inspection" as const, info, status: saved.status, frames: saved.frames, actualCommit, operationSettled: true as const };
  }
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new MoguriError("checkpoint_no_replay", "This original checkpoint already retained intent. Inspect it; no Git publication was replayed.", 409);
    throw error;
  }
  const status: BridgeStatus = { runId: init.runId, workerPid: null, port: 0, acknowledged: 0, sequence: 0, status: "running",
    cancellation: "none", cleanup: "pending", diagnostic: null };
  const journal = await ExecutionJournal.create(directory, key, info, status);
  await journal.append({ kind: "checkpoint.phase", phase: "intent", document });
  try {
    await check();
    const committed = await service.reviewedCommit(project, document.files, { branch: document.branch, base: document.base }, document.message, signal, {
      beforeCommit: identity,
      publishIntent: async (value) => { await check(); await journal.append({ kind: "checkpoint.phase", phase: "prepared", commit: value.commit }); },
      committed: async (value) => { await journal.append({ kind: "checkpoint.phase", phase: "published", commit: value.commit }); },
    });
    await check();
    for (const file of document.files) await service.verifyArtifactCommit(project, file.path, committed, signal);
    await check();
    const result: WinddownCommitResult = { version: 3, modelEnv: "Remote", publicationEnv: "Remote", transport: document.transport,
      winddownId: document.winddownId, source: document.source, branch: committed.branch, base: committed.base, commit: committed.commit,
      sourceStateDigest: document.sourceStateDigest, verified: true, files: document.files.map(({ path, digest }) => ({ path, digest })) };
    await journal.append({ kind: "checkpoint.phase", phase: "result", result });
    await journal.append({ kind: "checkpoint.phase", phase: "settled" });
    await journal.update({ status: "completed", diagnostic: "Exact peer Git ref/blobs verified; original HEAD/index preserved. This receipt does not authorize another model or publication." });
    return { kind: "checkpoint" as const, info, result };
  } catch (error) {
    try {
      await journal.append({ kind: "checkpoint.phase", phase: "settled" });
      await journal.update({ status: "partial", cancellation: signal.aborted ? "requested" : "none", cleanup: "unconfirmed",
        diagnostic: "The original peer Git call stack settled without a complete result. Inspect exact encrypted receipts and current refs/source; no commit, PID ownership or process cleanup was inferred." });
    }
    catch (failure) { console.error("Remote checkpoint outcome persistence failed:", failure instanceof MoguriError ? failure.code : "checkpoint_persistence"); }
    throw error;
  }
}
