import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compoundApiFixture } from "./compound-api.ts";
import { createSshTarget } from "./ssh-target.ts";
import { initializeGeneratedRepository } from "./git-project.ts";
import { compoundModelBinding } from "../../apps/service/src/compound-policy.ts";
import { digest } from "../../apps/service/src/store.ts";
import { ciTime } from "./time-scale.ts";

export async function remoteCompoundFixture(pattern: "cascade" | "critique" = "cascade") {
  const secrets = new Map<string, string>(), vault = { read: async (id: string) => secrets.get(id) ?? null,
    write: async (id: string, value: string) => { secrets.set(id, value); }, remove: async (id: string) => { secrets.delete(id); } };
  const f = await compoundApiFixture({ platform: { remote: { vault, modelsVault: vault } } }), root = await realpath(f.directory);
  const directory = join(root, "generated-compound-ssh"), source = join(root, "generated-compound-peer");
  await mkdir(directory, { mode: 0o700 }); await mkdir(source, { mode: 0o700 });
  const ssh = await createSshTarget(directory);
  try {
    await writeFile(join(source, "fixture.txt"), "generated original\n"); const peerGit = initializeGeneratedRepository(source);
    await writeFile(join(source, "unrelated.txt"), "Generated unrelated staged peer intent.\n"); peerGit(["add", "--", "unrelated.txt"]);
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.remote = { ...ssh.target, models: settings.localModels };
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.sdk.command({ type: "remote.probe" }); await f.sdk.models.refresh();
    const ids: string[] = [];
    for (const role of ["first", "selected", "escalation", "critic"]) {
      const entry = f.sdk.models.catalogue().models.find((entry) => entry.offerings.some((offering) =>
        offering.model.id.startsWith("remote.") && offering.model.name === `Generated compound ${role}`));
      const offering = entry?.offerings.find((offering) => offering.model.id.startsWith("remote.") && offering.model.environments?.includes("Remote"));
      if (!entry || !offering?.available) throw new Error("Generated actual peer model was not discovered.");
      await f.sdk.models.selectSource(entry.apiModelId, offering.model.id);
      ids.push(offering.model.id);
    }
    const policy = { ...f.policy, approvedModelIds: ids, limits: { ...f.policy.limits, timeoutMs: 120000 },
      routes: pattern === "cascade" ? [{ id: "generated-peer-cascade", pattern: "cascade" as const, draftId: ids[1]!, escalationId: ids[2]! }] :
        [{ id: "generated-peer-critique", pattern: "critique" as const, draftId: ids[1]!, criticId: ids[3]!, lineageReviewId: "generated-peer-lineage" }] };
    if (pattern === "critique") {
      const draft = f.sdk.getState().snapshot!.provider.models.find((model) => model.id === ids[1])!, critic = f.sdk.getState().snapshot!.provider.models.find((model) => model.id === ids[3])!;
      const sourceText = "Generated synthetic peer lineage fixture. This is not a real-model independence or quality claim.";
      policy.lineageReviews = [{ version: 1, id: "generated-peer-lineage", actor: "user", draftBindingDigest: compoundModelBinding(draft), criticBindingDigest: compoundModelBinding(critic),
        draftLineage: "generated-alpha", criticLineage: "generated-beta", sourceKind: "reviewed-training-report", sourceUrl: "https://generated.example.invalid/lineage",
        sourceText, sourceDigest: digest(sourceText), reviewedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(),
        limitations: "Generated source claim only; no empirical independence or calibrated quality." }];
      const pass = { verdict: "pass", reason: "Generated bounded peer observation, not acceptance.", issues: [] };
      f.options[3]!.replyText = JSON.stringify({ verdict: "pass", plan: pass, architecture: pass, implementation: pass });
    }
    f.routerOptions.replyText = JSON.stringify({ routeId: policy.routes[0]!.id, pattern, draftId: ids[1],
      ...(pattern === "cascade" ? { escalationId: ids[2] } : { criticId: ids[3] }), confidence: 0.95, reason: "GENERATED_PEER_ROUTER_REASON_NOT_CONTEXT" });
    const project = (await f.sdk.projects.configuration(f.session().projectId)).configuration;
    const command = f.command.replace(/^node /, `${JSON.stringify(process.execPath)} `);
    await f.sdk.projects.configure(project.projectId, { ...project.values, remotePath: source,
      scripts: project.values.scripts.map((script) => script.id === f.input.validationScriptId ? { ...script, command } : script) }, project.revision);
    await f.sdk.routing.configure(policy, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, env: "Remote", modelId: "kupo" });
    const stage = async (name: string) => {
      const review = (await f.sdk.candidates.workspacePreview(f.sessionId, name)).preview;
      const resource = await f.sdk.candidates.waitWorkspace((await f.sdk.candidates.createWorkspace(f.sessionId, name, review.digest, true)).id!);
      if (!resource.stage || resource.status !== "ready") throw new Error(resource.diagnostic ?? "Generated peer stage did not become ready.");
      return resource;
    };
    const draft = await stage("Generated peer draft"), alternate = await stage("Generated peer alternate");
    const input = { ...f.input, draftWorkspaceId: draft.id, alternateWorkspaceId: alternate.id };
    // A real SSH start rereads both stages through four worker launches. On a slow runner that can outlast the client's
    // 20-second acknowledgement, which the SDK reports as command_pending while the original command continues; follow its receipt.
    const start = async (value: typeof input, expectedDigest: string) => {
      const request = { type: "compound.start" as const, input: value, expectedDigest, confirmCost: true as const }, id = randomUUID();
      try { return await f.sdk.command(request, id); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "command_pending")) throw error;
        const deadline = Date.now() + ciTime(60_000);
        for (;;) {
          const receipt = await f.sdk.commandReceipt(request, id);
          if (receipt.status === "committed") return receipt.result;
          if (receipt.status !== "pending" || Date.now() >= deadline) throw error;
          await delay(100);
        }
      }
    };
    return { ...f, command, peer: source, peerGit, draft, peerAlternate: alternate, peerIds: ids, input, start,
      source: () => readFile(join(source, "fixture.txt"), "utf8"),
      close: async () => {
        try { await f.close(); }
        catch (error) { await f.close().catch(() => {}); throw error; }
        finally { await ssh.close(); }
      } };
  } catch (error) { try { await f.close(); } finally { await ssh.close(); } throw error; }
}
