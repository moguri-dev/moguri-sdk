import { isRecord } from "../../packages/sdk/src/index.ts";
import { waitFor } from "../fixture.ts";
import { routedFixture } from "./single-routing.ts";

process.once("message", (value: unknown) => {
  void (async () => {
    if (!isRecord(value) || value.phase !== "gate" && value.phase !== "selected") throw new Error("Choose a generated Kupo controller-loss phase.");
    const fixture = await routedFixture({ configured: false });
    fixture.options.respond = (_request, index) => index === 1 ? { text: JSON.stringify({
      pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated original crash-recovery routing advice.",
    }) } : value.phase === "gate" ? { hold: true } : { text: JSON.stringify({ verdict: "pass", reason: "Generated crash-recovery gate advice." }) };
    fixture.solverOptions.toolCall = { name: "write_file", args: { path: "unselected.txt", text: "Generated never-approved crash fixture.", expectedDigest: "absent" } };
    await fixture.select(); await fixture.send("Generated actual Kupo controller loss.");
    if (value.phase === "gate") await waitFor(() => fixture.requests.length === 2);
    else await waitFor(() => fixture.session().pendingApproval);
    process.send?.({ directory: fixture.directory, project: fixture.project, sessionId: fixture.sessionId,
      turnId: fixture.session().turnId, originalCalls: fixture.service.controller.snapshot().budgetEntries.length });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Generated Kupo controller-loss setup failed.");
    process.exitCode = 1; process.disconnect?.();
  });
});
