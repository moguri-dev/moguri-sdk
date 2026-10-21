import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { MoguriError } from "../../packages/protocol/src/index.ts";
import { readProjectFile, scopedPath, writeProjectFile } from "../../apps/service/src/files.ts";
import { sourceRoot, sourceRootSync, type SourceRoot } from "../../apps/service/src/repository-source.ts";
import { digest } from "../../apps/service/src/store.ts";
import { decodeCompoundCandidate, type CompoundCandidate } from "./compound-routing-prototype.ts";

interface CandidateScope {
  profileId: string; projectId: string; workspaceId: string; source: string; stage: string; baseCommit: string; policyRevision: number;
}
type Patch = Extract<CompoundCandidate, { kind: "patch" }>;
export interface CandidateEffect {
  phase: "stage.started" | "stage.file" | "stage.completed" | "apply.started" | "apply.file" | "apply.completed";
  digest: string; paths: string[];
}
export interface CandidateAuthority {
  scope(): CandidateScope;
  signal: AbortSignal;
  assert(phase: "prepare" | "stage" | "apply", paths: readonly string[]): Promise<void>;
  current(): void;
  approve(digest: string): Promise<void>;
  record(effect: CandidateEffect): Promise<void>;
}
export interface CandidateReview { scope: CandidateScope; source: SourceRoot; stage: SourceRoot; patch: Patch; digest: string }
export class CandidatePartial extends MoguriError {
  constructor(readonly phase: "stage" | "apply", readonly reviewDigest: string, readonly paths: string[], error: unknown) {
    super("candidate_partial", `Candidate ${phase} is partial after effects on ${paths.join(", ")}. Inspect retained state; nothing was rolled back or retried.`, 409);
    this.cause = error;
  }
}
function fail(code: string, message: string): never { throw new MoguriError(code, message, 409); }
function hash(review: Omit<CandidateReview, "digest">): string {
  return createHash("sha256").update("moguri-candidate-prototype-v1\0")
    .update(JSON.stringify({ scope: review.scope, source: review.source, stage: review.stage, patch: review.patch })).digest("hex");
}
const sameRoot = (a: SourceRoot, b: SourceRoot) => a.root === b.root && a.device === b.device && a.inode === b.inode;
function current(review: CandidateReview, authority: CandidateAuthority): void {
  authority.signal.throwIfAborted(); authority.current();
  if (JSON.stringify(authority.scope()) !== JSON.stringify(review.scope)) fail("candidate_stale", "Candidate scope or policy changed. Review a new exact snapshot.");
  if (!sameRoot(review.source, sourceRootSync(review.scope.source)) || !sameRoot(review.stage, sourceRootSync(review.scope.stage))) fail("candidate_root", "Source or owned candidate directory identity changed. No fallback root.");
}
async function check(review: CandidateReview, authority: CandidateAuthority, phase: "prepare" | "stage" | "apply"): Promise<void> {
  current(review, authority); await authority.assert(phase, review.patch.edits.map(({ path }) => path)); current(review, authority);
}
async function base(root: string, path: string): Promise<string> {
  await scopedPath(root, path, true);
  try { return (await readProjectFile(root, path)).digest; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return "absent"; throw error; }
}
async function sourceBases(review: CandidateReview): Promise<void> {
  for (const edit of review.patch.edits) if (await base(review.source.root, edit.path) !== edit.baseDigest) fail("candidate_conflict", `Candidate base changed at ${edit.path}. Existing source content was preserved.`);
}
async function distinctPaths(root: string, patch: Patch): Promise<void> {
  const names = new Set<string>(), canonical = new Set<string>();
  for (const edit of patch.edits) {
    const name = edit.path.normalize("NFC").toLowerCase(), path = await scopedPath(root, edit.path, true);
    let physical = path;
    try { physical = await realpath(path); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (names.has(name) || canonical.has(physical)) fail("candidate_path_alias", "Candidate paths must be physically distinct and use unique portable case/normalization keys. No staging or application started.");
    names.add(name); canonical.add(physical);
  }
}
async function verifiedBytes(review: CandidateReview, phase: "stage" | "apply"): Promise<void> {
  const root = phase === "stage" ? review.stage.root : review.source.root;
  for (const edit of review.patch.edits) if (await base(root, edit.path) !== digest(edit.text)) fail(
    phase === "stage" ? "candidate_stage" : "candidate_result",
    `Candidate ${phase} bytes changed at ${edit.path}. The newer content was preserved; no verified completion.`,
  );
}
function reviewed(value: CandidateReview, expectedDigest: string): CandidateReview {
  const review = structuredClone(value), patch = decodeCompoundCandidate(JSON.stringify(review.patch));
  if (patch.kind !== "patch") fail("candidate_patch", "This file prerequisite accepts only a bounded typed patch.");
  if (review.digest !== expectedDigest || hash(review) !== expectedDigest) fail("candidate_review", "The exact candidate bytes, base or ownership differ from the reviewed snapshot.");
  return review;
}
export async function stageCandidate(value: unknown, authority: CandidateAuthority): Promise<CandidateReview> {
  const patch = decodeCompoundCandidate(JSON.stringify(value));
  if (patch.kind !== "patch") fail("candidate_patch", "This file prerequisite accepts only a bounded typed patch.");
  const scope = structuredClone(authority.scope()), source = await sourceRoot(scope.source), stage = await sourceRoot(scope.stage);
  if (source.device === stage.device && source.inode === stage.inode) fail("candidate_root", "The source and candidate must be different exact owned roots.");
  const body = { scope, source, stage, patch }, review: CandidateReview = { ...body, digest: hash(body) }, paths: string[] = [];
  await check(review, authority, "prepare");
  await distinctPaths(source.root, patch); await distinctPaths(stage.root, patch); await sourceBases(review);
  const stageBases: string[] = [];
  for (const edit of patch.edits) stageBases.push(await base(stage.root, edit.path));
  await check(review, authority, "prepare");
  await authority.record({ phase: "stage.started", digest: review.digest, paths: [] });
  try {
    for (let index = 0; index < patch.edits.length; index++) {
      const edit = patch.edits[index]!;
      await check(review, authority, "stage");
      await writeProjectFile(stage.root, edit.path, edit.text, stageBases[index]!, {
        signal: authority.signal, beforeCommit: () => { current(review, authority); }, committed: () => { paths.push(edit.path); },
      });
      await authority.record({ phase: "stage.file", digest: review.digest, paths: [...paths] });
    }
    await check(review, authority, "stage"); await verifiedBytes(review, "stage"); current(review, authority);
    await authority.record({ phase: "stage.completed", digest: review.digest, paths: [...paths] });
    current(review, authority);
    return review;
  } catch (error) { if (paths.length) throw new CandidatePartial("stage", review.digest, paths, error); throw error; }
}
export async function applyCandidate(value: CandidateReview, expectedDigest: string, authority: CandidateAuthority) {
  const review = reviewed(value, expectedDigest), paths: string[] = [];
  await check(review, authority, "apply"); await authority.approve(review.digest);
  await check(review, authority, "apply");
  await distinctPaths(review.source.root, review.patch); await distinctPaths(review.stage.root, review.patch); await sourceBases(review);
  await verifiedBytes(review, "stage");
  await check(review, authority, "apply");
  await authority.record({ phase: "apply.started", digest: review.digest, paths: [] });
  try {
    await verifiedBytes(review, "stage");
    for (const edit of review.patch.edits) {
      await check(review, authority, "apply");
      if (await base(review.stage.root, edit.path) !== digest(edit.text)) fail("candidate_stage", `Staged candidate changed at ${edit.path}. No unreviewed stage content was applied.`);
      await writeProjectFile(review.source.root, edit.path, edit.text, edit.baseDigest, {
        signal: authority.signal, beforeCommit: () => { current(review, authority); }, committed: () => { paths.push(edit.path); },
      });
      await authority.record({ phase: "apply.file", digest: review.digest, paths: [...paths] });
    }
    await check(review, authority, "apply"); await verifiedBytes(review, "apply"); current(review, authority);
    await authority.record({ phase: "apply.completed", digest: review.digest, paths: [...paths] });
    current(review, authority);
    return { status: "applied" as const, digest: review.digest, applied: paths };
  } catch (error) { if (paths.length) throw new CandidatePartial("apply", review.digest, paths, error); throw error; }
}
