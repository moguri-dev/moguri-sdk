import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSandboxManagement } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { waitFor } from "./fixture.ts";
import type { SandboxDns } from "../apps/service/src/sandbox-network.ts";

const configuration = await nativeConfiguration(), native = { skip: !configuration, timeout: 120_000 };
const dns: SandboxDns = { addresses: async () => ["1.1.1.1"], aliases: async (host) =>
  host === "api.individual.githubcopilot.com" ? ["api.githubcopilot.com"] : [] };

test("actual managed native turns need no preview, use the prepared provider resource and retain private changes across turns", native, async () => {
  assert.ok(configuration);
  const fixture = await nativeApiFixture(configuration, { providerBaseUrl: "https://api.individual.githubcopilot.com", dns });
  const { sdk, service, project, provider } = fixture; let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const bound = await sdk.command({ type: "project.add", path: project }), created = await sdk.sessions.create(bound.id!);
    const session = () => service.controller.snapshot().sessions.find((value) => value.id === created.id)!;
    await sdk.sessions.configure(created.id!, { ...session().controls, env: "Sandbox", modelId: provider.modelId });
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated native write", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const approved = new Set<string>();
    const complete = async () => {
      for (let index = 0; index < 1000; index++) {
        const current = session();
        if (current.pendingApproval && !approved.has(current.pendingApproval.id)) {
          approved.add(current.pendingApproval.id);
          await sdk.command({ type: "approval.respond", sessionId: created.id!, approvalId: current.pendingApproval.id, allow: true });
        }
        if (!current.turnId && ["completed", "failed", "partial"].includes(current.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(session().status, "completed", session().lastError ?? "Managed native turn did not complete.");
    };
    await complete();
    const stageId = session().sandboxWorkspaceId, first = service.controller.snapshot().sandboxExecutions!.find((value) => value.sessionId === created.id)!;
    assert.equal(service.controller.snapshot().sandboxWorkspaces!.find((value) => value.id === stageId)?.preparation?.kind, "automatic");
    assert.deepEqual(first.networkScope?.providerHosts, ["api.individual.githubcopilot.com"]);
    assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated source original\n");
    assert.equal((await sdk.workspaces.file(created.id!, "fixture.txt")).text, "generated native replacement\n");
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "Generated native follow-up.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: session().draft.revision, delivery: "queue" });
    await complete();
    assert.equal(session().sandboxWorkspaceId, stageId, "A successful private workspace must not be reset between turns.");
    assert.equal((await sdk.workspaces.file(created.id!, "fixture.txt")).text, "generated native replacement\n");
    assert.equal(session().usage.length, 4); assert.equal(provider.requests.length, 0);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "generated native slow", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: session().draft.revision, delivery: "queue" });
    await waitFor(() => session().messages.some((message) => message.text.includes("GENERATED_NATIVE_PENDING")), 30_000);
    await sdk.command({ type: "session.stop", sessionId: created.id! });
    await waitFor(() => !session().turnId && ["stopped", "partial"].includes(session().status), 30_000);
    if (session().status === "partial") await sdk.command({ type: "session.resume", sessionId: created.id! });
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: session().draft.revision, text: "Generated recovered native follow-up.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: session().draft.revision, delivery: "queue" });
    await complete();
    assert.notEqual(session().sandboxWorkspaceId, stageId, "Rollback replacement needs a newly owned stage, never an inferred inode.");
    assert.equal((await sdk.workspaces.file(created.id!, "fixture.txt")).text, "generated native replacement\n",
      "Automatic restoration must preserve prior private changes rather than replacing them with the original checkout.");
    assert.equal(await readFile(join(project, "fixture.txt"), "utf8"), "generated source original\n");
    assert.ok(service.controller.snapshot().sandboxExecutions!.every((value) => value.cleanup === "owned-guest-stopped"));
    passed = true;
  } finally { await fixture.close(passed); }
});

test("actual managed project-free turns create root-less workspaces and never need an empty source review", native, async () => {
  assert.ok(configuration);
  const fixture = await nativeApiFixture(configuration, { dns }), { sdk, service, provider } = fixture; let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const created = await sdk.sessions.create(null, "Generated managed root-less", { env: "Sandbox", modelId: provider.modelId });
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated managed answer.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const session = () => service.controller.snapshot().sessions.find((value) => value.id === created.id)!;
    await waitFor(() => !session().turnId && ["completed", "failed", "partial"].includes(session().status), 30_000);
    assert.equal(session().status, "completed", session().lastError ?? "");
    const execution = service.controller.snapshot().sandboxExecutions!.find((value) => value.sessionId === created.id)!;
    assert.equal(execution.root, null); assert.equal(execution.sourceRoot, null);
    assert.equal(session().usage.length, 1); assert.equal(provider.requests.length, 0);
    passed = true;
  } finally { await fixture.close(passed); }
});
