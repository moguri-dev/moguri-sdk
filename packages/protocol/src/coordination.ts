import { Type, type Static } from "typebox";
import { ModelAdviceSourceSchema, type ModelAdviceSource } from "./questions.ts";
import type { UserQuestion } from "./questions.ts";
import type { Session } from "./index.ts";
import type { TaskPlan } from "./progress.ts";
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export type CoordinationOrigin = { actor: "user" | "service" } | ModelAdviceSource;
export const CoordinationOriginSchema = Type.Union([
  object({ actor: Type.Literal("user") }), object({ actor: Type.Literal("service") }),
  ModelAdviceSourceSchema,
]);
export const CoordinationLinkSchema = object({ parentId: id, childId: id, parentScope: hash, childScope: hash, enabled: Type.Boolean(), revision: Type.Integer({ minimum: 0 }), origin: CoordinationOriginSchema, kind: Type.Optional(Type.Literal("peer")) });
export const CoordinationMessageSchema = object({
  id, fromSessionId: id, toSessionId: id, fromTurnId: Type.Union([id, Type.Null()]), origin: CoordinationOriginSchema,
  bindingDigest: Type.Optional(hash),
  text: Type.String({ minLength: 1, maxLength: 8000 }), kind: Type.Union([Type.Literal("message"), Type.Literal("task"), Type.Literal("result")]),
  deliveredTo: Type.Union([object({ turnId: id, stepId: id }), Type.Null()]),
});
export interface CoordinationLink {
  parentId: string; childId: string; parentScope: string; childScope: string;
  enabled: boolean; revision: number; origin: CoordinationOrigin;
  kind?: "peer";
}
export interface CoordinationMessage {
  id: string; fromSessionId: string; toSessionId: string; fromTurnId: string | null;
  origin: CoordinationOrigin; text: string; kind: "message" | "task" | "result";
  deliveredTo: { turnId: string; stepId: string } | null;
  bindingDigest?: string;
}
export interface CoordinationTaskOrigin { messageId: string; fromSessionId: string; fromTurnId: string | null; origin: CoordinationOrigin }
export const SessionContextSchema = object({
  action: Type.Union([Type.Literal("list"), Type.Literal("inspect"), Type.Literal("transcript"), Type.Literal("inbox"), Type.Literal("snapshot")]),
  targetSessionId: Type.Optional(id), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 16 * 1024 * 1024 })),
  expectedDigest: Type.Optional(hash),
});
export const SessionMessageSchema = object({ targetSessionId: id, text: Type.String({ minLength: 1, maxLength: 8000 }) });
export const SessionControlSchema = object({
  action: Type.Union([Type.Literal("dispatch"), Type.Literal("stop"), Type.Literal("hold"), Type.Literal("resume"), Type.Literal("spawn")]),
  targetSessionId: Type.Optional(id), text: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
  expectedTurnId: Type.Optional(Type.Union([id, Type.Null()])),
  kind: Type.Optional(Type.Union([Type.Literal("side"), Type.Literal("agent")])), title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
});
export const WaitSessionSchema = object({ targetSessionId: id, timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 30000 })) });
export const CoordinationQuerySchema = Type.Union([
  object({ type: Type.Literal("coordination.preview"), sessionId: id, childId: id }),
  object({ type: Type.Literal("coordination.read"), sessionId: id, input: SessionContextSchema }),
]);
export const CoordinationCommandSchema = Type.Union([
  object({ type: Type.Literal("coordination.grant"), sessionId: id, childId: id, expectedDigest: hash, enabled: Type.Boolean(), confirm: Type.Literal(true) }),
  object({ type: Type.Literal("coordination.message"), sessionId: id, input: SessionMessageSchema }),
  object({ type: Type.Literal("coordination.control"), sessionId: id, input: SessionControlSchema }),
]);
export type CoordinationQuery = Static<typeof CoordinationQuerySchema>;
export type CoordinationCommand = Static<typeof CoordinationCommandSchema>;
export type SessionContextInput = Static<typeof SessionContextSchema>;
export type SessionControlInput = Static<typeof SessionControlSchema>;
export type CoordinationMetadata = Pick<Session, "id" | "title" | "kind" | "mode" | "projectId" | "workspaceId" | "status" | "turnId" | "lastError"> & {
  env: Session["controls"]["env"]; queued: number; needsInput: boolean;
};
export type CoordinationBinding = {
  profileId: string; projectId: string | null; workspaceId: string | null;
} & ({ env: "Local"; root: string | null; fileIdentity: { device: string; inode: string } | null; repositories?: import("./sessions.ts").SessionRepository[] } |
  { env: "Remote"; root: string | null; host: string; port: number; user: string; hostKey: string; workerDigest: string });
export type CoordinationRead =
  | { action: "list"; links: (CoordinationLink & ({ parent: CoordinationMetadata; child: CoordinationMetadata } | { unavailable: string }))[]; nextOffset: number | null; authority: string }
  | { action: "inbox"; messages: (CoordinationMessage & { deliveryDiagnostic?: string })[]; nextOffset: number | null; limit: number }
  | (CoordinationMetadata & { action: "inspect"; plan: TaskPlan | null; question: UserQuestion | null; approval: { id: string; name: string; argumentsDigest: string } | null; authority: string })
  | { action: "snapshot" | "transcript"; text: string; bytes: number; offset: number; nextOffset: number | null; eof: boolean; digest: string; sourceSessionId: string; authority: string };
export type CoordinationResponse =
  | { type: "coordination.preview"; digest: string; link: CoordinationLink | null; parentScope: string; childScope: string; parentBinding: CoordinationBinding; childBinding: CoordinationBinding; kind?: "peer" }
  | { type: "coordination.read"; data: CoordinationRead };
