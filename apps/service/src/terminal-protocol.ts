import { Type, type Static, type TSchema } from "typebox";
import { TerminalOwnerSchema, PreparedTerminalOwnerSchema, TerminalStateSchema } from "../../../packages/protocol/src/terminals.ts";

export const TERMINAL_PROTOCOL = 1;
export const TERMINAL_FRAME_BYTES = 512 * 1024;
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const TerminalLaunchSchema = object({
  executable: Type.String({ minLength: 1, maxLength: 4096 }), args: Type.Array(Type.String({ maxLength: 128 * 1024 }), { maxItems: 100 }),
});
export type TerminalLaunch = Static<typeof TerminalLaunchSchema>;
export const TerminalBootstrapSchema = object({
  kind: Type.Literal("terminal-owner"), owner: PreparedTerminalOwnerSchema, key: Type.String({ maxLength: 64 }),
});
export type TerminalBootstrap = Static<typeof TerminalBootstrapSchema>;
const terminal = { terminalId: id, bindingDigest: hash };
export const TerminalRequestSchema = Type.Union([
  object({ id, action: Type.Literal("info") }),
  object({ id, action: Type.Literal("close-all") }),
  object({ id, action: Type.Literal("dispose") }),
  object({ id, action: Type.Literal("open"), intent: TerminalStateSchema, launch: TerminalLaunchSchema }),
  object({ id, action: Type.Literal("inspect"), terminalId: id }),
  object({ id, action: Type.Literal("close"), ...terminal }),
  object({ id, action: Type.Literal("forget"), ...terminal }),
  object({ id, action: Type.Literal("read"), ...terminal, offset: integer, limit: Type.Integer({ minimum: 1, maximum: 65536 }) }),
  object({ id, action: Type.Literal("input"), ...terminal, data: Type.String({ minLength: 1, maxLength: 16384 }) }),
  object({ id, action: Type.Literal("resize"), ...terminal, cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }) }),
]);
export type TerminalRequest = Static<typeof TerminalRequestSchema>;
export type TerminalRequestInput = TerminalRequest extends infer T ? T extends TerminalRequest ? Omit<T, "id"> : never : never;
export interface TerminalControlChannel {
  request(input: TerminalRequestInput): Promise<unknown>;
  inspectOwner(): Promise<TerminalOwnerInfo>;
  detach(): void | Promise<void>;
  retire(): void;
}
export const TerminalOwnerInfoSchema = object({
  owner: TerminalOwnerSchema, terminalIds: Type.Array(id, { maxItems: 64 }), nodeVersion: Type.String({ maxLength: 80 }),
});
export type TerminalOwnerInfo = Static<typeof TerminalOwnerInfoSchema>;
export const TerminalInspectSchema = object({ terminal: TerminalStateSchema, launchDigest: hash });
export type TerminalInspect = Static<typeof TerminalInspectSchema>;
export const TerminalReadSchema = object({
  terminal: TerminalStateSchema, data: Type.String({ maxLength: 65536 }), baseOffset: integer, nextOffset: integer,
});
export type TerminalRead = Static<typeof TerminalReadSchema>;
