import { ClientError } from "../../client/src/index.ts";
import type { GatewaySkill } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import { slashCommands } from "./slash.ts";

export type SlashSuggestion = { kind: "builtin"; name: string; description: string } |
  { kind: "skill"; name: string; description: string; skill: GatewaySkill };
export async function listSlashCommands(sdk: MoguriSdk, sessionId: string, signal?: AbortSignal): Promise<SlashSuggestion[]> {
  const requested = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const skills: GatewaySkill[] = [];
  let offset = 0, expectedCatalogDigest: string | undefined;
  for (;;) {
    const result = await sdk.skills.find("", { sessionId, offset, expectedCatalogDigest, signal: requested });
    skills.push(...result.skills); expectedCatalogDigest = result.catalogDigest;
    if (result.nextOffset === null) break;
    if (result.nextOffset <= offset) throw new ClientError("slash_catalog_cursor", "Skill discovery did not advance. No partial catalog was presented as complete.");
    offset = result.nextOffset;
  }
  return [...slashCommands.map(({ name, description }): SlashSuggestion => ({ kind: "builtin", name, description })),
    ...skills.map((skill): SlashSuggestion => ({ kind: "skill", name: skill.name, description: skill.description, skill }))];
}
