import { ClientError } from "../../client/src/index.ts";
import { stainlessSummary, type StainlessStatus } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

export type StainlessCommandOutput = { summary: string; stainless: StainlessStatus } | { opened: string; sessionId: string };

/** Shared `/stainless` and `moguri stainless` handling: `status`, `check` or `open [URL]` for an explicit session. */
export async function executeStainlessCommand(sdk: MoguriSdk, argument: string, sessionId?: string, fallbackUrl?: string | null): Promise<StainlessCommandOutput> {
  const [action = "status", ...rest] = argument.trim().split(/\s+/).filter(Boolean);
  if (action === "status" && !rest.length) { const stainless = await sdk.stainless.status(); return { summary: stainlessSummary(stainless), stainless }; }
  if (action === "check" && !rest.length) { const stainless = await sdk.stainless.check(); return { summary: stainlessSummary(stainless), stainless }; }
  if (action === "open" && rest.length <= 1) {
    if (!sessionId) throw new ClientError("stainless_session", "Choose the session whose Local preview Stainless should open. Nothing was opened.");
    const url = rest[0] ?? fallbackUrl;
    if (!url) throw new ClientError("stainless_url", "Give a preview URL or set one in the session Browser first. Nothing was opened.");
    await sdk.stainless.open(sessionId, url);
    return { opened: url, sessionId };
  }
  throw new ClientError("stainless_command", "Use status, check, or open [URL]. Turn Stainless on in Settings first; agents use it only through approved playwright batches.");
}
