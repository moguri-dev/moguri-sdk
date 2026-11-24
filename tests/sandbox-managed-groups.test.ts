import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { defaultSandboxManagement } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { reviewNativeTools, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const configuration = await nativeConfiguration(true);
test("actual managed group guest uses two explicit original roots, real decisions, exact accounting and source publication", { skip: !configuration, timeout: ciTime(120000) }, async () => {
  assert.ok(configuration);
  const fixture = await nativeApiFixture(configuration, { group: true, providerBaseUrl: process.env.MOGURI_NATIVE_GROUP_PROVIDER }),
    { sdk, service, provider } = fixture, reportPath = process.env.MOGURI_NATIVE_GROUP_REPORT; let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = configuration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.budgets.rates = [{ modelId: provider.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2,
      effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await sdk.settings.update(settings.values, settings.revision); await reviewNativeTools(sdk, ["read_file", "write_file", "run_command"]); await fixture.qualify();
    const secondRoot = join(fixture.root, "second-original"); await mkdir(secondRoot, { mode: 0o700 });
    await writeFile(join(secondRoot, "fixture.txt"), "Generated second source original.\n");
    const ids = [(await sdk.projects.add(fixture.project)).id!, (await sdk.projects.add(secondRoot)).id!];
    const folder = await sdk.projects.group("Generated actual native group", ids.map((projectId) => ({
      projectId, revision: sdk.getState().snapshot!.projectConfigurations.find((configuration) => configuration.projectId === projectId)?.revision ?? 0,
    })));
    const created = await sdk.sessions.createFolder(folder.id!, "Generated actual group native", { env: "Sandbox", modelId: provider.modelId });
    const session = () => service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    assert.equal(session().projectId, null); assert.equal(session().repositories?.length, 2);
    await assert.rejects(() => sdk.workspaces.file(created.id!, "fixture.txt"), /repository|prepare|workspace/i);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: `generated native group ${ids.join(" ")}`, attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const approved = new Set<string>();
    for (let index = 0; index < 2000; index++) {
      const current = session();
      if (current.pendingApproval && !approved.has(current.pendingApproval.id)) {
        approved.add(current.pendingApproval.id);
        await sdk.command({ type: "approval.respond", sessionId: current.id, approvalId: current.pendingApproval.id, allow: true });
      }
      if (!current.turnId && ["completed", "failed", "partial"].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(session().status, "completed", session().lastError ?? "Generated native group did not complete.");
    const execution = service.controller.snapshot().sandboxExecutions!.find((execution) => execution.sessionId === created.id)!;
    assert.equal(execution.root, null); assert.equal(execution.sourceRoot, null); assert.equal(execution.cleanup, "owned-guest-stopped");
    assert.deepEqual(execution.repositories?.map((binding) => binding.projectId), ids);
    assert.equal(provider.requests.length, 0); assert.equal(session().usage.length, 7);
    assert.equal(session().usage.reduce((sum, usage) => sum + usage.inputTokens! + usage.outputTokens!, 0), 294);
    assert.equal(approved.size, 6);
    const decisions = service.controller.events(0).filter((event) => event.event_type === "tool.decided" && event.session_id === created.id);
    assert.equal(decisions.length, 6); assert.ok(decisions.every((event) => event.event_type === "tool.decided" && event.payload.actor === "user" && event.payload.allow));
    const retained = (await sdk.sandbox.result(execution.id)).result; assert.ok(retained); assert.equal(retained.version, 2);
    assert.equal(retained.journal.status, "verified");
    const calls = (await sdk.budgets.calls({ sessionId: created.id! })).calls, totals = (await sdk.budgets.status(created.id!)).status.totals;
    assert.equal(calls.length, 7); assert.ok(calls.every((entry) => entry.status === "settled" && entry.env === "Sandbox" &&
      entry.inputTokens === 30 && entry.outputTokens === 12 && entry.reportedTokens === 42));
    assert.equal(totals.reportedTokens, 294); assert.equal(totals.unknownTokenCalls, 0); assert.equal(totals.heldTokens, 0); assert.equal(totals.unpricedCalls, 0);
    for (const [index, repository] of execution.repositories!.entries()) {
      assert.equal((await sdk.workspaces.file(created.id!, "fixture.txt", repository.projectId)).text, `Generated native group output ${index}.\n`);
      assert.equal((await sdk.workspaces.file(created.id!, "generated-shell.txt", repository.projectId)).text, "Generated group shell\n");
      assert.equal(await readFile(join(repository.root.root, "fixture.txt"), "utf8"), index ? "Generated second source original.\n" : "generated source original\n");
      const preview = (await sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"], repository.projectId)).preview;
      const publication = await sdk.sandbox.publish(execution.id, ["fixture.txt"], preview.digest, execution.revision, repository.projectId);
      assert.equal((await sdk.sandbox.waitPublication(publication.id!)).publication.status, "completed");
      assert.equal(await readFile(join(repository.root.root, "fixture.txt"), "utf8"), `Generated native group output ${index}.\n`);
    }
    const proof = JSON.parse((await sdk.workspaces.file(created.id!, "generated-native-proof.json", ids[0])).text);
    assert.equal(proof.length, 7); assert.ok(proof.every((call: { uid: number; platform: string }) => call.uid > 0 && call.platform === "linux"));
    const guests: { configuration: { id: string } }[] = JSON.parse(execFileSync("container", ["ls", "--all", "--format", "json"], { encoding: "utf8", timeout: ciTime(10000) }));
    assert.ok(!guests.some((guest) => guest.configuration.id === `${execution.launchName}-${execution.nativeSessionId}`));
    await waitFor(() => !session().turnId);
    if (reportPath) {
      if (!resolve(reportPath).startsWith(`${resolve(".native/qualification")}${sep}`)) throw new Error("Generated group reports stay inside this worktree's owned native qualification area.");
      await writeFile(reportPath, JSON.stringify({ status: "PASS", qualification: "Actual guest with generated inference, not live billing or model quality.",
        execution, result: retained, calls, totals, approvedTools: approved.size, proof, events: service.controller.events(0),
        sourceCopiesVerified: true, explicitPublications: service.controller.snapshot().sandboxPublications, ownedGuestAbsent: true, directory: fixture.root }, null, 2), { flag: "wx", mode: 0o600 });
    }
    passed = true;
  } finally { await fixture.close(passed && !reportPath); }
});
