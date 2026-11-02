import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, parse, RemoteTargetSchema } from "../../packages/sdk/src/index.ts";
import { remoteWinddownApiFixture } from "./winddown-api.ts";
import { GeneratedFileVault } from "./generated-vault.ts";
import { initializeGeneratedRepository } from "./git-project.ts";

process.once("message", (value: unknown) => {
  void (async () => {
    if (!isRecord(value) || typeof value.workspace !== "string" || typeof value.vaultPath !== "string") throw new Error("Provide only the generated parent-owned SSH source and private fixture vault.");
    const workspace = value.workspace, target = parse(RemoteTargetSchema, value.target), f = await remoteWinddownApiFixture({ target: { target, workspace },
      vault: new GeneratedFileVault(value.vaultPath) }), git = initializeGeneratedRepository(workspace);
    git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    const report = await f.run(), id = report.winddown.id;
    await f.sdk.workspaces.file(f.sessionId, "fixture.txt"); await f.sdk.command({ type: "session.resume", sessionId: f.sessionId });
    const source = await f.sdk.winddown.sourcePreview(id, ["fixture.txt"]);
    await f.sdk.winddown.acceptSource(id, ["fixture.txt"], source.preview.revision, source.preview.digest, true);
    const input = { winddownId: id, sessionId: f.sessionId, candidateIds: [], remoteAccepted: true as const,
      branch: "moguri/generated-peer-control-loss", message: "Retain exact peer publication through controller SIGKILL" };
    const preview = await f.sdk.winddown.commitPreview(input), commandId = randomUUID();
    const command = { type: "winddown.commit" as const, ...input, expectedRevision: preview.preview.revision, expectedDigest: preview.preview.digest, confirm: true as const };
    const original = f.service.controller.remote.checkpoint.bind(f.service.controller.remote);
    f.service.controller.remote.checkpoint = async (...args) => {
      const result = await original(...args);
      process.send?.({ directory: f.directory, stateDir: join(f.directory, "state"), winddownId: id, commandId, command,
        commit: result.commit, head: git(["rev-parse", "HEAD"]), indexDigest: createHash("sha256").update(await readFile(join(workspace, ".git/index"))).digest("hex") });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      throw new Error("The generated killed controller cannot resume or replay its original operation.");
    };
    await f.sdk.command(command, commandId);
  })().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Generated peer checkpoint loss fixture failed."); process.exitCode = 1; process.disconnect?.(); });
});
