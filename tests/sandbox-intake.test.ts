import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultKupoSettings, defaultSandboxManagement, KUPO_MODEL_ID } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";
import { waitFor } from "./fixture.ts";

const configuration = await nativeConfiguration(), native = { skip: !configuration, timeout: 120_000 };
test("actual native Kupo preserves a scheduled ghost/new draft and owned Stop without a controller model or source-checkout fallback", native, async () => {
  assert.ok(configuration);
  const clock = new GeneratedIntakeClock(), fixture = await nativeApiFixture(configuration, { intakeClock: clock }), { sdk, service, project, provider } = fixture;
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.kupo = { ...defaultKupoSettings(), approvedModelIds: [provider.modelId] };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const bound = await sdk.projects.add(project), created = await sdk.sessions.create(bound.id!, "Generated native scheduled Kupo", { env: "Sandbox", modelId: KUPO_MODEL_ID });
    const session = () => service.controller.snapshot().sessions.find((value) => value.id === created.id)!;
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated native scheduled original.", attachments: [] });
    const scheduled = await sdk.scheduledPrompts.create(created.id!, { kind: "delay", minutes: 5, timeZone: "UTC" });
    assert.equal(service.controller.snapshot().sandboxWorkspaces!.find((workspace) => workspace.id === session().sandboxWorkspaceId)?.preparation?.kind, "scheduled");
    assert.equal(session().turnId, null); assert.equal(service.controller.snapshot().sandboxExecutions!.length, 0);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "Generated newer native draft.", attachments: [] });
    assert.equal(session().messages.length, 0); assert.equal(provider.requests.length, 0);
    clock.advanceBy(300000);
    await waitFor(() => !session().turnId && ["completed", "failed", "partial"].includes(session().status), 30000);
    assert.equal(session().status, "completed", session().lastError ?? "");
    assert.equal(sdk.scheduledPrompts.list(created.id!)[0]?.id, scheduled.id);
    assert.equal(sdk.scheduledPrompts.list(created.id!)[0]?.status, "admitted");
    assert.equal(session().controls.kupoMode, "balanced"); assert.equal(session().controls.env, "Sandbox");
    assert.equal(session().draft.text, "Generated newer native draft."); assert.equal(session().usage.length, 1);
    assert.equal(session().usage[0]?.contextWindow, provider.contextWindow);
    assert.equal(service.controller.snapshot().budgetEntries[0]?.env, "Sandbox");
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "generated native slow owned Kupo", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: session().draft.revision, delivery: "queue" });
    await waitFor(() => session().messages.some((message) => message.text.includes("GENERATED_NATIVE_PENDING")), 30000);
    await sdk.command({ type: "session.stop", sessionId: created.id! });
    await waitFor(() => !session().turnId && ["stopped", "partial"].includes(session().status), 30000);
    assert.equal(provider.requests.length, 0); assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated source original\n");
    assert.ok(service.controller.snapshot().sandboxExecutions!.every((execution) => execution.cleanup === "owned-guest-stopped"));
    assert.equal(service.controller.snapshot().budgetEntries.at(-1)?.status, "unknown");
    passed = true;
  } finally { await fixture.close(passed); }
});

test("actual native failure retains the root-inspection gate instead of replaying a rolled-back guest or using Local inference", native, async () => {
  assert.ok(configuration);
  const clock = new GeneratedIntakeClock(), fixture = await nativeApiFixture(configuration, { intakeClock: clock }), { sdk, service, project, provider } = fixture;
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const bound = await sdk.projects.add(project), created = await sdk.sessions.create(bound.id!, "Generated native original recovery", { env: "Sandbox", modelId: provider.modelId });
    const session = () => service.controller.snapshot().sessions.find((value) => value.id === created.id)!;
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated native recovery", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => !session().turnId && session().status === "failed", 30000);
    const original = service.controller.snapshot().modelFailures[0]!;
    assert.ok(original.requestDigest); assert.equal(original.status, "pending");
    clock.advanceBy(30000);
    await waitFor(() => service.controller.snapshot().modelFailures[0]?.status === "blocked");
    await sdk.refresh();
    await assert.rejects(async () => sdk.sessions.retry(created.id!, original.id, service.controller.snapshot().modelFailures[0]!.revision), /prepare this session's exact native workspace/);
    clock.advanceBy(150000);
    const state = service.controller.snapshot();
    assert.equal(state.modelFailures[0]?.requestDigest, original.requestDigest); assert.equal(state.modelFailures[0]?.status, "blocked");
    assert.equal(state.modelRecoveryCycle?.status, "exhausted"); assert.equal(state.sandboxExecutions!.length, 1);
    assert.ok(state.sandboxExecutions!.every((execution) => execution.cleanup === "owned-guest-stopped"));
    assert.ok(state.budgetEntries.every((entry) => entry.env === "Sandbox" && entry.status === "unknown" && entry.reservedTokens! > 0));
    assert.equal(session().messages.filter((message) => message.role === "user").length, 1);
    assert.equal(service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal(provider.requests.length, 0); assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated source original\n");
    clock.advanceBy(86400_000); assert.equal(service.controller.snapshot().sandboxExecutions!.length, 1);
    passed = true;
  } finally { await fixture.close(passed); }
});
