import { Type, type Static, type TSchema } from "typebox";
import { LocalEndpointSchema } from "./providers.ts";
import { Value } from "typebox/value";
import { RemoteMcpGrantSchema } from "./mcp.ts";
import type { RemoteTerminalBuild } from "./terminals.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
export const RemoteTargetSchema = object({
  id: Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  host: Type.String({ minLength: 1, maxLength: 253 }),
  port: Type.Integer({ minimum: 1, maximum: 65535 }),
  user: Type.String({ minLength: 1, maxLength: 128 }),
  hostKey: Type.String({ minLength: 20, maxLength: 4096 }),
  identityFile: path,
  stateDir: path,
  command: Type.Array(path, { minItems: 1, maxItems: 8 }),
  allowCopilot: Type.Boolean(),
  mcpGrants: Type.Optional(Type.Array(RemoteMcpGrantSchema, { maxItems: 32 })),
  models: Type.Array(LocalEndpointSchema, { maxItems: 8 }),
});
export type RemoteTarget = Static<typeof RemoteTargetSchema>;
export const RemoteIdentitySchema = Type.Pick(RemoteTargetSchema, ["id", "name", "host", "port", "user", "hostKey", "identityFile", "stateDir", "command"]);
export type RemoteIdentity = Pick<RemoteTarget, "id" | "name" | "host" | "port" | "user" | "hostKey" | "identityFile" | "stateDir" | "command">;
export interface RemoteReadiness {
  ready: boolean; diagnostic: string; configDigest: string | null; hostFingerprint: string | null;
  nodeVersion: string | null; platform: string | null; workerDigest: string | null;
  terminalBuild?: RemoteTerminalBuild;
  terminalDiagnostic?: string;
}
export interface RemoteExecution {
  id: string; sessionId: string; projectId: string | null; turnId: string; target: RemoteIdentity;
  workspace: string | null; workerDigest: string; configDigest: string; createdAt: string;
  status: "launching" | "running" | "stopping" | "completed" | "stopped" | "failed" | "partial" | "unconfirmed";
  cancellation: "none" | "requested" | "acknowledged" | "unconfirmed";
  cleanup: "pending" | "owned-worker-stopped" | "unconfirmed" | "acknowledged";
  diagnostic: string | null; lastSequence: number; workerPid: number | null;
}
export const ExecutionCommandSchema = Type.Union([
  object({ type: Type.Literal("remote.probe") }),
  object({ type: Type.Literal("remote.reconcile"), executionId: id }),
  object({ type: Type.Literal("remote.acknowledge"), executionId: id, confirmInspection: Type.Literal(true) }),
  object({ type: Type.Literal("remote.model-token.set"), endpointId: id, token: Type.String({ minLength: 1, maxLength: 32768 }) }),
  object({ type: Type.Literal("remote.model-token.clear"), endpointId: id }),
]);
export type ExecutionCommand = Static<typeof ExecutionCommandSchema>;
export const isExecutionCommand = (value: unknown): value is ExecutionCommand => Value.Check(ExecutionCommandSchema, value);
export const ExecutionQuerySchema = object({ type: Type.Literal("remote.status") });
export type ExecutionQuery = Static<typeof ExecutionQuerySchema>;
export const isExecutionQuery = (value: unknown): value is ExecutionQuery => Value.Check(ExecutionQuerySchema, value);
export type ExecutionResponse = { type: "remote.status"; remote: RemoteReadiness };
