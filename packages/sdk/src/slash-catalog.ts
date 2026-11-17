import { ClientError } from "../../client/src/index.ts";
import type { GatewaySkill } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";
import { slashCommands } from "./slash.ts";
import { builtinClashNotice } from "../../protocol/src/slash-commands.ts";

/** `shadowed` skills share a built-in's name. Built-ins win, so they are listed only to explain why the skill needs renaming. */
export type SlashSuggestion = { kind: "builtin"; name: string; description: string } |
  { kind: "skill"; name: string; description: string; skill: GatewaySkill } |
  { kind: "shadowed"; name: string; description: string; skill: GatewaySkill; builtin: string };
export async function listSlashCommands(sdk: MoguriSdk, sessionId: string, signal?: AbortSignal): Promise<SlashSuggestion[]> {
  const requested = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const skills: GatewaySkill[] = [];
  let offset = 0, expectedCatalogDigest: string | undefined, restarts = 0;
  for (;;) {
    const result = await sdk.skills.find("", { sessionId, offset, expectedCatalogDigest, signal: requested });
    if (result.restarted) {
      if (++restarts > 3) throw new ClientError("slash_catalog_changed", "The skill catalog kept changing while it was listed. No partial catalog was presented as complete; reopen the menu to retry.");
      skills.length = 0; offset = 0;
    }
    skills.push(...result.skills); expectedCatalogDigest = result.catalogDigest;
    if (result.nextOffset === null) break;
    if (result.nextOffset <= offset) throw new ClientError("slash_catalog_cursor", "Skill discovery did not advance. No partial catalog was presented as complete.");
    offset = result.nextOffset;
  }
  return [...slashCommands.map(({ name, description }): SlashSuggestion => ({ kind: "builtin", name, description })),
    ...skills.filter((skill) => !skill.shadowedBy).map((skill): SlashSuggestion => ({ kind: "skill", name: skill.name, description: skill.description, skill })),
    ...skills.flatMap((skill): SlashSuggestion[] => skill.shadowedBy ? [{ kind: "shadowed", name: skill.name, builtin: skill.shadowedBy, skill,
      description: builtinClashNotice(skill.name, skill.shadowedBy) }] : [])];
}
