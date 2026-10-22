import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../../packages/protocol/src/index.ts";
import { winddownApiFixture } from "./winddown-api.ts";

process.once("message", (value: unknown) => {
  void (async () => {
    if (!isRecord(value) || value.phase !== "intent" && value.phase !== "published") throw new Error("Choose one generated original checkpoint publication-loss phase.");
    const f = await winddownApiFixture({ git: true }), accepted = await f.accept(), checkpoint = await f.run(); await f.unrelated();
    if (!f.git) throw new Error("Generated publication-loss fixture has no exact Git root.");
    const input = { winddownId: checkpoint.winddown.id, sessionId: f.sessionId, candidateIds: [accepted.candidate.id],
      branch: "moguri/generated-budget-control-loss", message: "chore: retain accepted work through control loss" };
    const preview = await f.sdk.winddown.commitPreview(input), commandId = randomUUID();
    const command = { type: "winddown.commit" as const, ...input, expectedRevision: preview.preview.revision, expectedDigest: preview.preview.digest, confirm: true as const };
    const indexDigest = createHash("sha256").update(await readFile(join(f.project, ".git/index"))).digest("hex"), head = f.git(["rev-parse", "HEAD"]);
    const publish = () => {
      process.send?.({ directory: f.directory, stateDir: join(f.directory, "state"), project: f.project, winddownId: checkpoint.winddown.id,
        commandId, command, indexDigest, head, branch: input.branch });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    const projects = f.service.controller.platform.sessions.projects, original = projects.reviewedCommit.bind(projects);
    projects.reviewedCommit = (project, files, target, message, signal, hooks = {}) => original(project, files, target, message, signal, {
      ...hooks, publishIntent: async (prepared) => { await hooks.publishIntent?.(prepared); if (value.phase === "intent") publish(); },
      committed: (result) => { hooks.committed?.(result); if (value.phase === "published") publish(); },
    });
    await f.sdk.command(command, commandId);
  })().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Generated checkpoint loss fixture failed."); process.exitCode = 1; process.disconnect?.(); });
});
