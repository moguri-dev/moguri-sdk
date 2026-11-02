import { defaultKupoCompaction, defaultKupoSettings, KUPO_MODEL_ID, MoguriSdk } from "../../packages/sdk/src/index.ts";
import { setupFixture, type GeneratedProviderOptions } from "../fixture.ts";

export async function automaticCompactionFixture() {
  const configuration: GeneratedProviderOptions = { responseMode: "text", contextWindow: 16384, maxOutputTokens: 128,
    reasoningText: "GENERATED_PROVIDER_THINKING_NOT_PUBLIC_HISTORY", replyText: "Generated original concise answer." };
  const fixture = await setupFixture(configuration), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    let turns = 0;
    for (; turns < 12; turns++) {
      await fixture.send(`Generated retained source ${turns}. KEEP_THIS_ORIGINAL_SOURCE. ` + "Generated complete historical detail. ".repeat(180));
      const state = await fixture.terminal();
      if (state.status !== "completed") throw new Error(`Generated original history failed before automatic compaction: ${state.lastError}`);
      if ((state.usage.at(-1)?.contextEstimate ?? 0) >= 8500) break;
    }
    if (turns === 12) throw new Error("Generated compaction history never reached the measured trigger.");
    await sdk.refresh();
    await sdk.routing.configure({ ...defaultKupoSettings(), autoCompaction: { ...defaultKupoCompaction(), enabled: true, modelId: fixture.modelId,
      keepRecentTurns: 1, triggerFraction: 0.5, maxCallsPerTurn: 1, outputTokens: 128 } }, sdk.settings.get()!.revision);
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    const calls = fixture.requests.length;
    configuration.respond = (request) => ({ text: JSON.stringify(request).includes("read-only conversation compactor") ?
      "Generated automatic summary: KEEP_THIS_ORIGINAL_SOURCE remains the user's constraint. Prior generated answers completed. No tool permission or source acceptance was granted." :
      "Generated final answer after qualified context handover." });
    return { ...fixture, sdk, configuration, calls, close: async () => { sdk.disconnect(); await fixture.close(); } };
  } catch (error) { sdk.disconnect(); await fixture.close(); throw error; }
}
