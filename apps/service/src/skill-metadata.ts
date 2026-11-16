import { parseDocument } from "yaml";
import { valid } from "semver";
import { Type } from "typebox";
import { MoguriError, PROTOCOL_VERSION, parse } from "../../../packages/protocol/src/index.ts";

const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
// Agent Skills fields (agentskills.io/specification) and harness extensions such as user-invocable or allowed-tools are accepted as
// informational text. Only the strict `moguri` block carries Moguri semantics; no other field can grant tools, permissions or trust.
const metadataSchema = Type.Object({
  name: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  description: Type.String({ minLength: 1, maxLength: 1024 }),
  license: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  compatibility: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  metadata: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 200 }), Type.Unknown())),
  moguri: Type.Optional(object({
    schemaVersion: Type.Literal(1),
    version: Type.String({ minLength: 1, maxLength: 80 }),
    minimumProtocol: Type.Integer({ minimum: 1 }),
    maximumProtocol: Type.Integer({ minimum: 1 }),
    access: Type.Union([Type.Literal("read-only"), Type.Literal("native-files")]),
    dependencies: Type.Array(object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    }), { maxItems: 128 }),
  })),
}, { additionalProperties: true });

export function skillMetadata(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new MoguriError("skill_format", "Standard skills require SKILL.md YAML front matter with name and description.");
  const document = parseDocument(match[1]!, { uniqueKeys: true, schema: "core" });
  if (document.errors.length || document.warnings.length) throw new MoguriError("skill_format", "Skill YAML contains invalid, duplicate or unsupported tagged fields.");
  let decoded: unknown;
  try { decoded = document.toJS({ maxAliasCount: 0 }); }
  catch { throw new MoguriError("skill_metadata", "Skill security metadata cannot contain YAML aliases or unsupported tags."); }
  let metadata: ReturnType<typeof parse<typeof metadataSchema>>;
  try { metadata = parse(metadataSchema, decoded); }
  catch { throw new MoguriError("skill_metadata", "Skill metadata needs a lowercase name, a description up to 1,024 characters and, when present, a text license/compatibility, a metadata map and a valid moguri block. Other fields are informational and never grant tools or permissions."); }
  if (!metadata.description.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(match[1]!)) {
    throw new MoguriError("skill_metadata", "Skill metadata needs visible lossless text, without control, zero-width or bidirectional instruction smuggling.");
  }
  const declaration = metadata.moguri, described = typeof metadata.metadata?.version === "string" ? metadata.metadata.version : undefined;
  if (declaration && described && declaration.version !== described) throw new MoguriError("skill_compatibility", "The descriptive and security declarations disagree on the exact artifact version. No ambiguous version was admitted.");
  if (declaration && (!valid(declaration.version) || declaration.minimumProtocol > PROTOCOL_VERSION ||
    declaration.maximumProtocol < PROTOCOL_VERSION || declaration.minimumProtocol > declaration.maximumProtocol)) {
    throw new MoguriError("skill_compatibility", "The declared version/protocol is unsupported. No permission or compatibility guarantee was inferred.");
  }
  if (declaration && (new Set(declaration.dependencies.map((file) => file.path)).size !== declaration.dependencies.length ||
    declaration.dependencies.some((file) => file.path.startsWith("/") || /[\\\0]/.test(file.path) ||
      file.path.split("/").some((part) => !part || part === "." || part === "..")))) {
    throw new MoguriError("skill_dependencies", "Skill dependencies need unique exact relative paths and SHA-256 digests, never external, ambiguous or traversing sources.");
  }
  return { name: metadata.name, description: metadata.description, version: declaration?.version ?? described ?? "unversioned",
    access: declaration?.access ?? "read-only", dependencies: declaration?.dependencies ?? [] };
}
