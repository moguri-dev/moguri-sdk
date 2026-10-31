import { createHash, randomUUID } from "node:crypto";
import { stripMarkdownComments, workItemSnapshotView } from "../../../packages/protocol/src/markdown.ts";
import { isUtf8 } from "node:buffer";
import { lstat, realpath, readdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import sharp from "sharp";
import { Value } from "typebox/value";
import {
  attachmentBytes, documentDescriptor, DocumentDataSchema, DOCUMENT_LIMITS, DocumentListToolSchema, DocumentReadToolSchema, DocumentSearchToolSchema, parse,
  InputCommandSchema, InputQuerySchema, isRecord, MoguriError, pasteFilePath, pasteLineCount, type Attachment, type ContextPreview, type InputCommand, type InputQuery, type InputResponse, type Session, type Snapshot, type StoredEvent,
  type CommandResult, type DocumentAttachment, type DocumentReadOptions, type DocumentSearchOptions, type DocumentListOptions, type DocumentList, type ToolCall, type AttachmentAccess, type Project,
} from "../../../packages/protocol/src/index.ts";
import { isProtectedProjectPath, readProjectFile, readRegularFile, scopedPath, textFilePage } from "./files.ts";
import { digest, type EventStore } from "./store.ts";
import { ignoredPath, readIgnoreScope, type IgnoreScope } from "./ignore-rules.ts";
import { matchesFolder } from "./project-policy.ts";
import type { ProjectService } from "./project-service.ts";
import type { ProjectIntegrations } from "./project-integrations.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { MAX_CONTEXT_TEXT_BYTES, MAX_CONTEXT_FOLDER_FILES } from "./input-limits.ts";
import { DocumentParsers, type DocumentParserOptions } from "./documents.ts";
import { documentPage, documentSearch } from "./document-reads.ts";
import { assertFolderAccess, folderPolicy } from "./project-policy.ts";

export const isInputCommand = (value: unknown): value is InputCommand => Value.Check(InputCommandSchema, value);
export const isInputQuery = (value: unknown): value is InputQuery => Value.Check(InputQuerySchema, value);
const MAX_TEXT_BYTES = MAX_CONTEXT_TEXT_BYTES, MAX_IMAGE_BYTES = 8 * 1024 * 1024;
interface Host {
  snapshot(): Snapshot; events(): StoredEvent[]; ownedRoot(path: string): { path: string; projectId: string } | undefined;
  project(session: Pick<Session, "projectId" | "workspaceId">): Project;
}
interface Capture { preview: Omit<ContextPreview, "destination">; text: string }
export class ContextInputs {
  private stateRoot?: string;
  private readonly parsers: DocumentParsers;
  private captures = new Map<string, { sessionId: string; abort: AbortController; done: Promise<CommandResult> }>();
  private closing = false;
  constructor(private readonly store: EventStore, private readonly projects: ProjectService, private readonly integrations: ProjectIntegrations, private readonly host: Host, private readonly stateDir: string, documentOptions: DocumentParserOptions = {}) { this.parsers = new DocumentParsers(documentOptions); }
  assertDraftReady(sessionId: string): void {
    if ([...this.captures.values()].some((capture) => capture.sessionId === sessionId)) throw new MoguriError("document_pending", "Document extraction is still active for this draft. Wait for completion or cancel that capture before sending/holding the complete prompt. The draft and queue were preserved.", 409);
  }
  normalizePaste(text: string, attachments: Attachment[], retain = true): { text: string; attachments: Attachment[] } {
    const lines = pasteLineCount(text);
    if (lines <= 50) return { text, attachments };
    const bytes = Buffer.byteLength(text);
    if (!text.isWellFormed() || text.includes("\0")) throw new MoguriError("attachment_text", "Pasted files require valid UTF-8 text without NUL. The complete draft was preserved.");
    if (bytes > 128 * 1024) throw new MoguriError("attachment_limit", "Pasted text files are limited to 128 KiB. The complete draft was preserved; no text was truncated or sent.");
    if (attachments.length >= 16 || attachments.reduce((total, item) => total + attachmentBytes(item), bytes) > 12 * 1024 * 1024) throw new MoguriError("attachment_limit", "Use at most 16 attachments and 12 MiB of captured content. The complete draft was preserved.");
    const id = randomUUID(), hash = retain ? this.store.putBlob(text) : digest(text);
    const attachment: Attachment = { id, kind: "paste_file", path: pasteFilePath(id), digest: hash, bytes, lines, source: { kind: "paste", location: "explicit composer text", revision: hash } };
    return { text: "", attachments: [...attachments, attachment] };
  }
  retainedAttachments(sessionId: string): Attachment[] {
    const profileId = this.host.snapshot().profileId;
    return this.host.events().flatMap((event) => {
      if (event.profile_id !== profileId || event.session_id !== sessionId) return [];
      if (event.event_type === "session.created") return [...(event.payload.pasteFiles ?? []), ...(event.payload.documents ?? [])];
      if (event.event_type === "draft.saved") return event.payload.attachments;
      if (event.event_type === "queue.edited") return event.payload.attachments ?? [];
      if (event.event_type === "turn.started") return [...event.payload.item.attachments, ...(event.payload.sideContext?.pasteFiles ?? []), ...(event.payload.sideContext?.documents ?? [])];
      return event.event_type === "queue.enqueued" || event.event_type === "steer.applied" ? event.payload.item.attachments : [];
    });
  }
  admittedFiles(sessionId: string): Extract<Attachment, { kind: "paste_file" }>[] {
    const session = this.session(sessionId, false);
    const profileId = this.host.snapshot().profileId;
    const inherited = this.host.events().flatMap((event) => event.profile_id === profileId && event.session_id === sessionId && event.event_type === "session.created" ? event.payload.pasteFiles ?? [] : []);
    const admitted = session.messages.flatMap((message) => message.role === "user" ? message.attachments ?? [] : [])
      .filter((attachment): attachment is Extract<Attachment, { kind: "paste_file" }> => attachment.kind === "paste_file");
    return [...new Map([...inherited, ...session.sideContext?.pasteFiles ?? [], ...admitted].map((attachment) => [attachment.id, attachment])).values()];
  }
  admittedDocuments(sessionId: string): DocumentAttachment[] {
    const session = this.session(sessionId, false), profileId = this.host.snapshot().profileId;
    const inherited = this.host.events().flatMap((event) => event.profile_id === profileId && event.session_id === sessionId && event.event_type === "session.created" ? event.payload.documents ?? [] : []);
    const admitted = session.messages.flatMap((message) => message.role === "user" ? message.attachments ?? [] : []).filter((attachment): attachment is DocumentAttachment => attachment.kind === "document");
    return [...new Map([...inherited, ...session.sideContext?.documents ?? [], ...admitted].map((attachment) => [attachment.id, attachment])).values()];
  }
  scopedDocument(sessionId: string, id: string, admitted = true): DocumentAttachment {
    const attachment = (admitted ? this.admittedDocuments(sessionId) : this.retainedAttachments(sessionId)).find((attachment) => attachment.id === id && attachment.kind === "document");
    if (attachment?.kind !== "document") throw new MoguriError("attachment_scope", "This exact document has no admitted content grant in this session/profile. Unsent drafts, held queues and workstation paths are unavailable to model tools.", 403);
    return attachment;
  }
  private documentData(attachment: DocumentAttachment) {
    const content = this.store.blob(attachment.digest);
    if (digest(content) !== attachment.digest || Buffer.byteLength(content) !== attachment.extractedBytes) throw new MoguriError("attachment_integrity", "Retained document extraction differs from its exact snapshot. No substitute was read.", 409);
    let document: unknown;
    try { document = JSON.parse(content); } catch { throw new MoguriError("attachment_integrity", "Retained document extraction is malformed. The original was not reparsed or substituted.", 409); }
    if (!Value.Check(DocumentDataSchema, document) || document.format !== attachment.format || JSON.stringify(document.summary) !== JSON.stringify(attachment.summary)) throw new MoguriError("attachment_integrity", "Retained document provenance/format differs from its descriptor.", 409);
    return document;
  }
  private listDocuments(sessionId: string, options: DocumentListOptions, admitted = false): DocumentList {
    const attachments = admitted ? this.admittedDocuments(sessionId) : [...new Map(this.retainedAttachments(sessionId)
      .filter((attachment): attachment is DocumentAttachment => attachment.kind === "document").map((attachment) => [attachment.id, attachment])).values()];
    const offset = options.offset ?? 0, limit = options.limit ?? 20, documents: DocumentList["documents"] = [];
    if (offset > attachments.length) throw new MoguriError("document_list", "Use a returned offset in this session's document inventory.");
    let index = offset;
    for (; index < attachments.length && documents.length < limit; index++) {
      const descriptor = documentDescriptor(attachments[index]!);
      if (Buffer.byteLength(JSON.stringify([...documents, descriptor])) > DOCUMENT_LIMITS.readBytes - 1024) break;
      documents.push(descriptor);
    }
    if (!documents.length && index < attachments.length) throw new MoguriError("document_list", "This document descriptor exceeds the bounded inventory page. Inspect its exact retained attachment ID instead; no descriptor was truncated.");
    return { boundary: "scoped-controller-snapshot", untrusted: true, documents, nextOffset: index < attachments.length ? index : null };
  }
  documentTool(sessionId: string, call: ToolCall) {
    if (call.name === "list_documents") return this.listDocuments(sessionId, parse(DocumentListToolSchema, call.arguments), true);
    if (call.name === "read_document") {
      const { attachmentId, ...options } = parse(DocumentReadToolSchema, call.arguments);
      return this.readDocument(sessionId, attachmentId, options, true);
    }
    if (call.name !== "search_document") throw new MoguriError("document_tool", "Choose an actual bounded document list/read/search tool. No fallback operation was executed.");
    const { attachmentId, ...options } = parse(DocumentSearchToolSchema, call.arguments);
    return this.searchDocument(sessionId, attachmentId, options, true);
  }
  private readDocument(sessionId: string, id: string, options: DocumentReadOptions, admitted = false) {
    return documentPage(this.documentData(this.scopedDocument(sessionId, id, admitted)), options);
  }
  private searchDocument(sessionId: string, id: string, options: DocumentSearchOptions, admitted = false) {
    return documentSearch(this.documentData(this.scopedDocument(sessionId, id, admitted)), options);
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
  private async github(session: Session, input: string, access: AttachmentAccess): Promise<Capture> {
    if (access === "auto") {
      try { return await this.github(session, input, "gh-cli"); }
      catch (error) {
        if (!(error instanceof MoguriError) || error.code !== "github_cli_unavailable") throw error;
        const capture = await this.github(session, input, "public");
        capture.preview.excluded.push({ path: "GitHub CLI access", reason: "The CLI account could not read this reference. This snapshot uses only the public GitHub API." });
        return capture;
      }
    }
    const root = session.projectId ? this.host.project({ projectId: session.projectId, workspaceId: session.controls.env === "Local" ? session.workspaceId : null }) : undefined;
    const short = input.match(/^#?(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#)?([1-9]\d*)$/);
    if (short) {
      let repository = short[1];
      if (!repository) {
        if (!root) throw new MoguriError("attachment_github", "Without a project, use OWNER/REPO#NUMBER.");
        const metadata = await this.projects.gitView(root, false, AbortSignal.timeout(10_000));
        repository = metadata.repository?.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)?.[1];
        if (!repository) throw new MoguriError("attachment_github", "This project has no configured GitHub repository. Use OWNER/REPO#NUMBER explicitly.");
      }
      input = `https://github.com/${repository}/issues/${short[2]}`;
    }
    const remoteFile = input.match(/^@?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(.+)$/);
    if (remoteFile) return this.githubFile(remoteFile[1]!, remoteFile[2]!, access, root?.path ?? this.stateDir);
    let url: URL;
    try { url = new URL(input); } catch { throw new MoguriError("attachment_github", "Use an exact https://github.com/OWNER/REPO/issues/NUMBER or /pull/NUMBER URL."); }
    const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9]\d*)\/?$/);
    if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || !match || !Number.isSafeInteger(Number(match[3]))) throw new MoguriError("attachment_github", "Choose a canonical GitHub issue/PR URL without query, fragment or credentials.");
    const canonical = `https://github.com/${match[1]}/${match[2]}/${match[3]}`;
    const result = await this.integrations.githubRead(`repos/${match[1]}/${match[2] === "pull" ? "pulls" : "issues"}/${match[3]}`, access, root?.path ?? this.stateDir, AbortSignal.timeout(20_000));
    if (short && match[2] === "issues" && isRecord(result) && result.number === Number(match[3]) && result.pull_request !== undefined && result.html_url === `https://github.com/${match[1]}/pull/${match[3]}`) return this.github(session, result.html_url, access);
    if (!isRecord(result) || result.number !== Number(match[3]) || result.html_url !== canonical || typeof result.title !== "string" || typeof result.updated_at !== "string" || !Number.isFinite(Date.parse(result.updated_at)) || result.body !== null && typeof result.body !== "string") throw new MoguriError("attachment_github", "GitHub did not verify this exact reference and revision. Nothing was attached.");
    if (match[2] === "issues" && result.pull_request !== undefined) {
      if (short) return this.github(session, `https://github.com/${match[1]}/pull/${match[3]}`, access);
      throw new MoguriError("attachment_github", "This reference is a pull request. Select its /pull/ URL so its type is explicit.");
    }
    const text = JSON.stringify({ url: canonical, repository: match[1], number: result.number, type: match[2] === "pull" ? "pull-request" : "issue", title: stripMarkdownComments(result.title), body: stripMarkdownComments(result.body ?? ""), state: result.state, updatedAt: result.updated_at }, null, 2);
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_TEXT_BYTES) throw new MoguriError("attachment_reference_limit", "This reference exceeds 2 MiB; no content was silently truncated.");
    return { text, preview: { kind: match[2] === "pull" ? "github_pr" : "github_issue", label: `${match[1]}#${result.number} (${match[2] === "pull" ? "PR" : "issue"})`, bytes, digest: digest(text), files: [], excluded: [], text, source: { kind: access === "gh-cli" ? "github-cli" : "github-public", location: canonical, revision: result.updated_at } } };
  }
  private async githubFile(repository: string, path: string, access: "public" | "gh-cli", root: string): Promise<Capture> {
    if (!path.isWellFormed() || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..") ||
      /[\\\0\r\n?#]/.test(path) || isProtectedProjectPath(path)) throw new MoguriError("attachment_github", "Choose an unprotected exact GitHub file path without traversal, query or fragment.");
    const encoded = path.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
    const result = await this.integrations.githubRead(`repos/${repository}/contents/${encoded}`, access, root, AbortSignal.timeout(20_000));
    if (!isRecord(result) || result.type !== "file" || result.path !== path || result.encoding !== "base64" || typeof result.content !== "string" ||
      typeof result.sha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.sha) || typeof result.size !== "number" || result.size > 128 * 1024 ||
      typeof result.html_url !== "string") throw new MoguriError("attachment_github", "GitHub did not return this exact regular file within the 128-KiB text limit. No directory, binary conversion or truncated file was attached.");
    const encodedContent = result.content.replace(/[\r\n]/g, ""), data = Buffer.from(encodedContent, "base64");
    let location: URL;
    try { location = new URL(result.html_url); } catch { throw new MoguriError("attachment_github", "GitHub file provenance is invalid."); }
    if (data.toString("base64") !== encodedContent || data.length !== result.size || data.includes(0) || !isUtf8(data) ||
      createHash(result.sha.length === 40 ? "sha1" : "sha256").update(`blob ${data.length}\0`).update(data).digest("hex") !== result.sha ||
      location.origin !== "https://github.com" || location.username || location.password || location.search || location.hash ||
      !location.pathname.startsWith(`/${repository}/blob/`) || !location.pathname.endsWith(`/${encoded}`)) throw new MoguriError("attachment_github", "GitHub file bytes, encoding, revision or provenance did not match. Nothing was attached.");
    const text = data.toString("utf8");
    return { text, preview: { kind: "github_file", label: `${repository}/${path}`, bytes: data.length, digest: digest(text), files: [{ path, bytes: data.length, digest: digest(text) }], excluded: [], text,
      source: { kind: access === "gh-cli" ? "github-cli" : "github-public", location: location.href, revision: result.sha } } };
  }
  private reviewed(sessionId: string, captured: Capture): ContextPreview {
    const session = this.session(sessionId, false), snapshot = this.host.snapshot(), remote = snapshot.settings.values.remote;
    const destination: ContextPreview["destination"] = {
      sessionId, env: session.controls.env, modelId: session.controls.modelId,
      target: session.controls.env === "Remote" ? remote ? `${remote.name} (${remote.host}:${remote.port}), not SendBox-isolated` : "Unconfigured SSH host" : session.controls.env === "Local" ? "Local host and explicitly selected provider" : "Configured SendBox workload",
    };
    const { text: _, ...source } = captured.preview;
    return { ...captured.preview, destination, digest: digest(JSON.stringify({ source, destination, revision: session.revision, remote: session.controls.env === "Remote" ? remote : null, localModels: snapshot.settings.values.localModels })) };
  }
  async query(query: InputQuery): Promise<InputResponse> {
    const session = this.session(query.sessionId, false);
    if (query.type === "attachment.local.path") {
      if (!isAbsolute(query.path) || this.protectedClientPath(query.path)) throw new MoguriError("attachment_path", "Choose an absolute, unprotected Local file or folder.");
      const info = await lstat(query.path), folder = info.isDirectory();
      return { type: query.type, path: await this.clientPath(query.path, folder), kind: folder ? "folder" : "file" };
    }
    if (query.type === "attachment.project.path") {
      const root = this.host.project({ projectId: query.projectId, workspaceId: session.projectId === query.projectId && session.controls.env === "Local" ? session.workspaceId : null });
      const path = query.path.replace(/\/+$/, "") || ".";
      await assertFolderAccess(root.path, path, false, folderPolicy(this.projects.configuration(root.id).values));
      const selected = path === "." ? await realpath(root.path) : await scopedPath(root.path, path), folder = (await lstat(selected)).isDirectory();
      return { type: query.type, path: await this.clientPath(selected, folder), kind: folder ? "folder" : "file" };
    }
    if (query.type === "attachment.document.list") {
      const { sessionId, type, ...options } = query;
      return { type, result: this.listDocuments(sessionId, options) };
    }
    if (query.type === "attachment.document.read") {
      const { sessionId, attachmentId, type, ...options } = query;
      return { type, page: this.readDocument(sessionId, attachmentId, options) };
    }
    if (query.type === "attachment.document.search") {
      const { sessionId, attachmentId, type, ...options } = query;
      return { type, result: this.searchDocument(sessionId, attachmentId, options) };
    }
    if (query.type === "attachment.document.original") {
      const attachment = this.scopedDocument(query.sessionId, query.attachmentId, false), data = this.store.blob(attachment.originalDigest);
      if (digest(data) !== attachment.originalDigest || Buffer.from(data, "base64").length !== attachment.bytes || Buffer.from(data, "base64").toString("base64") !== data) throw new MoguriError("attachment_integrity", "The exact retained document original is unavailable or corrupt. No host file was reopened.", 409);
      return { type: query.type, attachment, data };
    }
    if (query.type === "attachment.folder.preview") return { type: query.type, preview: this.reviewed(query.sessionId, await this.folder(query.path)) };
    if (query.type === "attachment.github.preview") return { type: query.type, preview: this.reviewed(query.sessionId, await this.github(this.session(query.sessionId), query.url, query.access)) };
    if (query.type === "attachment.session.preview") return { type: query.type, preview: this.reviewed(query.sessionId, this.sessionCapture(query.sourceSessionId)) };
    const attachment = this.retainedAttachments(query.sessionId).find((attachment) => attachment.id === query.attachmentId);
    if (!attachment) throw new MoguriError("attachment_scope", "This attachment has no content grant in the selected session.");
    if (attachment.kind === "document") return { type: query.type, attachment, content: { kind: "document", summary: this.documentData(attachment).summary } };
    const original = this.store.blob(attachment.digest);
    if (attachment.kind === "image") return { type: query.type, attachment, content: { kind: "image", data: original, mimeType: attachment.mimeType } };
    const content = attachment.kind === "github_issue" || attachment.kind === "github_pr" ? workItemSnapshotView(original) : original;
    return { type: query.type, attachment, content: { kind: "text", text: content, ...(content !== original ? {
      filter: { kind: "work-item-comments-v1", sourceDigest: attachment.digest, viewDigest: digest(content), viewBytes: Buffer.byteLength(content) },
    } : {}) } };
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
    if (command.type === "attachment.document.cancel") {
      this.session(command.sessionId, false);
      const capture = this.captures.get(`${command.sessionId}\0${command.captureId}`);
      if (!capture) throw new MoguriError("document_capture", "This exact capture is not active. Inspect the saved draft; no other capture was stopped or replayed.", 409);
      capture.abort.abort();
      return finish([], { id: command.captureId });
    }
    const session = this.session(command.sessionId);
    if (session.draft.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "The destination draft changed. Your selection is preserved; review the current draft.", 409);
    if (command.type === "attachment.file.add" && command.mode !== "image" && (command.mode === "document" || [".pdf", ".docx", ".xlsx"].includes(extname(command.path).toLowerCase()))) return this.captureDocument(command, finish);
    let attachment: Attachment;
    if (command.type === "attachment.image.add") {
      const data = Buffer.from(command.data, "base64");
      if (data.toString("base64") !== command.data) throw new MoguriError("attachment_image", "Image data must be canonical base64.");
      attachment = await this.image(data, command.name, { kind: "clipboard", location: "explicit clipboard image" });
    } else if (command.type === "attachment.file.add") {
      const path = await this.clientPath(command.path);
      if (command.mode === "image" || command.mode === "auto" && /\.(png|jpe?g|webp)$/i.test(path)) attachment = await this.image(await readRegularFile(path, MAX_IMAGE_BYTES), basename(path), { kind: "client-file", location: path });
      else {
        const file = await readProjectFile(dirname(path), basename(path));
        attachment = { id: randomUUID(), kind: "local_file", path: basename(path), digest: this.store.putBlob(file.text), bytes: file.bytes, source: { kind: "client-file", location: path, revision: file.digest } };
      }
    } else {
      const captured = command.type === "attachment.folder.add" ? await this.folder(command.path) : command.type === "attachment.github.add" ? await this.github(session, command.url, command.access) : this.sessionCapture(command.sourceSessionId);
      if (this.reviewed(session.id, captured).digest !== command.expectedDigest) throw new MoguriError("attachment_stale", "The source or destination changed after preview. Review its exact current snapshot and transfer scope before attaching.", 409);
      attachment = { id: randomUUID(), kind: captured.preview.kind, path: captured.preview.label, digest: this.store.putBlob(captured.text), bytes: captured.preview.bytes, source: captured.preview.source };
    }
    return this.attach(session.id, command.expectedRevision, attachment, finish);
  }
  private attach(sessionId: string, expectedRevision: number, attachment: Attachment, finish: WorkspaceFinish) {
    const current = this.session(sessionId);
    if (current.draft.revision !== expectedRevision) throw new MoguriError("revision_conflict", "The draft changed during capture. No attachment was silently substituted.", 409);
    const attachments = [...current.draft.attachments, attachment];
    if (attachments.length > 16 || attachments.reduce((total, attachment) => total + attachmentBytes(attachment), 0) > 12 * 1024 * 1024) throw new MoguriError("attachment_limit", "Use at most 16 attachments and 12 MiB of original plus extracted content. The draft was preserved.");
    return finish([{ event_type: "draft.saved", profile_id: this.host.snapshot().profileId, project_id: current.projectId, session_id: current.id, payload: { text: current.draft.text, attachments } }], { id: attachment.id, revision: current.draft.revision + 1 });
  }
  private captureDocument(command: Extract<InputCommand, { type: "attachment.file.add" }>, finish: WorkspaceFinish): Promise<CommandResult> {
    const format = extname(command.path).slice(1).toLowerCase();
    if (format !== "pdf" && format !== "docx" && format !== "xlsx") throw new MoguriError("document_format", "Select a .pdf, .docx or .xlsx document; content validation is also required.");
    const key = `${command.sessionId}\0${command.captureId ?? randomUUID()}`, abort = new AbortController();
    if (this.closing || this.captures.has(key)) throw new MoguriError("document_capture", "This capture is already active or the service is stopping. The draft was preserved.", 409);
    const done = Promise.resolve().then(async () => {
      abort.signal.throwIfAborted();
      let source: { path: string; bytes: Buffer } | undefined;
      const { document } = await this.parsers.capture(key, async () => {
        try {
          const path = await this.clientPath(command.path), bytes = await readRegularFile(path, DOCUMENT_LIMITS.originalBytes);
          source = { path, bytes }; return bytes;
        } catch (error) {
          if (error instanceof MoguriError) throw error;
          const code = error instanceof Error && "code" in error ? String(error.code) : "read_failed";
          throw new MoguriError("document_read", `The selected document could not be read (${code}). Check its availability/access and select it explicitly again. The complete draft was preserved.`);
        }
      }, format, abort.signal);
      abort.signal.throwIfAborted();
      if (!source) throw new MoguriError("document_read", "The exact source snapshot was not retained by its bounded capture. No substitute file was read.");
      const { path, bytes } = source;
      this.sourcePolicy(path);
      const current = this.session(command.sessionId), extraction = JSON.stringify(document), original = bytes.toString("base64");
      if (current.draft.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "The draft changed during document extraction. No attachment or text was substituted.", 409);
      const attachment: DocumentAttachment = { id: randomUUID(), path: basename(path), kind: "document", format, bytes: bytes.length, extractedBytes: Buffer.byteLength(extraction),
        digest: digest(extraction), originalDigest: digest(original), summary: document.summary, source: { kind: "client-file", location: path, revision: digest(original) } };
      if (current.draft.attachments.length >= 16 || current.draft.attachments.reduce((total, item) => total + attachmentBytes(item), attachmentBytes(attachment)) > 12 * 1024 * 1024) throw new MoguriError("attachment_limit", "Use at most 16 attachments and 12 MiB of originals plus extraction. The draft was preserved.");
      this.store.putBlob(extraction); this.store.putBlob(original);
      return this.attach(command.sessionId, command.expectedRevision, attachment, finish);
    }).catch((error: unknown) => {
      if (abort.signal.aborted) throw new MoguriError("document_cancelled", "Document capture was cancelled. The complete draft was preserved.", 409);
      throw error;
    }).finally(() => this.captures.delete(key));
    this.captures.set(key, { sessionId: command.sessionId, abort, done });
    return done;
  }
  stopSession(id: string): void { for (const capture of this.captures.values()) if (capture.sessionId === id) capture.abort.abort(); }
  async settleSession(id: string): Promise<void> { this.stopSession(id); await Promise.allSettled([...this.captures.values()].filter((capture) => capture.sessionId === id).map((capture) => capture.done)); }
  async close(): Promise<void> {
    this.closing = true;
    for (const capture of this.captures.values()) capture.abort.abort();
    await Promise.allSettled([...this.captures.values()].map((capture) => capture.done)); await this.parsers.close();
  }
}
