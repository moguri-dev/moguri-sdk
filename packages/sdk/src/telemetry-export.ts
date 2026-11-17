import { ClientError } from "../../client/src/index.ts";
import { OtlpInputSchema, OtlpReviewSchema, parse, type OtlpResponse, type CommandResult } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

export async function executeOtlpCommand(sdk: MoguriSdk, argument: string): Promise<OtlpResponse | { type: "telemetry.export.configured"; result: CommandResult }> {
  const text = argument.trim();
  if (text.length > 8192) throw new ClientError("otlp_command", "OTLP review commands are limited to 8 KiB. No input was exported or executed.");
  if (!text || text === "status") return sdk.telemetry.export.status();
  if (text.startsWith("review ")) return sdk.telemetry.export.review(parse(OtlpInputSchema, JSON.parse(text.slice(7))));
  const removal = text.match(/^credential remove (\S+) (\S+)$/);
  if (removal) return { type: "telemetry.export.configured", result: await sdk.telemetry.export.removeCredential(removal[1]!, removal[2]!) };
  if (/^credential set\b/.test(text)) throw new ClientError("otlp_command", "Credential values never go in a command line or draft. In the TUI use /otlp credential set ENDPOINT NAME for masked input; in the CLI pipe the value: moguri telemetry otlp credential set ENDPOINT NAME < file.");
  const confirmation = " confirm-reviewed";
  if (text.startsWith("apply ") && text.endsWith(confirmation)) {
    const review = parse(OtlpReviewSchema, JSON.parse(text.slice(6, -confirmation.length)));
    return { type: "telemetry.export.configured", result: await sdk.telemetry.export.apply(review) };
  }
  throw new ClientError("otlp_command", "Use status, review INPUT_JSON, apply ORIGINAL_REVIEW_JSON confirm-reviewed, or credential remove ENDPOINT NAME. A destination/revision/profile review is not an implicit enablement.");
}
