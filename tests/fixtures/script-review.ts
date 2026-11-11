import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, MoguriSdk, SCRIPT_REVIEW_MAX_BYTES, webAccessAllows } from "../../packages/sdk/src/index.ts";
import { setupFixture } from "../fixture.ts";

export async function scriptReviewFixture(options: { unsafe?: boolean; attemptUnsafe?: boolean; autopilot?: boolean; publicUrl?: boolean; sourcePadding?: number; findings?: string[]; trustAttemptAfterReview?: boolean } = {}) {
  let phase = 0, reviewId = "", sourceDigest = "", revision = 0, reviewedPath = "generated-script.sh", sourceReads = 0;
  const url = "https://raw.githubusercontent.com/generated/repository/0123456789012345678901234567890123456789/generated.sh";
  const fixture = await setupFixture({ platform: { scriptReviews: { fetchSource: async (input, _signal, redirects, access, maximum) => {
    if (input !== url || redirects !== 0 || !access || !webAccessAllows(access, url) || maximum !== SCRIPT_REVIEW_MAX_BYTES) throw new Error("Generated script source needs its exact normal website grant.");
    sourceReads++; return { url, body: source, type: "text/plain" };
  } } }, respond: (request) => {
    const messages = Array.isArray(request.messages) ? request.messages.filter(isRecord) : [];
    const tools = messages.filter((message) => message.role === "tool"), last = tools.at(-1);
    if (phase++ === 0) return { tool: { name: "discover_tools", args: { query: "review_script run_script" } } };
    if (phase === 2) return { tool: { name: "review_script", args: { action: "inspect", ...(options.publicUrl ? { url } : { path: "generated-script.sh" }), interpreter: "sh", args: [] } } };
    if (phase === 3) {
      const result: unknown = JSON.parse(String(last?.content));
      if (!isRecord(result) || !isRecord(result.inspection) || !isRecord(result.inspection.source) || result.complete !== true ||
        typeof result.inspection.id !== "string" || typeof result.inspection.source.digest !== "string") throw new Error("Generated model did not receive the complete original script.");
      reviewId = result.inspection.id; sourceDigest = result.inspection.source.digest; reviewedPath = String(result.inspection.source.path);
      return { tool: { name: "review_script", args: { action: "review", path: reviewedPath, id: reviewId,
        expectedRevision: 0, expectedDigest: sourceDigest, verdict: options.unsafe ? "unsafe" : "safe",
        summary: options.unsafe ? "Generated unexpected file write needs an explicit user decision." : "Generated complete script only prints the expected fixture result.",
        findings: options.findings ?? (options.unsafe ? ["Generated script changes the explicitly named fixture output file."] : []) } } };
    }
    if (phase === 4) {
      const result: unknown = JSON.parse(String(last?.content));
      if (!isRecord(result) || typeof result.revision !== "number") throw new Error("Generated script assessment was not retained.");
      revision = result.revision;
      if (options.unsafe && !options.attemptUnsafe) return { text: "Generated agent reported the unsafe script and did not ask to execute it." };
      if (options.trustAttemptAfterReview) return { tool: { name: "run_script", args: { path: reviewedPath, interpreter: "sh", args: [] } } };
      return { tool: { name: "run_script", args: { path: reviewedPath, reviewId, expectedRevision: revision, expectedDigest: sourceDigest } } };
    }
    return { text: options.unsafe ? "Generated unsafe execution stayed blocked; the actual user must decide." : "Generated reviewed script execution finished." };
  } });
  const source = `${options.sourcePadding ? `#${"x".repeat(options.sourcePadding)}\n` : ""}${options.unsafe ? "printf 'GENERATED_FORCED_RUN' > generated-script-result.txt\n" : "printf 'GENERATED_REVIEWED_RUN\\n'\n"}`;
  await writeFile(join(fixture.project, "generated-script.sh"), source);
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  await fixture.configure(); await sdk.refresh();
  if (options.autopilot) await sdk.sessions.autonomy(fixture.sessionId, "Autopilot");
  return { ...fixture, sdk, source, url, sourceReads: () => sourceReads,
    review: () => fixture.service.controller.snapshot().scriptReviews.findLast((review) => review.sessionId === fixture.sessionId),
    resetReview: () => { phase = 0; },
    close: async () => { sdk.disconnect(); await fixture.close(); } };
}
