import { Type, type Static } from "typebox";
import { TaskPlanStepsSchema } from "./progress.ts";
import { GithubIssueCreateActionSchema } from "./github-workflows.ts";
import { LinearIssueCreateInputSchema } from "./linear-workflows.ts";
import { DocumentReadOptionsSchema, DocumentSearchOptionsSchema } from "./documents.ts";
import type { CapabilityJob } from "./platform.ts";
const path = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const scalar = Type.Union([Type.String({ maxLength: 32768 }), Type.Number(), Type.Boolean(), Type.Null()]);

export const EditFileSchema = object({
  path, expectedDigest: hash,
  edits: Type.Array(object({ oldText: Type.String({ minLength: 1, maxLength: 65536 }), newText: Type.String({ maxLength: 65536 }) }), { minItems: 1, maxItems: 50 }),
});
export const FindFilesSchema = object({
  pattern: Type.String({ minLength: 1, maxLength: 200 }), path: Type.Optional(path),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});
export const SearchFilesSchema = object({
  pattern: Type.String({ minLength: 1, maxLength: 1000 }), path: Type.Optional(path), glob: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  literal: Type.Optional(Type.Boolean()), ignoreCase: Type.Optional(Type.Boolean()),
  context: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export const DiffFilesSchema = object({ path: Type.Optional(path), staged: Type.Optional(Type.Boolean()), base: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) });
export const QueryDataSchema = object({
  path, format: Type.Optional(Type.Union([Type.Literal("json"), Type.Literal("yaml")])),
  expression: Type.String({ minLength: 1, maxLength: 2000 }),
});
export const ClockSchema = object({
  action: Type.Union([Type.Literal("now"), Type.Literal("wait")]),
  milliseconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
});
export const SqliteQuerySchema = object({
  path, sql: Type.String({ minLength: 1, maxLength: 16384 }), parameters: Type.Optional(Type.Array(scalar, { maxItems: 100 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});
export const SqliteTransactionSchema = object({
  path, expectedDigest: Type.Union([hash, Type.Literal("absent")]),
  statements: Type.Array(object({ sql: Type.String({ minLength: 1, maxLength: 16384 }), parameters: Type.Optional(Type.Array(scalar, { maxItems: 100 })) }), { minItems: 1, maxItems: 50 }),
});
export const StateQuerySchema = object({
  sql: Type.String({ minLength: 1, maxLength: 16384 }), parameters: Type.Optional(Type.Array(scalar, { maxItems: 100 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});
export const StateMutationSchema = object({
  expectedDigest: hash, planTitle: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  statements: Type.Array(object({ sql: Type.String({ minLength: 1, maxLength: 16384 }), parameters: Type.Optional(Type.Array(scalar, { maxItems: 100 })) }), { minItems: 1, maxItems: 50 }),
});
const todoRow = object({ id: Type.Integer({ minimum: 1, maximum: 10000 }), text: TaskPlanStepsSchema.items.properties.text, status: TaskPlanStepsSchema.items.properties.status });
const memoryRow = object({ id: Type.String({ minLength: 1, maxLength: 128 }), title: Type.String({ minLength: 1, maxLength: 160 }), text: Type.String({ minLength: 1, maxLength: 32768 }), tier: Type.Union([Type.Literal("Sky"), Type.Literal("Terra")]) });
export const StateSeedSchema = object({ todos: Type.Array(todoRow, { maxItems: 50 }), memories: Type.Array(memoryRow, { maxItems: 200 }) });
export type StateSeed = Static<typeof StateSeedSchema>;
const paragraph = object({ text: Type.String({ maxLength: 32768 }), heading: Type.Optional(Type.Integer({ minimum: 1, maximum: 6 })) });
const cell = object({
  address: Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]{0,6}$" }), value: scalar,
  formula: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  bold: Type.Optional(Type.Boolean()), numberFormat: Type.Optional(Type.String({ maxLength: 100 })),
});
export const WriteDocumentSchema = object({
  path, expectedDigest: Type.Union([hash, Type.Literal("absent")]),
  format: Type.Union([Type.Literal("pdf"), Type.Literal("docx"), Type.Literal("xlsx")]),
  paragraphs: Type.Optional(Type.Array(paragraph, { maxItems: 1000 })),
  tables: Type.Optional(Type.Array(Type.Array(Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 30 }), { maxItems: 200 }), { maxItems: 20 })),
  sheets: Type.Optional(Type.Array(object({ name: Type.String({ minLength: 1, maxLength: 31 }), cells: Type.Array(cell, { maxItems: 5000 }) }), { maxItems: 32 })),
});
export const EditDocumentSchema = object({
  path, expectedDigest: hash,
  replacements: Type.Optional(Type.Array(object({ oldText: Type.String({ minLength: 1, maxLength: 4000 }), newText: Type.String({ maxLength: 4000 }) }), { minItems: 1, maxItems: 100 })),
  sheets: Type.Optional(Type.Array(object({ name: Type.String({ minLength: 1, maxLength: 31 }), cells: Type.Array(cell, { maxItems: 5000 }) }), { maxItems: 32 })),
});
export const InspectDocumentSchema = object({
  path, expectedDigest: Type.Optional(hash), selection: Type.Optional(DocumentReadOptionsSchema), search: Type.Optional(DocumentSearchOptionsSchema),
});
export const WebSearchSchema = object({
  query: Type.String({ minLength: 1, maxLength: 1000 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});
const issueAction = Type.Union([Type.Literal("preview"), Type.Literal("create")]);
export const CreateIssueSchema = Type.Union([
  object({ service: Type.Literal("github"), action: issueAction, input: GithubIssueCreateActionSchema, expectedDigest: Type.Optional(hash),
    confirmations: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 })) }),
  object({ service: Type.Literal("linear"), action: issueAction, input: LinearIssueCreateInputSchema, expectedDigest: Type.Optional(hash) }),
]);
export const SkillToolSchema = object({ action: Type.Union([Type.Literal("find"), Type.Literal("load")]), query: Type.Optional(Type.String({ maxLength: 200 })), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })), id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), expectedDigest: Type.Optional(hash) });
export const DebugToolSchema = object({
  action: Type.Union([Type.Literal("start"), Type.Literal("request"), Type.Literal("stop")]),
  adapter: Type.Optional(path), args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 30 })),
  command: Type.Optional(Type.Union(["initialize", "launch", "attach", "setBreakpoints", "configurationDone", "threads", "stackTrace", "scopes", "variables", "evaluate", "continue", "pause", "next", "stepIn", "stepOut", "disconnect"].map((value) => Type.Literal(value)))),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export const CommandJobSchema = object({
  action: Type.Union([Type.Literal("start"), Type.Literal("stop")]),
  command: Type.Optional(Type.String({ minLength: 1, maxLength: 16384 })), timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
  jobId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export const CommandJobReadSchema = object({
  jobId: Type.String({ minLength: 1, maxLength: 128 }), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 * 1024 * 1024 })),
  targetSessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export type WriteDocumentInput = Static<typeof WriteDocumentSchema>;
export type EditDocumentInput = Static<typeof EditDocumentSchema>;
export type SqliteQueryInput = Static<typeof SqliteQuerySchema>;
export type SqliteTransactionInput = Static<typeof SqliteTransactionSchema>;

export const ReadToolResultSchema = object({
  stepId: Type.String({ minLength: 1, maxLength: 128 }), callId: Type.String({ minLength: 1, maxLength: 256 }),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 * 1024 * 1024 })),
});
export const ToolingQuerySchema = Type.Union([
  object({ type: Type.Literal("tooling.catalog"), sessionId: Type.String({ minLength: 1, maxLength: 128 }), query: Type.String({ maxLength: 200 }), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 512 })) }),
  object({ type: Type.Literal("tooling.result"), sessionId: Type.String({ minLength: 1, maxLength: 128 }), input: ReadToolResultSchema }),
  object({ type: Type.Literal("tooling.command"), sessionId: Type.String({ minLength: 1, maxLength: 128 }), input: CommandJobReadSchema }),
  object({ type: Type.Literal("tooling.state"), sessionId: Type.String({ minLength: 1, maxLength: 128 }), input: StateQuerySchema }),
]);
export type ToolingQuery = Static<typeof ToolingQuerySchema>;
export const ToolingCommandSchema = Type.Union([object({
  type: Type.Literal("tooling.execute"), sessionId: Type.String({ minLength: 1, maxLength: 128 }),
  name: Type.String({ minLength: 1, maxLength: 128 }), arguments: Type.Record(Type.String(), Type.Unknown()), schemaDigest: hash,
}), object({ type: Type.Literal("tooling.command.acknowledge"), sessionId: Type.String({ minLength: 1, maxLength: 128 }),
  jobId: Type.String({ minLength: 1, maxLength: 128 }), expectedDigest: hash, confirmInspection: Type.Literal(true) })]);
export interface ToolingCatalog { type: "tooling.catalog"; tools: { name: string; description: string; parameters: unknown; schemaDigest: string }[]; offset: number; nextOffset: number | null; total: number; query: string }
export interface ToolingResult { type: "tooling.result"; text: string; nextOffset: number | null; offset: number; bytes: number; rawComplete: boolean; digest: string; outcome: string }
export interface CommandJobRead {
  id: string; status: CapabilityJob["status"]; env: "Local"; root: string; text: string | null;
  source: "live-owned-command-tail" | "unavailable" | "retained-command-result"; nextOffset: number | null;
  outputBytes: number | null; elapsedMs: number | null; complete?: boolean; retainedBytes?: number; pid?: number | null; observedAt?: string;
  inspectionDigest?: string; diagnostic?: string; digest?: string; bytes?: number; offset?: number; eof?: boolean;
  exitCode?: number; signal?: number | null; cleanup?: "known-group-stopped" | "unconfirmed";
}
export type ToolingResponse = ToolingCatalog | ToolingResult | { type: "tooling.command"; data: CommandJobRead } | { type: "tooling.state"; data: unknown };
