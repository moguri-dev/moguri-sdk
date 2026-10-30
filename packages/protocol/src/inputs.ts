import { Type, type Static } from "typebox";
import { DOCUMENT_LIMITS, DocumentFormatSchema, DocumentSummarySchema, DocumentReadOptionsSchema, DocumentSearchOptionsSchema, DocumentListOptionsSchema, type DocumentSummary, type DocumentPage, type DocumentSearch } from "./documents.ts";
export * from "./documents.ts";
const id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const base = { id, path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 8 * 1024 * 1024 }) };
const source = Type.Object({ kind: Type.String({ maxLength: 40 }), location: path, revision: Type.String({ maxLength: 256 }) }, { additionalProperties: false });
export const PASTE_FILE_PREFIX = "moguri-attachment/";
export const pasteLineCount = (text: string): number => text.split(/\r\n|\r|\n/).length;
export const pasteFilePath = (attachmentId: string): string => `${PASTE_FILE_PREFIX}${attachmentId}.txt`;
export const isPasteFilePath = (path: string): boolean => path.startsWith(PASTE_FILE_PREFIX);
export const AttachmentSchema = Type.Union([
  Type.Object({ ...base, kind: Type.Literal("document"), format: DocumentFormatSchema, originalDigest: hash,
    extractedBytes: Type.Integer({ minimum: 1, maximum: DOCUMENT_LIMITS.outputBytes }), summary: DocumentSummarySchema, source }, { additionalProperties: false }),
  Type.Object({ ...base, bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }), kind: Type.Literal("project_file") }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("local_file"), source }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("paste_file"), bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }), lines: Type.Integer({ minimum: 51, maximum: 131073 }), source }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("image"), mimeType: Type.Literal("image/png"), width: Type.Integer({ minimum: 1, maximum: 16000 }), height: Type.Integer({ minimum: 1, maximum: 16000 }), source }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Union([Type.Literal("folder"), Type.Literal("github_issue"), Type.Literal("github_pr"), Type.Literal("github_file"), Type.Literal("session")]), source }, { additionalProperties: false }),
]);
export type Attachment = Static<typeof AttachmentSchema>;
export type DocumentAttachment = Extract<Attachment, { kind: "document" }>;
export interface DocumentDescriptor {
  attachmentId: string; name: string; format: DocumentAttachment["format"]; digest: string; originalBytes: number; extractedBytes: number; summary: DocumentSummary;
}
export interface DocumentList { boundary: "scoped-controller-snapshot"; untrusted: true; documents: DocumentDescriptor[]; nextOffset: number | null }
export const documentDescriptor = (attachment: DocumentAttachment): DocumentDescriptor => ({
  attachmentId: attachment.id, name: attachment.path, format: attachment.format, digest: attachment.digest, originalBytes: attachment.bytes, extractedBytes: attachment.extractedBytes, summary: attachment.summary,
});
export const attachmentBytes = (attachment: Attachment): number => attachment.bytes + (attachment.kind === "document" ? attachment.extractedBytes : 0);
export const attachmentDigests = (attachment: Attachment): string[] => attachment.kind === "document" ? [attachment.digest, attachment.originalDigest] : [attachment.digest];
export const isDocumentTool = (name: string): boolean => name === "read_document" || name === "search_document" || name === "list_documents";
export const DocumentListToolSchema = DocumentListOptionsSchema;
export const DocumentReadToolSchema = Type.Object({ attachmentId: id, ...DocumentReadOptionsSchema.properties }, { additionalProperties: false });
export const DocumentSearchToolSchema = Type.Object({ attachmentId: id, ...DocumentSearchOptionsSchema.properties }, { additionalProperties: false });
const scope = { sessionId: id, expectedRevision: revision };
const access = Type.Union([Type.Literal("public"), Type.Literal("gh-cli"), Type.Literal("auto")]);
export type AttachmentAccess = Static<typeof access>;
export const InputCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("attachment.file.add"), ...scope, path, mode: Type.Union([Type.Literal("text"), Type.Literal("image"), Type.Literal("document"), Type.Literal("auto")]), captureId: Type.Optional(id) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.document.cancel"), sessionId: id, captureId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.image.add"), ...scope, data: Type.String({ minLength: 1, maxLength: 12 * 1024 * 1024 }), name: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.folder.add"), ...scope, path, expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.github.add"), ...scope, url: Type.String({ minLength: 1, maxLength: 2048 }), access, expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.session.add"), ...scope, sourceSessionId: id, expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
]);
export type InputCommand = Static<typeof InputCommandSchema>;
export const InputQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("attachment.project.path"), sessionId: id, projectId: id, path }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.local.path"), sessionId: id, path }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.document.list"), sessionId: id, ...DocumentListOptionsSchema.properties }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.document.read"), sessionId: id, attachmentId: id, ...DocumentReadOptionsSchema.properties }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.document.search"), sessionId: id, attachmentId: id, ...DocumentSearchOptionsSchema.properties }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.document.original"), sessionId: id, attachmentId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.folder.preview"), sessionId: id, path }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.github.preview"), sessionId: id, url: Type.String({ minLength: 1, maxLength: 2048 }), access }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.session.preview"), sessionId: id, sourceSessionId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.read"), sessionId: id, attachmentId: id }, { additionalProperties: false }),
]);
export type InputQuery = Static<typeof InputQuerySchema>;
export interface ContextPreview {
  kind: "folder" | "github_issue" | "github_pr" | "github_file" | "session"; label: string; bytes: number; digest: string;
  source: { kind: string; location: string; revision: string };
  files: { path: string; bytes: number; digest: string }[];
  excluded: { path: string; reason: string }[];
  text?: string;
  destination: { sessionId: string; env: "Local" | "Sandbox" | "Remote"; target: string; modelId: string | null };
}
export type InputResponse =
  | { type: "attachment.project.path"; path: string; kind: "file" | "folder" }
  | { type: "attachment.local.path"; path: string; kind: "file" | "folder" }
  | { type: "attachment.document.list"; result: DocumentList }
  | { type: "attachment.document.read"; page: DocumentPage }
  | { type: "attachment.document.search"; result: DocumentSearch }
  | { type: "attachment.document.original"; attachment: DocumentAttachment; data: string }
  | { type: "attachment.folder.preview"; preview: ContextPreview }
  | { type: "attachment.github.preview"; preview: ContextPreview }
  | { type: "attachment.session.preview"; preview: ContextPreview }
  | { type: "attachment.read"; attachment: Attachment; content: { kind: "text"; text: string; filter?: { kind: "work-item-comments-v1"; sourceDigest: string; viewDigest: string; viewBytes: number } } | { kind: "image"; data: string; mimeType: "image/png" } | { kind: "document"; summary: DocumentSummary } };
