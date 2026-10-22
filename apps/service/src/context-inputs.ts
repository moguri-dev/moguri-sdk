import { randomUUID } from "node:crypto";
import { lstat, realpath, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import sharp from "sharp";
import { Value } from "typebox/value";
import {
  InputCommandSchema, InputQuerySchema, isRecord, MoguriError, pasteFilePath, pasteLineCount, type Attachment, type ContextPreview, type InputCommand, type InputQuery, type InputResponse, type Session, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import { isProtectedProjectPath, readProjectFile, readRegularFile, textFilePage } from "./files.ts";
import { digest, type EventStore } from "./store.ts";
import { ignoredPath, readIgnoreScope, type IgnoreScope } from "./ignore-rules.ts";
import { matchesFolder } from "./project-policy.ts";
import type { ProjectService } from "./project-service.ts";
import type { ProjectIntegrations } from "./project-integrations.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { MAX_CONTEXT_TEXT_BYTES, MAX_CONTEXT_FOLDER_FILES } from "./input-limits.ts";

export const isInputCommand = (value: unknown): value is InputCommand => Value.Check(InputCommandSchema, value);
export const isInputQuery = (value: unknown): value is InputQuery => Value.Check(InputQuerySchema, value);
const MAX_TEXT_BYTES = MAX_CONTEXT_TEXT_BYTES, MAX_IMAGE_BYTES = 8 * 1024 * 1024;
interface Host { snapshot(): Snapshot; events(): StoredEvent[]; ownedRoot(path: string): { path: string; projectId: string } | undefined }
interface Capture { preview: Omit<ContextPreview, "destination">; text: string }
export class ContextInputs {
  private stateRoot?: string;
  constructor(private readonly store: EventStore, private readonly projects: ProjectService, private readonly integrations: ProjectIntegrations, private readonly host: Host, private readonly stateDir: string) {}
  normalizePaste(text: string, attachments: Attachment[], retain = true): { text: string; attachments: Attachment[] } {
    const lines = pasteLineCount(text);
    if (lines <= 50) return { text, attachments };
    const bytes = Buffer.byteLength(text);
    if (!text.isWellFormed() || text.includes("\0")) throw new MoguriError("attachment_text", "Pasted files require valid UTF-8 text without NUL. The complete draft was preserved.");
    if (bytes > 128 * 1024) throw new MoguriError("attachment_limit", "Pasted text files are limited to 128 KiB. The complete draft was preserved; no text was truncated or sent.");
    if (attachments.length >= 16 || attachments.reduce((total, item) => total + item.bytes, bytes) > 12 * 1024 * 1024) throw new MoguriError("attachment_limit", "Use at most 16 attachments and 12 MiB of captured content. The complete draft was preserved.");
    const id = randomUUID(), hash = retain ? this.store.putBlob(text) : digest(text);
    const attachment: Attachment = { id, kind: "paste_file", path: pasteFilePath(id), digest: hash, bytes, lines, source: { kind: "paste", location: "explicit composer text", revision: hash } };
    return { text: "", attachments: [...attachments, attachment] };
  }
  retainedAttachments(sessionId: string): Attachment[] {
    const profileId = this.host.snapshot().profileId;
    return this.host.events().flatMap((event) => {
      if (event.profile_id !== profileId || event.session_id !== sessionId) return [];
      if (event.event_type === "session.created") return event.payload.pasteFiles ?? [];
      if (event.event_type === "draft.saved") return event.payload.attachments;
      if (event.event_type === "queue.edited") return event.payload.attachments ?? [];
      return event.event_type === "queue.enqueued" || event.event_type === "turn.started" || event.event_type === "steer.applied" ? event.payload.item.attachments : [];
    });
  }
  admittedFiles(sessionId: string): Extract<Attachment, { kind: "paste_file" }>[] {
    const session = this.session(sessionId, false);
    const profileId = this.host.snapshot().profileId;
    const inherited = this.host.events().flatMap((event) => event.profile_id === profileId && event.session_id === sessionId && event.event_type === "session.created" ? event.payload.pasteFiles ?? [] : []);
    const admitted = session.messages.flatMap((message) => message.role === "user" ? message.attachments ?? [] : [])
      .filter((attachment): attachment is Extract<Attachment, { kind: "paste_file" }> => attachment.kind === "paste_file");
    return [...new Map([...inherited, ...admitted].map((attachment) => [attachment.id, attachment])).values()];
  }
  scopedFile(sessionId: string, path: string): Extract<Attachment, { kind: "paste_file" }> {
    const attachment = this.admittedFiles(sessionId).find((attachment) => attachment.path === path);
    if (attachment?.kind !== "paste_file" || attachment.path !== pasteFilePath(attachment.id)) throw new MoguriError("attachment_scope", "This exact scoped file was not admitted to this session. Drafts, queued files, other profiles and host paths are not readable.", 403);
    return attachment;
  }
  readFile(sessionId: string, path: string, args: Record<string, unknown>) {
    const attachment = this.scopedFile(sessionId, path), text = this.store.blob(attachment.digest);
    if (digest(text) !== attachment.digest || Buffer.byteLength(text) !== attachment.bytes || pasteLineCount(text) !== attachment.lines) throw new MoguriError("attachment_integrity", "The retained file does not match its exact admitted descriptor. No text was substituted.", 409);
    return { path, digest: attachment.digest, lines: attachment.lines, boundary: "scoped-controller-snapshot", ...textFilePage(text, args) };
  }
  private session(id: string, mutate = true): Session {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session || mutate && session.status === "archived") throw new MoguriError("attachment_session", "Choose an existing, unarchived destination for attachment changes.");
    return session;
  }
  private async clientPath(input: string, directory = false): Promise<string> {
    if (!isAbsolute(input) || this.protectedClientPath(input)) throw new MoguriError("attachment_path", "Select an absolute, unprotected client-side file or folder explicitly.");
    const info = await lstat(input);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new MoguriError("attachment_path", "Choose a regular file/folder, not a symlink or device.");
    const path = await realpath(input);
    this.stateRoot ??= await realpath(this.stateDir);
    if (this.protectedClientPath(path)) throw new MoguriError("attachment_path", "Protected credential/application paths cannot be attached.");
    this.sourcePolicy(path);
    return path;
  }
  private protectedClientPath(path: string): boolean {
    const workspace = this.host.ownedRoot(path);
    return workspace ? isProtectedProjectPath(relative(workspace.path, path)) : isProtectedProjectPath(path);
  }
  private sourcePolicy(path: string) {
    const internal = relative(this.stateRoot ?? this.stateDir, path);
    if (!isAbsolute(internal) && internal !== ".." && !internal.startsWith("../") && !this.host.ownedRoot(path)) throw new MoguriError("attachment_path", "Moguri state and connection credentials cannot be attached as client files.");
    for (const project of this.host.snapshot().projects) {
      const child = relative(project.path, path);
      if (!isAbsolute(child) && child !== ".." && !child.startsWith("../") && matchesFolder(child || ".", this.projects.configuration(project.id).values.deniedFolders)) throw new MoguriError("attachment_path", "The selected source is denied by its project policy.");
    }
    for (const workspace of this.host.snapshot().managedWorkspaces.filter((workspace) => workspace.status === "ready")) {
      const child = relative(workspace.path, path);
      if (!isAbsolute(child) && child !== ".." && !child.startsWith("../") && matchesFolder(child || ".", this.projects.configuration(workspace.projectId).values.deniedFolders)) throw new MoguriError("attachment_path", "The selected managed-workspace source is denied by project policy.");
    }
  }
  private async folder(path: string): Promise<Capture> {
    const root = await this.clientPath(path, true), files: ContextPreview["files"] = [], excluded: ContextPreview["excluded"] = [];
    const content: string[] = []; let bytes = 0, directories = 0, entriesSeen = 0;
    const exclude = (path: string, reason: string) => { if (excluded.length < 200) excluded.push({ path, reason }); };
    const walk = async (directory: string, inherited: IgnoreScope[]) => {
      if (++directories > 1000) throw new MoguriError("attachment_folder_limit", "Folder preview exceeded 1,000 directories. Choose a smaller folder.");
      const chain = [...inherited, await readIgnoreScope(root, directory)];
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++entriesSeen > 5000) throw new MoguriError("attachment_folder_limit", "Folder preview exceeded 5,000 entries. Choose a smaller folder.");
        const absolute = join(directory, entry.name), name = relative(root, absolute);
        if (entry.isSymbolicLink() || isProtectedProjectPath(name) || ignoredPath(root, absolute, entry.isDirectory(), chain)) { exclude(name, "Protected, symlink or ignored"); continue; }
        try { this.sourcePolicy(absolute); } catch (error) { if (error instanceof MoguriError && error.code === "attachment_path") { exclude(name, error.message); continue; } throw error; }
        if (entry.isDirectory()) { await walk(absolute, chain); continue; }
        if (!entry.isFile()) { exclude(name, "Not a regular file"); continue; }
        let file;
        try { file = await readProjectFile(root, name); }
        catch (error) { if (error instanceof MoguriError && error.code === "file_limit") { exclude(name, error.message); continue; } throw error; }
        if (files.length >= MAX_CONTEXT_FOLDER_FILES || bytes + file.bytes > MAX_TEXT_BYTES) throw new MoguriError("attachment_folder_limit", "Folder capture is limited to 200 text files and 2 MiB. Select a smaller exact file set.");
        files.push({ path: name, bytes: file.bytes, digest: file.digest }); bytes += file.bytes;
        content.push(`\n<untrusted-file path=${JSON.stringify(name)} sha256="${file.digest}">\n${file.text}\n</untrusted-file>`);
      }
    };
    await walk(root, []);
    if (!files.length) throw new MoguriError("attachment_folder_empty", "No allowed UTF-8 files were found. Review exclusions or select a different folder.");
    const value = digest(JSON.stringify({ root, files, excluded })), text = content.join("\n");
    bytes = Buffer.byteLength(text);
    if (bytes > MAX_TEXT_BYTES) throw new MoguriError("attachment_folder_limit", "The captured text and provenance headers exceed 2 MiB. Choose a smaller folder.");
    return { text, preview: { kind: "folder", label: basename(root), bytes, digest: value, files, excluded, source: { kind: "client-folder", location: root, revision: value } } };
  }
  private sessionCapture(id: string): Capture {
    const source = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!source) throw new MoguriError("attachment_source", "The source session is outside the active profile or was deleted.");
    const eligible = source.messages.filter((message) => message.role === "user" || message.role === "assistant");
    const messages = eligible.slice(-100).map(({ id, role, text, timestamp }) => ({ id, role, text, timestamp }));
    const text = JSON.stringify({ title: source.title, sessionId: source.id, projectId: source.projectId, messages }, null, 2);
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_TEXT_BYTES) throw new MoguriError("attachment_session_limit", "The selected transcript exceeds 2 MiB. Choose a smaller source conversation.");
    const value = digest(text);
    const excluded = eligible.length > 100 ? [{ path: "Earlier transcript", reason: `${eligible.length - 100} earlier user/assistant messages excluded from this bounded snapshot.` }] : [];
    if (source.messages.some((message) => message.role === "tool" || message.attachments?.length)) excluded.push({ path: "Tool/attachment payloads", reason: "This is a public user/assistant text snapshot. Binary attachments, tool payloads and private continuation state are not copied." });
    return { text, preview: { kind: "session", label: source.title, bytes, digest: value, files: [], excluded, text, source: { kind: "session", location: source.id, revision: value } } };
  }
  private async github(session: Session, input: string, access: "public" | "gh-cli"): Promise<Capture> {
    let url: URL;
    try { url = new URL(input); } catch { throw new MoguriError("attachment_github", "Use an exact https://github.com/OWNER/REPO/issues/NUMBER or /pull/NUMBER URL."); }
    const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9]\d*)\/?$/);
    if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || !match || !Number.isSafeInteger(Number(match[3]))) throw new MoguriError("attachment_github", "Choose a canonical GitHub issue/PR URL without query, fragment or credentials.");
    const canonical = `https://github.com/${match[1]}/${match[2]}/${match[3]}`;
    const result = await this.integrations.githubRead(`repos/${match[1]}/${match[2] === "pull" ? "pulls" : "issues"}/${match[3]}`, access, this.host.snapshot().projects.find((project) => project.id === session.projectId)?.path ?? this.stateDir, AbortSignal.timeout(20_000));
    if (!isRecord(result) || result.number !== Number(match[3]) || result.html_url !== canonical || typeof result.title !== "string" || typeof result.updated_at !== "string" || !Number.isFinite(Date.parse(result.updated_at)) || result.body !== null && typeof result.body !== "string") throw new MoguriError("attachment_github", "GitHub did not verify this exact reference and revision. Nothing was attached.");
    if (match[2] === "issues" && result.pull_request !== undefined) throw new MoguriError("attachment_github", "This reference is a pull request. Select its /pull/ URL so its type is explicit.");
    const text = JSON.stringify({ url: canonical, repository: match[1], number: result.number, type: match[2] === "pull" ? "pull-request" : "issue", title: result.title, body: result.body ?? "", state: result.state, updatedAt: result.updated_at }, null, 2);
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_TEXT_BYTES) throw new MoguriError("attachment_reference_limit", "This reference exceeds 2 MiB; no content was silently truncated.");
    return { text, preview: { kind: match[2] === "pull" ? "github_pr" : "github_issue", label: `${match[1]}#${result.number} (${match[2] === "pull" ? "PR" : "issue"})`, bytes, digest: digest(text), files: [], excluded: [], text, source: { kind: access === "gh-cli" ? "github-cli" : "github-public", location: canonical, revision: result.updated_at } } };
  }
  private reviewed(sessionId: string, captured: Capture): ContextPreview {
    const session = this.session(sessionId, false), snapshot = this.host.snapshot(), remote = snapshot.settings.values.remote;
    const destination: ContextPreview["destination"] = {
      sessionId, env: session.controls.env, modelId: session.controls.modelId,
      target: session.controls.env === "Remote" ? remote ? `${remote.name} (${remote.host}:${remote.port}), not SendBox-isolated` : "Unconfigured SSH host" : session.controls.env === "Local" ? "Local host and explicitly selected provider" : "Configured SendBox workload",
    };
    return { ...captured.preview, destination, digest: digest(JSON.stringify({ source: captured.preview.digest, destination, revision: session.revision, remote: session.controls.env === "Remote" ? remote : null, localModels: snapshot.settings.values.localModels })) };
  }
  async query(query: InputQuery): Promise<InputResponse> {
    this.session(query.sessionId, false);
    if (query.type === "attachment.folder.preview") return { type: query.type, preview: this.reviewed(query.sessionId, await this.folder(query.path)) };
    if (query.type === "attachment.github.preview") return { type: query.type, preview: this.reviewed(query.sessionId, await this.github(this.session(query.sessionId), query.url, query.access)) };
    if (query.type === "attachment.session.preview") return { type: query.type, preview: this.reviewed(query.sessionId, this.sessionCapture(query.sourceSessionId)) };
    const attachment = this.retainedAttachments(query.sessionId).find((attachment) => attachment.id === query.attachmentId);
    if (!attachment) throw new MoguriError("attachment_scope", "This attachment has no content grant in the selected session.");
    const content = this.store.blob(attachment.digest);
    return { type: query.type, attachment, content: attachment.kind === "image" ? { kind: "image", data: content, mimeType: attachment.mimeType } : { kind: "text", text: content } };
  }
  private async image(data: Buffer, name: string, source: { kind: string; location: string }): Promise<Attachment> {
    if (data.length > MAX_IMAGE_BYTES) throw new MoguriError("attachment_image_limit", "Image input is limited to 8 MiB.");
    let normalized: Buffer, width: number, height: number;
    try {
      const image = sharp(data, { failOn: "error", limitInputPixels: 16_000_000 });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 16_000_000 || metadata.width > 16000 || metadata.height > 16000 || !["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error("Unsupported dimensions, animation or format");
      const result = await image.rotate().png().toBuffer({ resolveWithObject: true });
      normalized = result.data; width = result.info.width; height = result.info.height;
    } catch { throw new MoguriError("attachment_image", "Choose a valid single-frame PNG, JPEG or WebP within 16 million pixels. No remote conversion occurred."); }
    if (normalized.length > MAX_IMAGE_BYTES) throw new MoguriError("attachment_image_limit", "The normalized image exceeds 8 MiB. Resize it explicitly before attaching.");
    const contentDigest = this.store.putBlob(normalized.toString("base64"));
    return { id: randomUUID(), kind: "image", path: name, digest: contentDigest, bytes: normalized.length, mimeType: "image/png", width, height, source: { ...source, revision: contentDigest } };
  }
  async execute(command: InputCommand, finish: WorkspaceFinish) {
    const session = this.session(command.sessionId);
    if (session.draft.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "The destination draft changed. Your selection is preserved; review the current draft.", 409);
    let attachment: Attachment;
    if (command.type === "attachment.image.add") {
      const data = Buffer.from(command.data, "base64");
      if (data.toString("base64") !== command.data) throw new MoguriError("attachment_image", "Image data must be canonical base64.");
      attachment = await this.image(data, command.name, { kind: "clipboard", location: "explicit clipboard image" });
    } else if (command.type === "attachment.file.add") {
      const path = await this.clientPath(command.path);
      if (command.mode === "image") attachment = await this.image(await readRegularFile(path, MAX_IMAGE_BYTES), basename(path), { kind: "client-file", location: path });
      else {
        const file = await readProjectFile(dirname(path), basename(path));
        attachment = { id: randomUUID(), kind: "local_file", path: basename(path), digest: this.store.putBlob(file.text), bytes: file.bytes, source: { kind: "client-file", location: path, revision: file.digest } };
      }
    } else {
      const captured = command.type === "attachment.folder.add" ? await this.folder(command.path) : command.type === "attachment.github.add" ? await this.github(session, command.url, command.access) : this.sessionCapture(command.sourceSessionId);
      if (this.reviewed(session.id, captured).digest !== command.expectedDigest) throw new MoguriError("attachment_stale", "The source or destination changed after preview. Review its exact current snapshot and transfer scope before attaching.", 409);
      attachment = { id: randomUUID(), kind: captured.preview.kind, path: captured.preview.label, digest: this.store.putBlob(captured.text), bytes: captured.preview.bytes, source: captured.preview.source };
    }
    const current = this.session(session.id);
    if (current.draft.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "The draft changed during capture. No attachment was silently substituted.", 409);
    const attachments = [...current.draft.attachments, attachment];
    if (attachments.length > 16 || attachments.reduce((total, attachment) => total + attachment.bytes, 0) > 12 * 1024 * 1024) throw new MoguriError("attachment_limit", "Use at most 16 attachments and 12 MiB of captured content.");
    return finish([{ event_type: "draft.saved", profile_id: this.host.snapshot().profileId, project_id: current.projectId, session_id: current.id, payload: { text: current.draft.text, attachments } }], { id: attachment.id, revision: current.draft.revision + 1 });
  }
}
