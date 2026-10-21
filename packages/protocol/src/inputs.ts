import { Type, type Static } from "typebox";
const id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const base = { id, path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 8 * 1024 * 1024 }) };
const source = Type.Object({ kind: Type.String({ maxLength: 40 }), location: path, revision: Type.String({ maxLength: 256 }) }, { additionalProperties: false });
export const AttachmentSchema = Type.Union([
  Type.Object({ ...base, bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }), kind: Type.Literal("project_file") }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("local_file"), source }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal("image"), mimeType: Type.Literal("image/png"), width: Type.Integer({ minimum: 1, maximum: 16000 }), height: Type.Integer({ minimum: 1, maximum: 16000 }), source }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Union([Type.Literal("folder"), Type.Literal("github_issue"), Type.Literal("github_pr"), Type.Literal("session")]), source }, { additionalProperties: false }),
]);
export type Attachment = Static<typeof AttachmentSchema>;
const scope = { sessionId: id, expectedRevision: revision };
const access = Type.Union([Type.Literal("public"), Type.Literal("gh-cli")]);
export const InputCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("attachment.file.add"), ...scope, path, mode: Type.Union([Type.Literal("text"), Type.Literal("image")]) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.image.add"), ...scope, data: Type.String({ minLength: 1, maxLength: 12 * 1024 * 1024 }), name: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.folder.add"), ...scope, path, expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.github.add"), ...scope, url: Type.String({ minLength: 1, maxLength: 2048 }), access, expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.session.add"), ...scope, sourceSessionId: id, expectedDigest: hash, confirm: Type.Literal(true) }, { additionalProperties: false }),
]);
export type InputCommand = Static<typeof InputCommandSchema>;
export const InputQuerySchema = Type.Union([
  Type.Object({ type: Type.Literal("attachment.folder.preview"), sessionId: id, path }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.github.preview"), sessionId: id, url: Type.String({ minLength: 1, maxLength: 2048 }), access }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.session.preview"), sessionId: id, sourceSessionId: id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("attachment.read"), sessionId: id, attachmentId: id }, { additionalProperties: false }),
]);
export type InputQuery = Static<typeof InputQuerySchema>;
export interface ContextPreview {
  kind: "folder" | "github_issue" | "github_pr" | "session"; label: string; bytes: number; digest: string;
  source: { kind: string; location: string; revision: string };
  files: { path: string; bytes: number; digest: string }[];
  excluded: { path: string; reason: string }[];
  text?: string;
  destination: { sessionId: string; env: "Local" | "Sandbox" | "Remote"; target: string; modelId: string | null };
}
export type InputResponse =
  | { type: "attachment.folder.preview"; preview: ContextPreview }
  | { type: "attachment.github.preview"; preview: ContextPreview }
  | { type: "attachment.session.preview"; preview: ContextPreview }
  | { type: "attachment.read"; attachment: Attachment; content: { kind: "text"; text: string } | { kind: "image"; data: string; mimeType: "image/png" } };
