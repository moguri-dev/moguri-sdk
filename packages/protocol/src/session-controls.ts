import { Type, type Static } from "typebox";
import type { Session } from "./index.ts";

const id = Type.String({ minLength: 1, maxLength: 128 });
const revision = Type.Integer({ minimum: 0 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const SessionWaitSchema = object({
  version: Type.Literal(1), id, profileId: id, sessionId: id, targetSessionId: id,
  sourceScope: hash, targetScope: hash,
  task: Type.Union([object({ kind: Type.Literal("turn"), id }), object({ kind: Type.Literal("queue"), id })]),
  status: Type.Union([Type.Literal("waiting"), Type.Literal("released"), Type.Literal("blocked"), Type.Literal("cancelled")]),
  revision, actor: Type.Literal("user"), createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }),
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
});
export type SessionWait = Static<typeof SessionWaitSchema>;
export const sessionWaiting = (session: Pick<Session, "wait">): boolean => session.wait?.status === "waiting" || session.wait?.status === "blocked";
export const BulkSessionActionSchema = Type.Union([Type.Literal("attach"), Type.Literal("detach"), Type.Literal("archive"), Type.Literal("delete")]);
export type BulkSessionAction = Static<typeof BulkSessionActionSchema>;
export const BulkSessionInputSchema = object({
  action: BulkSessionActionSchema,
  sessionIds: Type.Array(id, { minItems: 2, maxItems: 100, uniqueItems: true }),
  targetSessionId: Type.Optional(id),
  children: Type.Optional(Type.Union([Type.Literal("cascade"), Type.Literal("detach")])),
});
export type BulkSessionInput = Static<typeof BulkSessionInputSchema>;
export interface BulkSessionPreview {
  digest: string; input: BulkSessionInput;
  selected: Pick<Session, "id" | "title" | "revision" | "projectId" | "status" | "parentSessionId">[];
  roots: string[];
  descendants: { sessionId: string; parentSessionId: string; title: string }[];
}
export interface SessionWaitPreview {
  digest: string; sessionId: string; targetSessionId: string;
  task: SessionWait["task"]; sourceScope: string; targetScope: string;
}
export const SessionControlsQuerySchema = Type.Union([
  object({ type: Type.Literal("session.wait.preview"), sessionId: id, targetSessionId: id }),
  object({ type: Type.Literal("sessions.bulk.preview"), input: BulkSessionInputSchema }),
]);
export const SessionControlsCommandSchema = Type.Union([
  object({ type: Type.Literal("session.wait"), sessionId: id, targetSessionId: id, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("session.wait.cancel"), sessionId: id, waitId: id, expectedRevision: revision }),
  object({ type: Type.Literal("sessions.bulk"), input: BulkSessionInputSchema, expectedDigest: hash, confirm: Type.Literal(true) }),
]);
export type SessionControlsQuery = Static<typeof SessionControlsQuerySchema>;
export type SessionControlsCommand = Static<typeof SessionControlsCommandSchema>;
export type SessionControlsResponse =
  | { type: "session.wait.preview"; preview: SessionWaitPreview }
  | { type: "sessions.bulk.preview"; preview: BulkSessionPreview };
