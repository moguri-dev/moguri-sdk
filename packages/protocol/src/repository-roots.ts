import { Type, type Static } from "typebox";

export const SessionRepositorySchema = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 128 }), name: Type.String({ minLength: 1, maxLength: 128 }),
  root: Type.Object({ root: Type.String({ minLength: 1, maxLength: 4096 }),
    device: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }), inode: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }) }, { additionalProperties: false }),
}, { additionalProperties: false });
export const SessionRepositoriesSchema = Type.Array(SessionRepositorySchema, { minItems: 1, maxItems: 1000 });
export type SessionRepository = Static<typeof SessionRepositorySchema>;
