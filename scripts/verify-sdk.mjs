import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const temporary = await mkdtemp(join(tmpdir(), "moguri-sdk-consumer-"));
let ssh, github, controllerGithub;
try {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const archive = process.argv[2] ? resolve(process.argv[2]) :
    join(temporary, JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], { encoding: "utf8" }))[0].filename);
  const consumer = join(temporary, "consumer"), sdkName = manifest.name, packageRoot = join(consumer, "node_modules", sdkName);
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "generated-moguri-sdk-consumer", private: true, type: "module",
    dependencies: { [sdkName]: `file:${archive}` },
    allowScripts: { ...manifest.allowScripts, [manifest.name]: true },
  }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--no-progress"], { cwd: consumer, stdio: "inherit" });
  execFileSync("npm", ["install-scripts", "approve", manifest.name, "--no-allow-scripts-pin"], { cwd: consumer, stdio: "inherit" });
  execFileSync("npm", ["rebuild", manifest.name, "--no-fund", "--no-progress"], { cwd: consumer, stdio: "inherit" });
  execFileSync("npm", ["audit", "--audit-level=moderate"], { cwd: consumer, stdio: "inherit" });
  const installedSdk = await import(pathToFileURL(join(packageRoot, "dist", "sdk", "index.mjs")).href);
  const { PROTOCOL_VERSION: installedProtocol } = installedSdk;
  const conversationNavigationAvailable = typeof installedSdk.conversationNavigation === "function";
  const kanbanObservationAvailable = typeof installedSdk.githubSourceOwner === "function";
  const browserControl = Array.isArray(installedSdk.BROWSER_MCP_TOOLS);
  const rootlessTools = [...(browserControl ? installedSdk.BROWSER_MCP_TOOLS.map((tool) => tool.name) : []), "fetch_page"];
  const installedNode = await import(pathToFileURL(join(packageRoot, "dist", "sdk", "node.mjs")).href);
  if (!process.argv[2]) {
    // Client repositories run their suites through the unstable testing entry; it must load from the installed package with its workers beside it.
    const testing = await import(pathToFileURL(join(packageRoot, "dist", "testing.mjs")).href);
    if (typeof testing.startService !== "function" || typeof testing.EventStore !== "function") throw new Error("The installed testing entry is missing its service fixtures.");
    for (const worker of ["worker.mjs", "mcp-worker.mjs", "remote-bridge.mjs", "terminal-broker.mjs"]) await access(join(packageRoot, "dist", worker));
  }
  const navigationSourcesAvailable = typeof installedSdk.sessionNavigationStatus === "function" &&
    typeof installedSdk.compareSessionPrompts === "function" && typeof installedNode.globalSkillSources === "function";
  if (!process.argv[2] && !navigationSourcesAvailable) throw new Error("The current installed SDK is missing navigation or explicit Node global-skill presets.");
  const sessionFolderAvailable = typeof installedSdk.sessionLocalFolder === "function";
  if (!process.argv[2] && !sessionFolderAvailable) throw new Error("The current installed SDK is missing the browser-safe session Local folder selector.");
  const upgradeDiscovery = typeof installedNode.ServiceProtocolMismatch === "function" && typeof installedNode.ServiceUpgradeCancelled === "function";
  const installedManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (installedProtocol >= 98) execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-skills-rewind.mjs"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 95) execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/qualify-my-work.ts"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 93) execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/qualify-pr-ci.ts"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 92) execFileSync(process.execPath, [resolve("tests/fixtures/installed-milestone-models.mjs"),
    packageRoot], { stdio: "inherit", timeout: 45_000 });
  if (installedProtocol >= 94 && process.platform === "darwin") execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-ds4-compatibility.mjs"),
    packageRoot], { stdio: "inherit", timeout: 30_000 });
  if (installedProtocol >= 92 && process.platform === "darwin") execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-candidate-transports.mjs"),
    packageRoot], { stdio: "inherit", timeout: 75_000 });
  if (installedProtocol >= 91) execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-repository-management.mjs"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 83) execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-content-review.mjs"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 84) execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-session-intake.mjs"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 85 && process.platform === "darwin") execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-owned-transports.mjs"),
    packageRoot], { stdio: "inherit", timeout: 90_000 });
  if (installedProtocol >= 86) execFileSync(process.execPath, [resolve("tests/fixtures/installed-service-startup.mjs"),
    packageRoot], { stdio: "inherit", timeout: installedProtocol >= 96 ? 90_000 : 35_000 });
  if (typeof installedNode.restartMoguriService === "function") execFileSync(process.execPath, [resolve("tests/fixtures/installed-service-recovery.mjs"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 88) execFileSync(process.execPath, [resolve("tests/fixtures/installed-service-negotiation.mjs"),
    packageRoot], { stdio: "inherit", timeout: 45_000 });
  if (installedProtocol >= 87) execFileSync(process.execPath, [resolve("tests/fixtures/installed-session-controls.mjs"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  if (installedProtocol >= 90) execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/installed-live-chat.mjs"),
    packageRoot], { stdio: "inherit", timeout: 60_000 });
  const capturedServiceStop = (await readFile(join(packageRoot, installedManifest.exports["./node"].types), "utf8")).includes("expectedConnection?: Connection");
  const [installedMajor, installedMinor] = installedManifest.version.split(".").map(Number);
  const generatedDocuments = installedProtocol >= 43 ? await import("../tests/fixtures/documents.ts") : null;
  const documentInputs = generatedDocuments ? [
    ["pdf", generatedDocuments.generatedPdf({ imagePage: true }).toString("base64")],
    ["docx", generatedDocuments.generatedDocx().toString("base64")],
    ["xlsx", generatedDocuments.generatedXlsx().toString("base64")],
  ] : [];
  const retainedRoles = installedProtocol >= 32 ? JSON.parse(execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/role-sequence-export.ts"), join(temporary, "generated-retained-role-state"), String(installedProtocol)], { encoding: "utf8" })) : null;
  if (process.platform === "darwin") {
    const { createSshTarget } = await import("../tests/fixtures/ssh-target.ts");
    const directory = join(temporary, "generated-ssh"); await mkdir(directory, { mode: 0o700 });
    ssh = await createSshTarget(directory);
    ssh.target.command = [process.execPath, join(packageRoot, "bin", "moguri-worker.mjs"), "--stdio"];
    ssh.target.allowCopilot = false;
    if (installedProtocol >= 26) {
      const { generatedRemoteGithub, forbidControllerGithub } = await import("../tests/fixtures/remote-github.ts");
      github = await generatedRemoteGithub(directory, ssh.target, { bridge: join(packageRoot, "dist", "remote-bridge.mjs") });
      ssh.target = github.target; controllerGithub = await forbidControllerGithub(directory);
    }
  }
  await writeFile(join(consumer, "consumer.ts"), `
    import {MoguriSdk, DraftEditor, KUPO_MODEL_ID, defaultKupoSettings, slashCommands, type UserSettings, type KupoSettings${installedProtocol >= 28 ? ", type CandidateRecord" : ""}${installedProtocol >= 29 ? ", type CandidatePatch" : ""}${installedProtocol >= 30 ? ", type BudgetPlan" : ""}${installedProtocol >= 31 ? ", type CandidateGenerationInput, type CandidateGenerationRecord" : ""}${installedProtocol >= 32 ? ", type RoleSequenceRecord" : ""}${installedProtocol >= 34 ? ", type ModelEvidenceReport" : ""}${installedProtocol >= 76 ? ", type SessionChildrenReview" : ""}} from "${sdkName}";
    import {connectMoguri, createRuntime, saveArtifactExport, stopMoguriService${upgradeDiscovery ? ", ensureConnection, ServiceProtocolMismatch, ServiceUpgradeCancelled, type ServiceUpgradeReview" : ""}} from "${sdkName}/node";
    ${installedProtocol >= 96 ? `import {reviewServiceStartup,waitForStartupService,ServiceStartupUnconfirmed,type ServiceStartupReview} from "${sdkName}/node";` : ""}
    import {useMoguri} from "${sdkName}/react";
    import {createGatewayMcpServer} from "${sdkName}/mcp";
    ${installedProtocol >= 36 ? `import {modelContextWindows} from "${sdkName}";` : ""}
    ${installedProtocol >= 69 ? `import {supportsModelContextWindow} from "${sdkName}";` : ""}
    ${installedProtocol >= 77 ? `import {factoryControls,selectModelControls,supportedThinkingEffort,routingModelReady,routingWorkingWindow,type Controls} from "${sdkName}";` : ""}
    ${installedProtocol >= 82 ? `import {ToolPreferencesSchema,defaultToolPreferences,effectiveToolPreferences,type ToolPreferences,type WorkflowKind} from "${sdkName}";` : ""}
    ${installedProtocol >= 84 ? `import {type KupoMode,type ScheduledTiming,type ModelFailure,type KupoModelProfileInput,scheduleLocalChoices,RECOVERY_DELAYS_MS} from "${sdkName}";` : ""}
    ${installedProtocol >= 85 ? `import {type OwnedModelTransport,type DecisionRecord,type WinddownRecord,type SandboxWorkspace} from "${sdkName}";` : ""}
    ${installedProtocol >= 87 ? `import {type SessionWaitPreview,type BulkSessionPreview,type PlaywrightToolInput,LanguageToolSchema,ArrayOrderSchema} from "${sdkName}";` : ""}
    ${installedProtocol >= 88 ? `import {voiceShortcutMode} from "${sdkName}";` : ""}
    ${installedProtocol >= 43 ? `import type {DocumentReadOptions,DocumentSearchOptions,DocumentAttachment,TaskProgress} from "${sdkName}";import {useTaskProgress} from "${sdkName}/react";` : ""}
    ${installedProtocol >= 53 ? `import type {SessionActivity,ActivityContent,TurnInfo} from "${sdkName}";import {useSessionActivity} from "${sdkName}/react";` : ""}
    ${installedProtocol >= 53 ? `import type {AgentTerminalRead,Session,Snapshot} from "${sdkName}";` : ""}
    ${installedProtocol >= 54 ? `import {sessionIndicator,sessionIndicatorColors,sessionPrScope,sessionPullRequest,sessionPullRequestUrl,type SessionPrObservation} from "${sdkName}";` : ""}
    ${installedProtocol >= 55 ? `import type {ModelSelection} from "${sdkName}";` : ""}
    ${installedProtocol >= 65 ? `import {approvalProject,type SessionRepository} from "${sdkName}";` : ""}
    ${navigationSourcesAvailable ? `import {compareSessionPrompts,sessionNavigationStatus,type SessionPromptOrder} from "${sdkName}";import {globalSkillSources} from "${sdkName}/node";` : ""}
    ${sessionFolderAvailable ? `import {sessionLocalFolder,type SessionLocalFolder} from "${sdkName}";` : ""}
    async function typedConsumer() {
      ${sessionFolderAvailable ? `
      const typedFolder=(session:import("${sdkName}").Session,snapshot:import("${sdkName}").Snapshot):string=>{
        const folder:SessionLocalFolder=sessionLocalFolder(session,snapshot);return folder.diagnostic??folder.path;
      };void typedFolder;
      ` : ""}
      ${navigationSourcesAvailable ? `
      const typedNavigation=(session:import("${sdkName}").Session,snapshot:import("${sdkName}").Snapshot)=>{
        const order:SessionPromptOrder="newest";void sessionNavigationStatus(session,snapshot);
        void compareSessionPrompts(session,session,order);
        const sources:UserSettings["skillSources"]=globalSkillSources("/generated-home");void sources;
      };void typedNavigation;
      ` : ""}
      ${installedProtocol >= 101 ? `
      const typedRepositoryWorkflow=async(client:MoguriSdk,projectId:string)=>{
        const preview:import("${sdkName}").RepositoryTrustPreview=(await client.repositoryTrust.preview(projectId)).preview;
        await client.repositoryTrust.trust(preview);
        const trust:import("${sdkName}").RepositoryTrustRecord|undefined=client.repositoryTrust.get(projectId);
        if(trust)await client.repositoryTrust.revoke(projectId,trust.revision);
        const task=await client.sessions.create(projectId,"Generated typed isolated task");
        const session=client.sessions.get(task.id!);
        const origin:import("${sdkName}").SessionWorkspaceOrigin|undefined=session?.workspaceOrigin;void origin;
        if(session?.workspaceId)await client.workspaces.wait(session.workspaceId);
        await client.sessions.create(projectId,"Generated explicit checkout",undefined,undefined,"checkout");
        const filters:import("${sdkName}").AttentionFilters={type:"script-review",state:"unread",query:"generated"};
        void client.attention.list(filters);
      };void typedRepositoryWorkflow;
      ` : ""}
      ${installedProtocol >= 98 ? `
      const typedSkillsAndRewind=async(client:MoguriSdk,id:string,skill:import("${sdkName}").GatewaySkill)=>{
        const inspection:import("${sdkName}").SkillInspection=(await client.skills.inspect(id,skill.id,skill.digest)).inspection;
        const admitted=await client.skills.admit({sessionId:id,skillId:skill.id,expectedDigest:skill.digest,expectedInspectionDigest:inspection.digest,
          publisher:{kind:"unverified-local",acknowledge:"publisher-not-verified"},access:"read-only",paths:["."],validHours:24});
        await client.skills.consume(id,skill.id,skill.digest);
        const checkpoint:import("${sdkName}").TurnCheckpoint=(await client.checkpoints.list(id)).checkpoints[0]!;
        const captured:import("${sdkName}").CheckpointWorkspace|null=(await client.checkpoints.read(id,checkpoint.id)).before;
        const preview:import("${sdkName}").RewindPreview=(await client.checkpoints.preview(id,checkpoint.id,"conversation")).preview;
        await client.checkpoints.settle(id);await client.checkpoints.apply(id,checkpoint.id,"conversation",preview.digest,[]);
        const capture=(await client.checkpoints.list(id)).captures[0];if(capture)await client.checkpoints.pruneCapture(id,capture.id,capture.revision);
        if(admitted.id)await client.skills.revoke(id,admitted.id,0,"Generated typed revocation.");void captured;
      };void typedSkillsAndRewind;
      ` : ""}
      ${installedProtocol >= 96 ? `
      const typedStartup = async (stateDir:string) => {
        const review:ServiceStartupReview=await reviewServiceStartup(stateDir);
        const signal=new AbortController().signal;
        await waitForStartupService(review,{signal});
        await ensureConnection({stateDir,startupReview:review,signal});
        const unconfirmed=new ServiceStartupUnconfirmed(review);
        return unconfirmed.review;
      };void typedStartup;
      ` : ""}
      ${installedProtocol >= 95 ? `
      const typedMyWork = async (client:MoguriSdk) => {
        const preview:import("${sdkName}").MyWorkSourcePreview=(await client.myWork.previewSource({env:"Local",projectId:"generated-project"})).preview;
        const source=await client.myWork.configure(preview,true);
        const started=await client.myWork.refresh(source.id?[source.id]:undefined);
        const record:import("${sdkName}").MyWorkRefresh=(await client.myWork.read(started.id!,{metadataOnly:true})).refresh;
        const result=await client.myWork.query({category:"failed-ci",state:"all"});
        const entry:import("${sdkName}").MyWorkEntry|undefined=result.entries[0];
        await client.myWork.inspect(record.id,record.revision,record.inputDigest,true);
        if(entry&&source.id){await client.myWork.navigate(entry.id,source.id);const review=await client.myWork.previewFollowup(entry.id,source.id);await client.myWork.start(review,source.id,true);}
        await client.myWork.cancel(record.id);await client.myWork.wait(record.id);
      };void typedMyWork;
      ` : ""}
      ${installedProtocol >= 92 ? `
      const typedMilestoneModels = async (client:MoguriSdk) => {
        const target:import("${sdkName}").ModelReadinessTarget=(await client.models.readinessTarget("generated-session","generated-model")).target;
        const report:import("${sdkName}").ModelReadinessReport=(await client.models.readiness("generated-session","generated-model")).readiness;
        const preview:import("${sdkName}").ModelRuntimePreview=(await client.models.runtimePreview("generated-session","generated-model")).preview;
        const reviewed=await client.models.reviewRuntime("generated-session","generated-model",preview.digest);
        if(reviewed.id) await client.models.readinessWithRuntimeReview("generated-session","generated-model",reviewed.id,"required");
        const options:import("${sdkName}").KupoOptionsReport=(await client.routing.options("generated-session",{contextWindow:24577})).report;
        const runtime:import("${sdkName}").LocalRuntimeConfiguration={kind:"llama-cpp",executablePath:"/generated/llama-cli"};
        const workspace:import("${sdkName}").CandidateWorkspace=(await client.candidates.workspace("generated-workspace")).workspace;
        const source=await client.candidates.source("generated-session",["fixture.txt"]);
        const workspacePreview=await client.candidates.workspacePreview("generated-session","Generated stage");
        const created=await client.candidates.createWorkspace("generated-session","Generated stage",workspacePreview.preview.digest,true);
        if(created.id)await client.candidates.stopWorkspace(created.id);
        void [target,report,options,runtime,workspace,source];
      };void typedMilestoneModels;
      ` : ""}
      ${installedProtocol >= 91 ? `
      const typedRepositoryManagement = async (client:MoguriSdk) => {
        const preview:import("${sdkName}").RepositoryImportPreview=(await client.projects.imports.preview({text:"https://example.invalid/generated/repo.git",parent:"/generated/parent"})).preview;
        const started=await client.projects.imports.start(preview,true);
        const batch:import("${sdkName}").RepositoryImportBatch=(await client.projects.imports.read(started.id!)).batch;
        await client.projects.imports.cancel(batch.id);await client.projects.imports.wait(batch.id);
        await client.projects.imports.acknowledge(batch.id,1,batch.revision,true);
        const remote=await client.projects.remotePreview("generated-project","origin","https://example.invalid/moved/repo.git");
        await client.projects.setRemote(remote.preview,remote.preview.document.confirmations,true);
      };void typedRepositoryManagement;
      ` : ""}
      ${installedProtocol >= 88 ? `
      const typedVoiceShortcut = async (client:MoguriSdk) => {
        const settings=client.settings.get();if(!settings)return;
        const mode:"hold"|"toggle"=voiceShortcutMode(settings.values.voice);
        await client.settings.update({...settings.values,voice:{...settings.values.voice,shortcutMode:mode}},settings.revision);
      };void typedVoiceShortcut;
      ` : ""}
      ${installedProtocol >= 87 ? `
      const typedSessionControls = async (client:MoguriSdk,id:string,wait:SessionWaitPreview,bulk:BulkSessionPreview,app:PlaywrightToolInput) => {
        await client.sessions.waitFor(wait,true);await client.sessions.cancelWait(id);
        await client.sessions.bulk(bulk,true);await client.coordination.message(id,wait.targetSessionId,"Generated typed advisory.");
        await client.voice.enable(true);await client.voice.disable(true);await client.voice.prepare();
        await client.chatOutputs.renderHtml(id,"Generated typed page","<button>0</button>");await client.apps.run(id,app);
        void LanguageToolSchema;void ArrayOrderSchema;
      };void typedSessionControls;
      ` : ""}
      ${installedProtocol >= 84 ? `
      const typedIntake = async (client:MoguriSdk,id:string,mode:KupoMode,timing:ScheduledTiming,failure:ModelFailure,profile:KupoModelProfileInput) => {
        await client.sessions.kupoMode(id,mode);await client.routing.modes(id);await client.routing.profileDraft(profile);
        await client.sessions.retry(id,failure.id,failure.revision);await client.scheduledPrompts.create(id,timing);
        const prompt=client.scheduledPrompts.list(id)[0];if(prompt){await client.scheduledPrompts.sendNow(prompt.id,prompt.revision);await client.scheduledPrompts.cancel(prompt.id);}
        await client.tools.history(id,{limitMessages:1});void scheduleLocalChoices;void RECOVERY_DELAYS_MS;
      };void typedIntake;
      ` : ""}
      ${installedProtocol >= 85 ? `
      const ownedData=(decision:DecisionRecord,finishing:WinddownRecord,workspace:SandboxWorkspace)=>{
        if(decision.version===2){const actual:OwnedModelTransport=decision.transport;void actual.executionId;void decision.env;}
        if(finishing.version===2){void finishing.scopeDigest;void finishing.transport?.workerDigest;void finishing.source;}
        if(workspace.preparation?.version===2){void workspace.preparation.commandDigest;void workspace.preparation.draftDigest;}
      };void ownedData;
      ` : ""}
      ${installedProtocol >= 86 ? `
      const privateRetryPolicy:UserSettings["interactions"]["nativeRetryRestaging"]=true;void privateRetryPolicy;
      const transportCheckpoint=async(client:MoguriSdk,id:string,sessionId:string)=>{
        const source=await client.winddown.sourcePreview(id,["generated.ts"]);
        await client.winddown.acceptSource(id,["generated.ts"],source.preview.revision,source.preview.digest,true);
        const inspection=await client.winddown.inspectCommit(id);void inspection.inspection.review.document.actualCommit;
        await client.winddown.reconcileCommit(id,inspection.inspection.review.revision,inspection.inspection.review.digest,true);
        const native=await client.winddown.commitPreview({winddownId:id,sessionId,candidateIds:[],nativePublicationIds:["generated-publication"],branch:"moguri/generated-native",message:"Generated accepted native source"});
        const remote=await client.winddown.commitPreview({winddownId:id,sessionId,candidateIds:[],remoteAccepted:true,branch:"moguri/generated-peer",message:"Generated accepted peer source"});
        const retained=await client.winddown.read(id);void retained.commitInspection?.operationSettled;void native.preview.document.version;void remote.preview.document.source;
      };void transportCheckpoint;
      ` : ""}
      ${upgradeDiscovery ? `
      void ServiceProtocolMismatch;void ServiceUpgradeCancelled;
      const upgradeReview = async (review:ServiceUpgradeReview):Promise<boolean> => {void review.fingerprint;void review.observedProtocol;return false;};
      const reviewedConnection = (stateDir:string) => ensureConnection({stateDir,confirmUpgrade:upgradeReview});void reviewedConnection;
      ` : ""}
      ${capturedServiceStop ? `
      const stopCaptured = (stateDir:string, captured:Awaited<ReturnType<typeof createRuntime>>["connection"]) => stopMoguriService(stateDir,{expectedConnection:captured});
      void stopCaptured;
      ` : ""}
      ${typeof installedNode.restartMoguriService === "function" ? `
      const {restartMoguriService}=await import("${sdkName}/node");
      const restartCaptured=(stateDir:string,expectedConnection:Awaited<ReturnType<typeof createRuntime>>["connection"])=>restartMoguriService({stateDir,expectedConnection});
      void restartCaptured;
      ` : ""}
      const sdk = await connectMoguri({autoStart:false});
      ${installedProtocol >= 83 ? `
      const sourceReview=await sdk.scriptReviews.read("generated-session","generated-review");
      void sourceReview.review.advice?.source.modelId;void sourceReview.review.source.rootDigest;
      await sdk.scriptReviews.force("generated-session","generated-review","a".repeat(64),1,0,"generated-explicit-force");
      void sdk.getState().snapshot?.scriptReviews[0]?.attempt?.owner;
      ` : ""}
      ${installedProtocol >= 82 ? `
      const ranked:ToolPreferences={order:["cli","rest","mcp-direct","mcp-gateway"]};
      void ToolPreferencesSchema;void defaultToolPreferences;void effectiveToolPreferences(ranked);
      const currentTools=sdk.settings.get()!;await sdk.settings.update({...currentTools.values,toolPreferences:ranked},currentTools.revision);
      await sdk.settings.reset("toolPreferences",sdk.settings.get()!.revision);
      const requestedWorkflows:WorkflowKind[]=["impeccable","continue","orchestrate","spar","critique","roast-me"];
      for(const kind of requestedWorkflows)await sdk.workflows.start("generated-session",kind,kind==="continue"?"":"Generated typed actual task.");
      await sdk.sessions.spawnPrompt("generated-session","Generated typed child assignment.",0);
      ` : ""}
      ${installedProtocol >= 81 ? `
      const originalReceipt=await sdk.commandReceipt({type:"session.autonomy",sessionId:"generated-session",expectedRevision:0,autonomy:"Autopilot"},"generated-command");
      if(originalReceipt.status==="committed")void originalReceipt.result.revision;
      const retainedSources=await sdk.tools.results("generated-session",{limit:5});void retainedSources.sources[0]?.operationId;
      const retainedPage=await sdk.tools.resultById("generated-session","a".repeat(64),{offset:0,expectedDigest:"b".repeat(64),expectedRevision:1});
      void retainedPage.source.turnId;void retainedPage.source.revision;
      await sdk.git.status("generated-session");await sdk.git.log("generated-session",{head:"a".repeat(40),offset:0,limit:10});
      const builtinGitReview=await sdk.git.preview("generated-session",{kind:"git.commit",paths:["generated.ts"],message:"Generated selected commit"});
      await sdk.git.execute(builtinGitReview.preview,builtinGitReview.preview.document.confirmations,true);
      ` : ""}
      ${installedProtocol >= 77 ? `
      const boundedPreference:Controls=selectModelControls({...factoryControls(),modelOptions:{thinkingEffort:"max"}},{id:"generated-high-only",thinkingLevels:["high"]});
      const preferred:ModelSelection={modelId:"generated-high-only",thinkingEffort:"high",preferredThinkingEffort:"max"};
      void boundedPreference.preferredThinkingEffort;void preferred;void supportedThinkingEffort("high",["max"]);
      void routingModelReady;void routingWorkingWindow;
      ` : ""}
      ${installedProtocol >= 76 ? `
      const reviewedChildren:SessionChildrenReview={action:"detach",expected:[{sessionId:"generated-child",parentSessionId:"generated-parent"}]};void reviewedChildren;
      const deleteWithReview=(view:MoguriSdk,id:string,review:SessionChildrenReview)=>view.sessions.delete(id,true,0,review);void deleteWithReview;
      ` : ""}
      ${installedProtocol >= 65 ? `
      {
      const grouped=await sdk.projects.group("Generated folder",[{projectId:"generated-first",revision:0},{projectId:"generated-second",revision:0}]);
      const folderChat=await sdk.sessions.createFolder(grouped.id!,"Generated folder chat",{env:"Local"});
      const sideChat=await sdk.sessions.side(folderChat.id!);
      const captured:SessionRepository[]|undefined=sdk.getState().snapshot?.sessions.find(session=>session.id===folderChat.id)?.repositories;
      void approvalProject({projectId:null,repositories:captured},"generated-first");
      await sdk.workspaces.files(folderChat.id!,".","generated-first");
      await sdk.workspaces.file(folderChat.id!,"generated.txt","generated-first");
      await sdk.workspaces.git(folderChat.id!,true,"generated-first");
      await sdk.approvals.respond(folderChat.id!,"generated-approval",true,{scope:"project",match:"tool"});
      const capture=await sdk.voice.startCapture(sideChat.id!,undefined,{streaming:true});
      await sdk.voice.appendCapture(sideChat.id!,capture.id,capture.token,1,new Uint8Array(6400));
      const live=await sdk.voice.readCapture(sideChat.id!,capture.id,capture.token);void live.revision;
      await sdk.voice.finishCapture(sideChat.id!,capture.id,capture.token,1);
      void DraftEditor.prototype.startDictation;
      }
      ` : ""}
      ${installedProtocol >= 62 ? `
      const kanbanChat=await sdk.kanban.open("generated-project");
      const cards=await sdk.kanban.items("generated-project","github-issues",1,kanbanChat.id);
      void cards.github[0]?.headRepository;
      const task=await sdk.kanban.continue("generated-session","generated-card");
      const report=await sdk.kanban.work(task.id!);void report.run.source.contentDigest;
      await sdk.kanban.wait(task.id!);await sdk.kanban.cancel(task.id!);await sdk.kanban.inspect(task.id!,report.run.revision,true);
      const providerPrices=await sdk.prices.catalog();void providerPrices.catalogs[0]?.sourceDigest;
      await sdk.prices.refresh(["anthropic"],providerPrices.revision);
      await sdk.sessions.organize("generated-session",{workItemId:"generated-card",workItemUrl:null});
      ` : ""}
      ${installedProtocol >= 64 ? `
      await sdk.issues.reorder("generated-card","review",null,[{issueId:"generated-card",phaseId:"backlog",order:1}],0);
      await sdk.kanban.choose({profileId:sdk.profileId,sessionId:"generated-session",expectedRevision:0,text:"continue work"},"prompt");
      const continued=await sdk.slash("generated-session","/continue-work","cli");
      if(continued.kind==="continue-work"){${installedProtocol >= 80 ? 'if("expectedRevision" in continued.review)void continued.review.expectedRevision;else void continued.review.command.executionId;' : "void continued.review.expectedRevision;"}void continued.choices;}
      ` : ""}
      ${installedProtocol >= 80 ? `
      const queued=await sdk.commands.read("generated-command");void queued.item.command?.bindingDigest;
      const commandClient=await sdk.commands.attach("cli",{panel:async context=>{context.signal.throwIfAborted();void context.claim.token;return {outcome:"completed"};}});
      await commandClient.dispose();
      const nativeReview=await sdk.sandbox.publicationPreview("generated-execution",["generated.txt"],"generated-repository");
      await sdk.sandbox.publish("generated-execution",["generated.txt"],nativeReview.preview.digest,0,"generated-repository");
      ` : ""}
      ${installedProtocol >= 61 ? `
      await sdk.approvals.respond("generated-session","generated-approval",true,{scope:"project",match:"family"});
      void sdk.approvals.list()[0]?.target.kind;
      await sdk.approvals.revoke("generated-grant",0);
      await sdk.sessions.autonomy("generated-session","Autopilot");
      const repositories=await sdk.github.repositories({source:"account"});
      void repositories.repositories[0]?.sshUrl;void repositories.repositories[0]?.openSource;
      const githubScope={env:"Local" as const,projectId:"generated-project"};
      const githubProject=await sdk.github.project(githubScope);
      const githubSource={kind:"issue" as const,repository:githubProject.repository,account:githubProject.account,accountId:githubProject.accountId,number:7};
      const githubReviewed=await sdk.github.source(githubScope,githubSource);
      await sdk.github.startSession(githubScope,githubSource,githubReviewed.digest);
      ` : ""}
      ${installedProtocol >= 60 ? `
      const confirmsDetach:boolean=sdk.settings.get()?.values.interactions.confirmSessionDetach!==false;void confirmsDetach;
      await sdk.sessions.organize("generated-child",{parentSessionId:null},0,true);
      ` : ""}
      ${installedProtocol >= 59 ? `
      const overview=await sdk.dashboard.overview({range:{kind:"days",days:7}});
      void overview.dashboard.projects[0]?.work.inProgress;void overview.dashboard.velocity.productivityIncrease;
      const freshSkills=await sdk.skills.find("generated",{sessionId:"generated-id",offset:0});
      void freshSkills.catalogDigest;void freshSkills.skills[0]?.sourceId;
      await sdk.skills.read("generated-id","a".repeat(64),"generated-session");
      await sdk.suggestions.preview(null,true);
      ` : ""}
      ${installedProtocol >= 72 ? `
      await sdk.sessions.home("generated-home-session");
      const typedHome=await sdk.workspaces.home("generated-home-session");
      void typedHome.root.device;void typedHome.root.inode;void typedHome.writers[0]?.turnId;void typedHome.writers[0]?.inspection?.actor;
      void sdk.getState().snapshot?.chatWriters[0]?.backgroundJobs;
      await sdk.workspaces.acknowledgeHomeWriter("generated-home-session","generated-home-writer",1,true);
      ` : ""}
      ${installedProtocol >= 73 ? `
      await sdk.webAllowlist.add("docs.example.invalid",{kind:"session",sessionId:"generated-session"},0);
      await sdk.webAllowlist.add("https://example.invalid:8443",{kind:"project",projectId:"generated-project"},0);
      void sdk.webAllowlist.list("generated-session")[0]?.scope.kind;
      await sdk.webAllowlist.remove("generated-allowance",0);
      ` : ""}
      ${installedProtocol >= 58 ? `
      const nativeCatalogue=await sdk.tools.catalog("generated-id","file");
      void nativeCatalogue.tools[0]?.parameters;void nativeCatalogue.tools[0]?.schemaDigest;
      await sdk.tools.execute("generated-id","read_file",{path:"generated.ts"},"a".repeat(64));
      await sdk.tools.result("generated-id","generated-step","generated-call",0);
      const commandJob=await sdk.tools.command("generated-id","generated-job");void commandJob.data.source;void commandJob.data.elapsedMs;
      await sdk.tools.acknowledgeCommand("generated-id","generated-job","a".repeat(64),true);
      await sdk.tools.state("generated-id","SELECT id,text,status FROM todos");
      const childContext=await sdk.coordination.read("generated-id",{action:"inspect",targetSessionId:"generated-child"});
      if(childContext.data.action==="inspect"){void childContext.data.question?.revision;void childContext.data.plan?.source.actor;}
      const coordinationReview=await sdk.coordination.preview("generated-id","generated-child");void coordinationReview.parentBinding.env;
      await sdk.coordination.grant("generated-id","generated-child",coordinationReview.digest,false,true);
      await sdk.coordination.message("generated-id","generated-child","Generated advisory, not approval.");
      await sdk.coordination.control("generated-id",{action:"stop",targetSessionId:"generated-child",expectedTurnId:null});
      await sdk.workflows.start("generated-id","review","Generated optional prompt.");
      ` : ""}
      ${browserControl ? `
      const browserState=await sdk.browser.state("generated-session");void browserState.browser.controlId;
      const browserOwner={sessionId:"generated-session",hostId:"generated-host",lease:"ab".repeat(32)};
      await sdk.browser.host.attach(browserOwner);
      await sdk.browser.host.control(browserOwner,1,false);
      const browserPoll=await sdk.browser.host.poll(browserOwner,"","");void browserPoll.request?.arguments;
      await sdk.browser.host.reply(browserOwner,"generated-request",{text:"generated data",outcome:"partial"});
      await sdk.browser.host.detach(browserOwner);
      ` : ""}
      ${installedProtocol >= 55 ? `
      const remembered:ModelSelection|null=sdk.getState().snapshot?.lastModelSelection??null;void remembered?.thinkingEffort;
      await sdk.sessions.selectModel("generated-id",null);
      await sdk.sessions.modelOptions("generated-id",{thinkingEffort:"low"},undefined,true);
      ` : ""}
      ${installedProtocol >= 54 ? `
      const statusView=(session:Session,state:Snapshot)=>{
        const observed:SessionPrObservation|null|undefined=session.prObservation;void observed?.scope.root;void observed?.pullRequest.draft;
        void sessionIndicator(session,state).prState;void sessionIndicatorColors("#151921").merged;
        void sessionPrScope(session,state)?.access;void sessionPullRequest(session,state)?.checkedAt;void sessionPullRequestUrl(session,state);
      };void statusView;
      ` : ""}
      ${installedProtocol >= 44 ? `
      await sdk.projects.add("/generated/folder");
      const cloned=await sdk.projects.clone("https://example.invalid/generated.git","/generated/new-folder",true);void cloned.id;
      const defaultRoot=(await sdk.terminal.defaultRoot()).root;
      const globalConsole=await sdk.terminal.openGlobal(defaultRoot);void globalConsole.id;
      await sdk.terminal.open("generated-id",80,24,undefined,defaultRoot);
      ` : ""}
      ${installedProtocol >= 43 ? `
      const selection:DocumentReadOptions={sheet:"Generated sheet",range:"A1:C1",offset:0,limit:4096};
      const literal:DocumentSearchOptions={query:"Generated",limit:2};
      const descriptors=await sdk.attachments.listDocuments("generated-id",{offset:0,limit:5});void descriptors.result.nextOffset;
      const capture=await sdk.attachments.document("generated-id","/generated/report.xlsx",{captureId:"generated-typed-capture",expectedRevision:0});
      const original:DocumentAttachment=(await sdk.attachments.original("generated-id",capture.id!)).attachment;
      void original.originalDigest;void original.summary.noTextPages;
      void (await sdk.attachments.readDocument("generated-id",capture.id!,selection)).page.firstLocation?.cell;
      void (await sdk.attachments.searchDocument("generated-id",capture.id!,literal)).result.nextCursor;
      await sdk.attachments.cancelDocument("generated-id","generated-typed-capture");
      const progress:TaskProgress=(await sdk.sessions.progress("generated-id")).progress;void progress.checklist.percent;void useTaskProgress;
      ` : ""}
      ${installedProtocol >= 53 ? `
      const activity:SessionActivity=(await sdk.activity.list("generated-id",{limit:10})).activity;void activity.entries[0]?.updatedSequence;
      const detail:ActivityContent|null=(await sdk.activity.read("generated-id","generated-activity","output",{offset:0,limit:4096})).content;void detail?.nextOffset;
      const turn:TurnInfo=(await sdk.activity.turn("generated-id","generated-turn")).info;void turn.context?.window;
      const response:string=sdk.activity.response("generated-id","generated-turn");void response;void useSessionActivity;
      ` : ""}
      ${installedProtocol >= 66 ? `
      const saved:import("${sdkName}").SessionTelemetry|undefined=sdk.getState().snapshot?.sessionTelemetry["generated-id"];
      const estimate:import("${sdkName}").UsageEstimate|null|undefined=saved?.estimate;
      void estimate?.outputTokens;void saved?.turns[0]?.usage.knownCacheReadTokens;void saved?.context?.outputEstimate;
      ` : ""}
      ${installedProtocol >= 67 ? `
      const source:import("${sdkName}").SideContext|undefined=sdk.getState().snapshot?.sessions[0]?.sideContext;
      void source?.parentSessionId;void source?.throughSeq;void source?.contextDigest;void source?.documents[0]?.summary;
      ` : ""}
      ${installedProtocol >= 68 ? `
      const commands:import("${sdkName}").SlashSuggestion[]=await sdk.commands.list("generated-id");
      void commands[0]?.kind;await sdk.sessions.askSide("generated-id","Generated typed side question.",0);
      await sdk.skills.use("generated-id","generated-skill","a".repeat(64),0,"Generated task.");
      ` : ""}
      ${installedProtocol >= 99 ? `
      const typedNotifications99:import("${sdkName}").Attention[]=sdk.attention.list();
      void typedNotifications99[0]?.deleted;await sdk.attention.delete(["generated-notification"]);
      const typedLoadedSkill99:import("${sdkName}").SkillLoaded|undefined=undefined;void typedLoadedSkill99;
      await sdk.slash("generated-id","/inbox","tui");
      ` : ""}
      ${installedProtocol >= 69 ? `
      const exactWindow:boolean=supportsModelContextWindow({contextWindow:32769},24577);void exactWindow;
      await sdk.slash("generated-id","/thinking low","tui");await sdk.slash("generated-id","/effort default","desktop");
      await sdk.slash("generated-id","/context-window 24577","cli");
      ` : ""}
      ${installedProtocol >= 70 ? `
      const catalogue:import("${sdkName}").ModelCatalogue=sdk.models.catalogue();
      const preferences:import("${sdkName}").ModelPreferences|undefined=sdk.settings.get()?.values.modelPreferences;
      void catalogue.providers[0]?.enabled;void catalogue.models[0]?.sourceModelId;void preferences?.disabledModels;
      await sdk.models.setProviderEnabled("github-copilot",false,0);
      await sdk.models.setEnabled("generated-api",false,1);
      await sdk.models.selectSource("generated-api","generated-model",2);
      await sdk.slash("generated-id","/models catalogue","tui");
      ` : ""}
      ${conversationNavigationAvailable ? `
      const points:import("${sdkName}").ConversationNavigationEntry[]=(await import("${sdkName}")).conversationNavigation(sdk.getState().snapshot!,"generated-id");
      void points[0]?.messageIndex;const answer=points.find(value=>value.kind==="answer");if(answer?.kind==="answer"){void answer.questionId;void answer.answer;}
      ` : ""}
      ${installedProtocol >= 53 ? `
      const agentRead:AgentTerminalRead={action:"read",commandId:"generated-command",offset:0,limit:4096};void agentRead;
      const agentCommands=await sdk.agentTerminals.list("generated-id",{limit:20});void agentCommands.activity.entries[0]?.env;
      const agentOutput=await sdk.agentTerminals.read("generated-id","generated-command",{tail:true,limit:4096});void agentOutput.content?.offset;
      const typedAgentHook=(view:MoguriSdk,session:Session,state:Snapshot)=>useSessionActivity(view,session,state,"run_command");void typedAgentHook;
      ` : ""}
      ${installedProtocol >= 34 ? 'const evidence:ModelEvidenceReport=(await sdk.models.evidence("generated-model")).evidence;void evidence.claimed.family;void evidence.source.familyField;' : ""}
      const snapshot = sdk.settings.get();
      if (!snapshot) throw new Error("Not connected");
      ${installedProtocol >= 51 ? `
      await sdk.sessions.reorder(null,null,null,false,[{sessionId:"generated-id",revision:0}]);
      await sdk.questions.answerOther("generated-question","Generated explicit other answer",0);
      await sdk.questions.answerDraft("generated-question",0,true);
      const currentPlan=(await sdk.sessions.progress("generated-id")).progress.plan;
      void currentPlan?.source.callId;void currentPlan?.steps[0]?.status;void currentPlan?.binding;
      void snapshot.values.retention.confirmArchive;void snapshot.values.retention.confirmDelete;
      ` : ""}
      ${installedProtocol >= 28 ? "const candidate:CandidateRecord|undefined=sdk.getState().snapshot?.candidates[0];void candidate?.stageIntent.commandId;" : ""}
      ${installedProtocol >= 29 ? `
      const patch:CandidatePatch={kind:"patch",summary:"Generated typed candidate.",edits:[{path:"generated.ts",baseDigest:"absent",text:"Generated typed bytes."}]};
      const candidatePreview=(await sdk.candidates.preview("generated-source","generated-stage",patch)).preview;void candidatePreview.document.source.inode;
      const stagedCandidate=await sdk.candidates.stage("generated-source","generated-stage",patch,candidatePreview.digest);
      const candidateRead=await sdk.candidates.wait(stagedCandidate.id!);void candidateRead.candidate.stageIntent.sessionId;
      const applyReview=(await sdk.candidates.applyPreview(stagedCandidate.id!,"generated-source")).preview;
      await sdk.candidates.apply(stagedCandidate.id!,"generated-source",candidateRead.candidate.revision,applyReview.digest);
      await sdk.candidates.stop(stagedCandidate.id!);await sdk.candidates.reject(stagedCandidate.id!,candidateRead.candidate.revision,true);
      ` : ""}
      ${installedProtocol >= 31 ? `
      const generationInput:CandidateGenerationInput={task:"Generated typed proposal.",files:[{path:"generated.ts",baseDigest:"absent"}]};
      const generationPreview=(await sdk.candidates.generatePreview("generated-source","generated-stage",generationInput)).preview;
      const generated=await sdk.candidates.generate("generated-source","generated-stage",generationInput,generationPreview.digest,true);
      const generationRead=await sdk.candidates.waitGeneration(generated.id!,{signal:new AbortController().signal,timeoutMs:1000});
      const generation:CandidateGenerationRecord=generationRead.generation;void generation.inputDigest;
      await sdk.candidates.generation(generation.id);await sdk.candidates.stopGeneration(generation.id);
      await sdk.candidates.stage("generated-source","generated-stage",patch,candidatePreview.digest,generation.id);
      void sdk.getState().snapshot?.candidateGenerations;
      ` : ""}
      ${installedProtocol >= 32 ? `
      const roleRead=await sdk.roleSequences.read("generated-sequence",1);
      const roleSequence:RoleSequenceRecord=roleRead.sequence;void roleSequence.steps[0]?.planId;void roleRead.step?.result;
      void sdk.roleSequences.list();void sdk.getState().snapshot?.roleSequences;
      ` : ""}
      ${installedProtocol >= 35 ? `
      const roleGate=await sdk.roleSequences.contract("generated-sequence",1);
      void roleGate.contract;void roleGate.contextRoleIndices;void roleGate.result.status;
      ` : ""}
      ${installedProtocol >= 38 ? `
      const compoundInput:Parameters<typeof sdk.compound.preview>[0]={sessionId:"generated-source",draftWorkspaceId:"generated-draft",alternateWorkspaceId:"generated-alternate",
        input:{task:"Generated typed public workflow.",files:[{path:"generated.ts",baseDigest:"absent"}]},requestPlan:null,requestArchitecture:null,validationScriptId:"generated-script",validationTimeoutMs:1000};
      const compoundPreview=await sdk.compound.preview(compoundInput);void compoundPreview.preview.document.roles[0]?.inputBound;
      const compoundStart=await sdk.compound.start(compoundInput,compoundPreview.preview.digest,true);
      const compoundRead=await sdk.compound.read(compoundStart.id!);void compoundRead.roles[0]?.result;void compoundRead.workflow.validations[0]?.dispatched;
      const compoundValidation=await sdk.compound.validationPreview(compoundStart.id!);
      await sdk.compound.review(compoundStart.id!,compoundValidation.review.validationId,compoundValidation.revision,compoundValidation.review.digest,false);
      await sdk.compound.stop(compoundStart.id!);void sdk.compound.list("generated-source");
      const lineage=await sdk.compound.lineageDraft({draftModelId:"generated-draft-model",criticModelId:"generated-critic-model",draftLineage:"generated-alpha",criticLineage:"generated-beta",
        sourceKind:"reviewed-training-report",sourceUrl:"https://generated.example.invalid/source",sourceText:"Generated synthetic policy evidence.",validUntil:new Date(Date.now()+3600000).toISOString(),limitations:"Generated claim, not quality or training proof."});
      void lineage.review.draftBindingDigest;void lineage.warning;
      ` : ""}
      ${installedProtocol >= 39 ? `
      const finishingStatus=await sdk.winddown.status("generated-source");void finishingStatus.inputBound;void finishingStatus.usdReady;
      const finishing=await sdk.winddown.read("generated-finishing");void finishing.winddown.step.planId;void finishing.roleInput;void finishing.commitDocument;
      const gitInput={winddownId:"generated-finishing",sessionId:"generated-source",candidateIds:["generated-accepted"],branch:"moguri/generated-installed-checkpoint",message:"chore: checkpoint accepted work"};
      const gitReview=await sdk.winddown.commitPreview(gitInput);void gitReview.preview.document.files[0]?.mode;
      await sdk.winddown.commit(gitInput,gitReview.preview.revision,gitReview.preview.digest,true);
      const gitResult=await sdk.winddown.waitCommit("generated-finishing");void gitResult.winddown.commit?.publishedCommit;
      await sdk.winddown.decline("generated-finishing",0,true);await sdk.winddown.stop("generated-finishing");void sdk.winddown.list("generated-source");
      ` : ""}
      ${installedProtocol >= 40 ? `
      const decisions=await sdk.decisions.status("generated-source");void decisions.provider;void decisions.outputBound;
      const decision=await sdk.decisions.read("generated-decision");void decision.decision.source;void decision.input.questions;void decision.advice?.answers;
      await sdk.decisions.stop("generated-decision");void sdk.decisions.list("generated-source");void sdk.settings.get()?.values.decisions.technicalQuestions;
      ` : ""}
      ${installedProtocol >= 41 ? `{
      const note=await sdk.knowledge.save({tier:"Terra",projectId:"generated-project",title:"Generated typed knowledge",text:"Generated reviewed source."});
      const knowledge=await sdk.knowledge.read(note.id!);void knowledge.record.intent.id;
      const promoted=await sdk.knowledge.promote(note.id!,knowledge.record.revision,knowledge.record.contentDigest,{tier:"Glacier",title:"Generated summary",text:"Generated summary."},true);
      const promotedRead=await sdk.knowledge.read(promoted.id!);await sdk.knowledge.version(promoted.id!,promotedRead.record.contentDigest);await sdk.knowledge.history(note.id!);
      await sdk.hooks.import("generated-project",{schemaVersion:1,name:"generated-typed-hook",description:"Generated typed hook",trigger:"turn.start",command:"printf generated",timeoutMs:1000});
      await sdk.capabilities.history("generated-capability");await sdk.capabilities.version("generated-capability","a".repeat(64));
      const catalogSource={projectId:"generated-project",sourceProjectId:"generated-source",commit:"a".repeat(40),path:"moguri-marketplace.json"};
      const catalog=await sdk.marketplace.catalog(catalogSource);void catalog.catalog.packages[0]?.license;
      const marketInput={...catalogSource,packageName:"generated-bundle",version:"1.0.0"};
      const market=await sdk.marketplace.preview(marketInput);await sdk.marketplace.install(marketInput,market.preview.digest,true);
      const gitScope={env:"Local" as const,projectId:"generated-project"};
      const gitReview=await sdk.github.preview(gitScope,{kind:"git.tag.create",tag:"generated-typed",target:"a".repeat(40),annotated:false,message:""});
      const gitOperation=await sdk.github.execute(gitReview.preview,gitReview.preview.document.confirmations,true);void (await sdk.github.read(gitOperation.id!)).operation.dispatched;
      const linearReview=await sdk.linear.preview({projectId:"generated-project"},{action:"issue.create",fields:{title:"Generated typed Linear issue"}});
      const linearOperation=await sdk.linear.accept(linearReview.preview,true);void (await sdk.linear.read(linearOperation.id!)).operation.remoteWorkspaceId;
      const registries=await sdk.cache.registries.list();void registries.registries[0]?.credentialRevision;
      await sdk.cache.inspect("generated-project","python");await sdk.cache.inspect("generated-project","cargo");await sdk.cache.inspect("generated-project","go");
      const containment=await sdk.containment.status();void containment.containment.qualifiedSandboxReady;
      }` : ""}
      ${installedProtocol >= 33 ? `
      const roleProposal=await sdk.candidates.roleProposal("generated-sequence");void roleProposal.document.roleOrigin.roleInputDigest;
      const roleReference={roleSequenceId:"generated-sequence"};
      const rolePreview=(await sdk.candidates.preview("generated-source","generated-stage",patch,roleReference)).preview;void rolePreview.warning;
      await sdk.candidates.stage("generated-source","generated-stage",patch,rolePreview.digest,roleReference);
      ` : ""}
      ${installedMajor > 0 || installedMinor >= 26 ? `
      const embedded=await createRuntime({stateDir:"/generated/explicit-embedding"});
      const owned:Parameters<typeof embedded.controller.executeOwnedRoles>[0]={sessionId:"generated-source",stageWorkspaceId:"generated-stage",
        input:{task:"Generated typed owned role.",files:[{path:"generated.ts",baseDigest:"absent"}]},
        roles:[{role:"draft",modelId:"generated-model",instruction:"Return unaccepted generated data.",outputBound:64}],timeoutMs:1000};
      ${installedProtocol >= 35 ? 'owned.roles[0]!.contextRoleIndices=[];owned.roles[0]!.contract={kind:"patch"};' : ""}
      const ownedReview=await embedded.controller.ownedRoles.preview(owned);void ownedReview.document.roles[0]?.inputBound;
      await embedded.controller.executeOwnedRoles(owned,{digest:ownedReview.digest,confirmCost:true},"generated-original-owned-role");
      await embedded.close();
      ` : ""}
      const settings: UserSettings = snapshot.values;
      const project = await sdk.projects.configuration("generated-id");
      await sdk.projects.configure("generated-id",project.configuration.values,project.configuration.revision);
      const editor = new DraftEditor(sdk,"generated-id",{revision:0,text:"",attachments:[]});
      const held = await editor.send("queue",true); void held.id;
      await sdk.sessions.mode("generated-id","read-only");
      await sdk.sessions.modelOptions("generated-id",{contextWindow:16384,thinkingEffort:"low"});
      const context=await sdk.sessions.context("generated-id"); void context.context.estimatedTokens;
      ${installedProtocol >= 36 ? 'void context.context.windows?.values;void modelContextWindows({contextWindow:32769});await sdk.attachments.paste("generated-id","Generated typed paste",{start:0,end:0});' : ""}
      ${installedProtocol >= 23 ? `
      const terminal=await sdk.terminal.open("generated-id");
      const consolePage=await sdk.terminal.read(terminal.id!);void consolePage.terminal.binding?.inode;void consolePage.terminal.attachmentId;
      void sdk.getState().snapshot?.terminalOwners[0]?.cleanup;
      const observedOwner=sdk.getState().snapshot?.terminalOwners[0];
      if(observedOwner?.remote){void observedOwner.remote.peerDigest;void observedOwner.remote.target.port;}
      await sdk.terminal.input(terminal.id!,"Generated typed input.",new AbortController().signal);
      await sdk.terminal.reconcile(terminal.id!);await sdk.terminal.reconcileOwner("generated-owner");
      await sdk.terminal.acknowledgeOwner("generated-owner",true);
      await stopMoguriService("/generated/private-state",{preserveTerminals:true});` : ""}
      const compactionState=await sdk.compactions.state("generated-id");void compactionState.originalEstimatedTokens;
      const compactionPreview=(await sdk.compactions.preview("generated-id",{modelId:"generated-model",keepRecentTurns:1})).preview;
      const compaction=await sdk.compactions.generate("generated-id",compactionPreview,true);
      const summary=await sdk.compactions.read("generated-id",compaction.id!);void summary.compaction.afterTokens;
      await sdk.compactions.apply("generated-id",compaction.id!,summary.compaction.revision);
      await sdk.compactions.restore("generated-id",compaction.id!,compactionState.sourceDigest,true);
      await sdk.compactions.discard("generated-id",compaction.id!,summary.compaction.revision);
      await sdk.compactions.stop("generated-id",compaction.id!);
      const budget=await sdk.budgets.status("generated-id");void budget.status.totals.heldTokens;
      ${installedProtocol >= 30 ? `
      const planned:BudgetPlan[]=(await sdk.budgets.plans({sessionId:"generated-id",status:"held",limit:20})).plans;
      void planned[0]?.consumedStepId;void budget.status.totals.plannedHeldTokens;void sdk.getState().snapshot?.budgetPlans;
      ` : ""}
      await sdk.budgets.policy({basis:"estimate",tokens:100000},0,true);
      const dashboard=await sdk.budgets.dashboard({role:"solver",limit:50});void dashboard.nextOffset;
      const dated=await sdk.budgets.dashboard({range:{kind:"custom",from:"2024-02-28",to:"2024-02-29"},bucket:"day"});
      void dated.periods[0]?.totals.observedOutputTokensPerSecond;void dated.pricing[0]?.rate.effectiveAt;
      const calls=await sdk.budgets.calls({range:{kind:"days",days:30},turnId:"generated-turn",limit:20});
      void calls.calls[0]?.stream?.firstOutputMs;
      const operations=await sdk.telemetry.operations({range:{kind:"days",days:30},family:"mcp",actor:"external",limit:20});
      void operations.totals.failureRate;void operations.entries[0]?.sourceEventId;
      const retained=(await sdk.telemetry.storage()).storage;void retained.bytes.blobGrants;void retained.integrity;
      const repositoryPreview=(await sdk.repositories.preview("generated-id")).preview;
      ${installedProtocol >= 26 ? "void repositoryPreview.remote?.hostFingerprint;void repositoryPreview.remote?.workerDigest;" : ""}
      await sdk.repositories.refresh("generated-id",repositoryPreview.bindingDigest,repositoryPreview.revision,true);
      const repositoryState=await sdk.repositories.state("generated-id");void repositoryState.observation?.repository?.osiApproved;
      ${installedProtocol >= 27 ? `
      const memoryState=await sdk.memory.state("generated-id");void memoryState.index?.sourceDigest;
      if(memoryState.index?.binding.env==="Remote")void memoryState.index.binding.remote.peerDigest;
      await sdk.memory.indexSession("generated-id");
      const snippets=await sdk.memory.searchSession("generated-id","generated query");void snippets.binding?.inode;
      const graph=await sdk.memory.graphSession("generated-id");void graph.stalePaths;
      ` : ""}
      await sdk.repositories.clear("generated-id",repositoryState.observation?.revision??0,true);
      const repositoryCalls=await sdk.budgets.dashboard({repositoryId:42,organization:"generated",visibility:"open-source"});
      void repositoryCalls.repositoryCoverage.unattributedCalls;
      const routingPolicy:KupoSettings=defaultKupoSettings();
      await sdk.routing.configure(routingPolicy,snapshot.revision);void sdk.routing.policy();
      const routing=sdk.routing.history("generated-id");void routing[0]?.plan?.modelId;void KUPO_MODEL_ID;
      const catalog=(await sdk.profiles.list()).catalog;
      const createdProfile=await sdk.profiles.create("Generated typed profile","#557799");
      const profile=await sdk.profiles.wait(createdProfile.id!);
      const scoped=await sdk.profiles.open(profile.id);void scoped.profileId;
      await sdk.profiles.update(profile.id,{name:"Generated typed renamed profile"},profile.revision);
      await sdk.profiles.defaults({autonomy:"Guided"},catalog.globalDefaults.revision);
      await sdk.profiles.globalBudget({basis:"estimate",tokens:200000},catalog.globalBudget.revision,true);
      await sdk.profiles.retry(profile.id,profile.revision,true);await sdk.profiles.stop(profile.id);
      const selected=await connectMoguri({autoStart:false,profileId:profile.id});selected.disconnect();scoped.disconnect();
      const general=await sdk.sessions.create(null);
      const document=await sdk.artifacts.create(null,{kind:"decision",name:"Generated independent note",text:"Generated retained text"});
      await sdk.artifacts.update(document.id!,{text:"Generated edited note"},0);
      const revisions=await sdk.artifacts.history(document.id!);void revisions.revisions[0]?.sources;
      await sdk.artifacts.update(document.id!,{folderId:null,workItemId:null},1);
      const repositoryCopy=(await sdk.artifacts.materializePreview("generated-project",{commitBranch:"docs/generated-copy"})).preview;
      const publication=await sdk.artifacts.materialize("generated-project",repositoryCopy.digest,{commitBranch:"docs/generated-copy"});
      const materialized=await sdk.artifacts.materialization(publication.id!);void materialized.result?.commit?.commit;
      const question=sdk.getState().snapshot?.questions[0];
      if(question){if(question.recommendation){const actor:"model"=question.recommendation.actor;void actor;}await sdk.questions.answer(question.id,"Generated actual user answer",question.revision);await sdk.questions.answerDraft(question.id,question.revision);}
      const exported=(await sdk.artifacts.export(document.id!)).export;
      await saveArtifactExport("/generated/explicit-export.json",exported);
      await sdk.sessions.env(general.id!,"Local");
      const remote=await sdk.remote.status();void remote.remote.workerDigest;
      const mcps=await sdk.mcp.servers("generated-id");void mcps.servers[0]?.remote?.root;
      const remoteMcp=(await sdk.mcp.remotePreview("generated-id","builtin")).preview;void remoteMcp.host.port;
      await sdk.mcp.grantRemote("generated-id","builtin",remoteMcp.digest,remoteMcp.settingsRevision,false,true);
      await sdk.mcp.revokeRemote("generated-id","builtin",remoteMcp.settingsRevision,true);
      const mcpCalls=await sdk.mcp.remoteCalls("generated-id");void mcpCalls.calls[0]?.accessForwarded;
      const mcpCall=await sdk.mcp.remoteCall("generated-id","generated-operation");void mcpCall.call.actor;
      const planView=await sdk.plans.read("generated-id");void planView.boundary?.root;
      await sdk.plans.save("generated-id","Generated exact user plan.",planView.digest,planView.bindingDigest);
      const saves=await sdk.plans.saves("generated-id");void saves.saves[0]?.fileOutcome;
      const saveInfo=await sdk.plans.saveInfo("generated-id","generated-save");void saveInfo.result?.readback;
      await sdk.plans.stopSave("generated-id","generated-save");
      const workspace=await sdk.workspaces.create("generated-id","moguri/generated",{baseRef:"main"});
      await sdk.workspaces.wait(workspace.id!);
      const discovered=await sdk.workspaces.discover("generated-id"); void discovered.registrations[0]?.managedId;
      await sdk.workspaces.files("generated-id");
      await sdk.workspaces.file("generated-id","generated.ts");
      const folder=await sdk.attachments.folderPreview(general.id!,"/generated/source");
      await sdk.attachments.folder(general.id!,"/generated/source",folder.preview.digest,true);
      const sources=await sdk.suggestions.preview(general.id!);
      const meta=await sdk.metachat.create(null,general.id);
      const proposal=await sdk.configuration.propose(meta.id!,{target:"global",section:"instructions",value:"Generated guidance",reason:"Generated review"});
      const review=await sdk.configuration.review(proposal.id!); void review.before;
      await sdk.configuration.decide(proposal.id!,false,review.proposal.contentDigest,false);
      const oauth=await sdk.mcp.oauthBegin("generated-server",general.id);
      await sdk.mcp.oauthStatus(oauth.id!);
      await sdk.mcp.oauthCancel(oauth.id!); void sources.preview.digest;
      await sdk.slash("generated-id","/rename Generated","cli");
      void slashCommands;
      return settings;
    }
    void MoguriSdk; void createRuntime; void useMoguri; void createGatewayMcpServer; void typedConsumer;
  `);
  execFileSync(resolve("node_modules/.bin/tsc"), [
    "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2024", "--noEmit", "consumer.ts",
  ], { cwd: consumer, stdio: "inherit" });
  await writeFile(join(consumer, "smoke.mjs"), `
    import assert from "node:assert/strict";
    import {mkdir,writeFile,readFile,realpath,lstat} from "node:fs/promises";
    import {spawn,execFileSync} from "node:child_process";
    import {createHash,randomUUID} from "node:crypto";
    import {createServer} from "node:http";
    import {fileURLToPath} from "node:url";
    import {join} from "node:path";
    import {createRuntime,connectMoguri,saveArtifactExport,stopMoguriService} from "${sdkName}/node";
    import {DraftEditor,KUPO_MODEL_ID,defaultKupoSettings,PROTOCOL_VERSION${installedProtocol >= 61 ? ",defaultSingleKupoSettings" : ""}${installedProtocol >= 36 ? ",modelContextWindows" : ""}${installedProtocol >= 54 ? ",sessionIndicator,sessionPrScope,sessionPullRequest,sessionPullRequestUrl" : ""}${conversationNavigationAvailable ? ",conversationNavigation" : ""}${installedProtocol >= 76 ? ",sessionChildBindings" : ""}${installedProtocol >= 82 ? ",effectiveToolPreferences,defaultToolPreferences,slashCommands" : ""}} from "${sdkName}";
    ${navigationSourcesAvailable ? `import {sessionNavigationStatus} from "${sdkName}";import {globalSkillSources} from "${sdkName}/node";` : ""}
    ${sessionFolderAvailable ? `import {sessionLocalFolder} from "${sdkName}";` : ""}
    ${installedProtocol >= 98 ? `
    const admitSkill=async(client,sessionId,skillId,expectedDigest)=>{
      const {inspection}=await client.skills.inspect(sessionId,skillId,expectedDigest);
      return client.skills.admit({sessionId,skillId,expectedDigest,expectedInspectionDigest:inspection.digest,
        publisher:{kind:"unverified-local",acknowledge:"publisher-not-verified"},access:"read-only",paths:["."],validHours:24});
    };
    ` : ""}
    const root=${JSON.stringify(join(temporary, "runtime"))};
    const project=join(root,"generated-project"); await mkdir(project,{recursive:true});
    const generatedHome=join(root,"generated-chat-home");await mkdir(generatedHome,{recursive:true});
    await writeFile(join(project,"generated.ts"),"export function portableSdkMemory() { return 'generated'; }");
    const git=(args,cwd=project)=>execFileSync("git",["--no-pager","-c","core.hooksPath=/dev/null","-c","core.fsmonitor=false",...args],{cwd,encoding:"utf8"});
    git(["init","--initial-branch=main"]);git(["add","--","generated.ts"]);
    git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated external SDK base"]);
    git(["config","user.name","Generated fixture"]);git(["config","user.email","fixture@example.invalid"]);
    const makeProvider=()=>{const value={state:{status:"disconnected",models:[],login:null,diagnostic:null},onChange:()=>{},refresh:async()=>value.onChange(),login:()=>{throw Error("No real authorization in SDK verification")},cancel:async()=>{},logout:async()=>{},prepare:async()=>{throw Error("No paid calls in SDK verification")}};return value;};
    const provider=makeProvider(),providers=new Map([["default",provider]]),vaults=new Map();
    const remoteSecrets=new Map();
    const remoteVault={read:async id=>remoteSecrets.get(id)??null,write:async(id,value)=>{remoteSecrets.set(id,value);},remove:async id=>{remoteSecrets.delete(id);}};
    let repositoryLookups=0,sessionPrLookups=0;
    const repositoryMetadata={id:42,name:"example",full_name:"generated/example",html_url:"https://github.com/generated/example",owner:{login:"generated",type:"Organization"},private:false,visibility:"public",license:{spdx_id:"MIT"},description:"GENERATED_UNRETAINED_REPOSITORY_BODY"};
    const platform={terminal:{defaultRoot:generatedHome,vault:remoteVault,executable:"/bin/sh",args:["-c","printf 'GENERATED_EXTERNAL_PTY_READY\\n'; exec cat"]},remote:{vault:remoteVault,modelsVault:remoteVault},integrations:{fetch:async url=>{
      if(String(url)==="https://api.github.com/repos/generated/example/pulls/7"){sessionPrLookups++;return Response.json({number:7,html_url:"https://github.com/generated/example/pull/7",state:"open",draft:true,merged:false,merged_at:null});}
      assert.equal(String(url),"https://api.github.com/repos/generated/example");repositoryLookups++;return Response.json(repositoryMetadata);
    }}};
    const runtime=await createRuntime({stateDir:join(root,"state"),retentionKey:Buffer.alloc(32,0x67),platform,profiles:{
      provider:id=>{if(!providers.has(id))providers.set(id,makeProvider());return providers.get(id);},
      platform:id=>{if(!vaults.has(id))vaults.set(id,new Map());const values=vaults.get(id),scopedVault={read:async key=>values.get(key)??null,write:async(key,value)=>{values.set(key,value);},remove:async key=>{values.delete(key);}};return{...(id==="default"?platform:{}),terminal:{...platform.terminal,vault:scopedVault},vault:scopedVault};}
    }});
    const sdk=await connectMoguri({stateDir:join(root,"state"),autoStart:false});
    const deleteWithReviewedChildren=async(view,id,revision)=>{
      const sessions=view.getState().snapshot?.sessions??[],rootSession=sessions.find(session=>session.id===id);
      if(!rootSession)return view.sessions.delete(id,true,revision);
      const tree=[rootSession],visited=new Set([id]);
      for(let index=0;index<tree.length;index++)for(const child of sessions)if(child.parentSessionId===tree[index].id&&!visited.has(child.id)){visited.add(child.id);tree.push(child);}
      const expected=tree.slice(1).map(child=>({sessionId:child.id,parentSessionId:child.parentSessionId})).sort((a,b)=>a.sessionId.localeCompare(b.sessionId));
      return view.sessions.delete(id,true,revision??rootSession.revision,expected.length?{action:"detach",expected}:undefined);
    };
    ${installedProtocol >= 38 ? `
    assert.deepEqual(sdk.compound.list(),[]);
    await assert.rejects(()=>sdk.compound.read("generated-missing-public-workflow"),error=>error.code==="compound_missing");
    await assert.rejects(()=>sdk.compound.preview({sessionId:"generated-missing-source",draftWorkspaceId:"generated-draft",alternateWorkspaceId:"generated-alternate",
      input:{task:"Generated installed fail-closed public scope.",files:[{path:"generated.ts",baseDigest:"absent"}]},requestPlan:null,requestArchitecture:null,validationScriptId:"generated-script",validationTimeoutMs:1000}),
      error=>error.code==="compound_scope");
    console.log("Installed protocol-38 public workflow SDK/runtime is present and rejects missing source/report scope without inference or a Local fallback.");
    ` : ""}
    ${installedProtocol >= 39 ? `
    assert.equal(sdk.settings.get().values.winddown.enabled,false);assert.equal(sdk.settings.get().values.winddown.modelId,null);
    assert.deepEqual(sdk.winddown.list(),[]);
    await assert.rejects(()=>sdk.winddown.read("generated-missing-budget-checkpoint"),error=>error.code==="winddown_missing");
    console.log("Installed protocol-39 reserved-checkpoint SDK/runtime preserves disabled/no-model defaults and rejects missing independent scope without a model/Git effect.");
    ` : ""}
    ${installedProtocol >= 40 ? `
    assert.equal(sdk.settings.get().values.decisions.enabled,false);assert.equal(sdk.settings.get().values.decisions.modelId,null);
    assert.deepEqual(sdk.decisions.list(),[]);
    await assert.rejects(()=>sdk.decisions.read("generated-missing-owned-decision"),error=>error.code==="decision_missing");
    await assert.rejects(()=>sdk.decisions.status("generated-missing-decision-source"),error=>error.code==="decision_scope");
    console.log("Installed protocol-40 decisions preserve disabled/no-model defaults and refuse missing immutable source/report scope without paid inference or approval.");
    ` : ""}
    let budgetServer=null,beta=null;
    try {
      assert.equal(sdk.settings.get().values.appearance.theme,"dark");
      const p=await sdk.command({type:"project.add",path:project});
      ${installedProtocol >= 76 ? `
      const lifecycleParent=await sdk.sessions.create(p.id,"Generated installed lifecycle parent",undefined,undefined,"checkout");
      const lifecycleChild=await sdk.sessions.spawn(lifecycleParent.id,"agent","Generated installed lifecycle child");
      const lifecycleExpected=sessionChildBindings(sdk.getState().snapshot.sessions,lifecycleParent.id);
      await assert.rejects(()=>sdk.sessions.delete(lifecycleParent.id,true,lifecycleParent.revision),error=>error.code==="session_children_review");
      await sdk.sessions.delete(lifecycleParent.id,true,lifecycleParent.revision,{action:"delete",expected:lifecycleExpected});
      assert.equal(sdk.getState().snapshot.sessions.some(session=>session.id===lifecycleParent.id||session.id===lifecycleChild.id),false);
      console.log("Installed protocol-76 child-session review binds the exact tree before cascading deletion.");
      ` : ""}
      const s=await sdk.command({type:"session.create",projectId:p.id,...(PROTOCOL_VERSION>=101?{workspaceMode:"checkout"}:{})});
      ${navigationSourcesAvailable ? `{
        const snapshot=sdk.getState().snapshot,session=snapshot.sessions.find(value=>value.id===s.id);
        assert.equal(sessionNavigationStatus(session,snapshot),null);
        ${sessionFolderAvailable ? 'assert.deepEqual(sessionLocalFolder(session,snapshot),{path:snapshot.projects.find(value=>value.id===p.id).path,identity:null});' : ""}
        const presets=globalSkillSources(join(root,"generated-global-home"));
        assert.equal(presets.every(source=>source.enabled===false),true);
        for(const source of presets){
          const directory=join(source.path,"generated","nested");await mkdir(directory,{recursive:true});
          await writeFile(join(directory,"SKILL.md"),"---\\nname: generated-installed-"+source.id+"\\ndescription: Generated packed global source\\n---\\nGenerated instructions, not authority.\\n");
        }
        const before=sdk.settings.get();
        await sdk.settings.update({...before.values,skillSources:presets.map(source=>({...source,enabled:true}))},before.revision);
        const found=await sdk.skills.find();
        assert.equal(found.skills.filter(skill=>presets.some(source=>source.id===skill.sourceId)).length,2);
        const current=sdk.settings.get();await sdk.settings.update(before.values,current.revision);
        console.log("Installed SDK navigation exports and both explicit Node global-skill presets passed actual saved-source discovery without implicit admission.");
      }` : ""}
      ${installedProtocol >= 81 && process.platform === "darwin" ? `{
      const directory=join(root,"generated-installed-git");await mkdir(directory);
      const state=join(root,"generated-installed-git-state"),key=Buffer.alloc(32,0x68);
      await writeFile(join(directory,"fixture.txt"),"Generated installed Git original.\\n");
      git(["init","--initial-branch=main"],directory);git(["config","user.name","Generated fixture"],directory);git(["config","user.email","fixture@example.invalid"],directory);
      git(["config","commit.gpgSign","false"],directory);git(["config","core.hooksPath","/dev/null"],directory);
      git(["add","--","fixture.txt"],directory);git(["commit","--no-gpg-sign","-m","Generated installed Git base"],directory);
      const options={stateDir:state,retentionKey:key,provider:makeProvider()};
      let gitRuntime=await createRuntime(options),gitSdk=await connectMoguri({stateDir:state,autoStart:false});
      try{
        const project=await gitSdk.command({type:"project.add",path:directory}),session=await gitSdk.sessions.create(project.id,undefined,undefined,undefined,"checkout");
        const current=()=>gitSdk.getState().snapshot.sessions.find(value=>value.id===session.id);
        const consent={type:"session.autonomy",sessionId:session.id,autonomy:"Autopilot",expectedRevision:current().revision};
        await gitSdk.command(consent,"generated-installed-autonomy");
        assert.equal((await gitSdk.commandReceipt(consent,"generated-installed-autonomy")).status,"committed");
        assert.equal(current().controls.automaticApprovals,true);
        const perform=async action=>{const review=(await gitSdk.git.preview(session.id,action)).preview;
          const admitted=await gitSdk.git.execute(review,review.document.confirmations,true);
          const result=await gitSdk.git.wait(admitted.id);assert.equal(result.operation.status,"completed",result.operation.diagnostic);return result;};
        const base=(await gitSdk.git.status(session.id)).git.head;
        await perform({kind:"git.branch.create",branch:"generated/installed",start:base,checkout:true});
        await perform({kind:"git.branch.rename",from:"generated/installed",to:"generated/installed-renamed"});
        await writeFile(join(directory,"fixture.txt"),"Generated installed Git change.\\n");
        await perform({kind:"git.stage",paths:["fixture.txt"]});
        await perform({kind:"git.commit",paths:["fixture.txt"],message:"Generated installed selected commit"});
        const committed=(await gitSdk.git.status(session.id)).git.head;
        await perform({kind:"git.revert",commit:committed});
        assert.equal(git(["show","HEAD:fixture.txt"],directory).trim(),"Generated installed Git original.");
        const owned=await gitSdk.command({type:"workspace.create",projectId:project.id,branch:"generated/installed-owned",baseRef:"main"});
        const ownedState=gitSdk.getState().snapshot.managedWorkspaces.find(value=>value.id===owned.id);assert.ok(ownedState.jobId);
        assert.equal((await gitSdk.jobs.wait(ownedState.jobId)).status,"completed");
        const ownedSession=await gitSdk.sessions.create(project.id,"Generated installed managed branch",undefined,owned.id);
        const ownedReview=(await gitSdk.git.preview(ownedSession.id,{kind:"git.branch.rename",from:"generated/installed-owned",to:"generated/installed-owned-renamed"})).preview;
        const ownedRename=await gitSdk.git.execute(ownedReview,ownedReview.document.confirmations,true);
        assert.equal((await gitSdk.git.wait(ownedRename.id)).operation.status,"completed");
        assert.equal((await gitSdk.workspaces.inspect(owned.id)).inspection.diagnostic,null);
        assert.equal((await gitSdk.git.status(ownedSession.id)).git.branch,"generated/installed-owned-renamed");
        const tool=(await gitSdk.tools.catalog(session.id,"read_file")).tools.find(value=>value.name==="read_file");
        const read=await gitSdk.tools.execute(session.id,"read_file",{path:"fixture.txt"},tool.schemaDigest);
        assert.equal((await gitSdk.jobs.wait(read.id)).status,"completed");
        const source=(await gitSdk.tools.results(session.id)).sources.find(value=>value.name==="read_file");assert.ok(source);
        const page=await gitSdk.tools.resultById(session.id,source.operationId,{expectedDigest:source.digest,expectedRevision:source.revision});
        assert.equal(page.text,"Generated installed Git original.\\n");
        gitSdk.disconnect();await gitRuntime.close();gitRuntime=await createRuntime(options);gitSdk=await connectMoguri({stateDir:state,autoStart:false});
        assert.equal(current().controls.automaticApprovals,true);
        assert.equal((await gitSdk.workspaces.inspect(owned.id)).inspection.diagnostic,null);
        assert.equal((await gitSdk.tools.resultById(session.id,source.operationId,{expectedDigest:source.digest,expectedRevision:source.revision})).text,page.text);
        assert.equal((await gitSdk.commandReceipt(consent,"generated-installed-autonomy")).status,"committed");
        assert.equal((await gitSdk.git.log(session.id)).data.action,"log");
      }finally{gitSdk.disconnect();await gitRuntime.close();}
      console.log("Installed protocol-81 exact receipts, explicit automatic consent, public original-result grants/restart and real reviewed Git branch/stage/selected commit/revert plus atomic managed branch/change-set rename/restart pass without model calls or scripts.");
      }` : ""}
      ${installedProtocol >= 59 ? `{
      const skillDirectory=join(root,"generated-skills");await mkdir(skillDirectory);
      const skillPath=join(skillDirectory,"SKILL.md");
      await writeFile(skillPath,"---\\nname: generated-installed-skill\\ndescription: Generated installed skill lookup\\n---\\nUse generated fixture evidence.\\n");
      const beforeSettings=sdk.settings.get();
      await sdk.settings.update({...beforeSettings.values,skillSources:[{id:"generated-installed-source",name:"Generated installed skills",kind:"local",path:skillDirectory,enabled:true}]},beforeSettings.revision);
      const discovered=await sdk.skills.find("installed",{sessionId:s.id});assert.equal(discovered.skills.length,1);
      assert.match((await sdk.skills.read(discovered.skills[0].id,discovered.skills[0].digest,s.id)).body,/generated fixture evidence/);
      await writeFile(skillPath,"---\\nname: generated-installed-skill\\ndescription: Generated installed skill lookup\\n---\\nChanged generated fixture.\\n");
      await assert.rejects(()=>sdk.skills.read(discovered.skills[0].id,discovered.skills[0].digest,s.id),error=>error.code==="skill_source_changed");
      const overview=(await sdk.dashboard.overview()).dashboard;
      assert.equal(overview.days.length,7);assert.equal(overview.work.total,1);assert.equal(overview.velocity.productivityIncrease,null);
      const globalSuggestions=await sdk.suggestions.preview(null,true);assert.equal(globalSuggestions.preview.scope,"all-projects");
      const freshSettings=sdk.settings.get();await sdk.settings.update({...freshSettings.values,skillSources:[]},freshSettings.revision);
      console.log("Installed protocol-59 skill freshness, global suggestions and authoritative dashboard work without a model call or new permission.");
      }` : ""}
      ${installedProtocol >= 60 ? `{
      assert.equal(sdk.settings.get().values.interactions.confirmSessionDetach,true);
      const child=await sdk.sessions.spawn(s.id,"agent","Generated installed detach review");
      const original=sdk.getState().snapshot.sessions.find(value=>value.id===child.id);
      await assert.rejects(()=>sdk.sessions.organize(child.id,{parentSessionId:null}),error=>error.code==="session_detach_confirmation");
      await sdk.sessions.organize(child.id,{parentSessionId:null},original.revision,true);
      const detached=sdk.getState().snapshot.sessions.find(value=>value.id===child.id);
      assert.equal(detached.parentSessionId,undefined);
      assert.deepEqual([detached.projectId,detached.workspaceId,detached.controls.env,detached.coordinationParentId],
        [original.projectId,original.workspaceId,original.controls.env,original.coordinationParentId]);
      await sdk.sessions.organize(child.id,{parentSessionId:s.id});
      const settings=sdk.settings.get();await sdk.settings.update({...settings.values,interactions:{...settings.values.interactions,confirmSessionDetach:false}},settings.revision);
      await sdk.sessions.organize(child.id,{parentSessionId:null});
      await sdk.settings.reset("interactions",sdk.settings.get().revision);
      assert.equal(sdk.settings.get().values.interactions.confirmSessionDetach,true);
      for(const client of ["desktop","tui"])await assert.rejects(()=>sdk.slash(s.id,"/terminal global",client),error=>error.code==="terminal_removed");
      await deleteWithReviewedChildren(sdk,child.id);
      console.log("Installed protocol-60 detach acknowledgement, profile preference/reset, unchanged ownership and retired global entrypoints pass.");
      }` : ""}
      ${installedProtocol >= 58 ? `{
      const child=await sdk.sessions.spawn(s.id,"side","Generated installed coordinated side");
      const review=await sdk.coordination.preview(s.id,child.id);
      assert.equal(review.parentBinding.env,"Local");assert.equal(review.childBinding.root,await realpath(project));
      const inspected=await sdk.coordination.read(s.id,{action:"inspect",targetSessionId:child.id});
      assert.equal(inspected.data.mode,"read-only");
      await sdk.coordination.message(child.id,s.id,"Generated installed advisory.");
      assert.equal((await sdk.coordination.read(s.id,{action:"inbox"})).data.messages[0].origin.actor,"user");
      const source=(await sdk.tools.catalog(s.id,"write_document")).tools.find(tool=>tool.name==="write_document");assert.ok(source);
      const admitted=await sdk.tools.execute(s.id,source.name,{path:"generated-installed.docx",format:"docx",expectedDigest:"absent",paragraphs:[{text:"Generated installed structured document."}]},source.schemaDigest);
      const approval=sdk.getState().snapshot.sessions.find(session=>session.id===s.id).pendingApproval;
      if(PROTOCOL_VERSION>=73)assert.equal(approval,null);
      else{assert.ok(approval);await sdk.command({type:"approval.respond",sessionId:s.id,approvalId:approval.id,allow:true});}
      assert.equal((await sdk.jobs.wait(admitted.id)).status,"completed");
      assert.ok((await readFile(join(project,"generated-installed.docx"))).length>0);
      const doc=(await sdk.tools.catalog(s.id,"inspect_document")).tools.find(tool=>tool.name==="inspect_document");assert.ok(doc);
      const checked=await sdk.tools.execute(s.id,doc.name,{path:"generated-installed.docx"},doc.schemaDigest);
      const readApproval=sdk.getState().snapshot.sessions.find(session=>session.id===s.id).pendingApproval;
      if(PROTOCOL_VERSION>=73)assert.equal(readApproval,null);
      else{assert.ok(readApproval);await sdk.command({type:"approval.respond",sessionId:s.id,approvalId:readApproval.id,allow:true});}
      assert.equal((await sdk.jobs.wait(checked.id)).status,"completed");
      assert.match(JSON.stringify(await sdk.mcp.readResult(checked.id)),/Generated installed structured document/);
      assert.equal((await sdk.tools.state(s.id,"SELECT count(*) AS count FROM todos")).data.rows[0].count,0);
      await sdk.coordination.grant(s.id,child.id,(await sdk.coordination.preview(s.id,child.id)).digest,false,true);
      await assert.rejects(()=>sdk.coordination.read(s.id,{action:"transcript",targetSessionId:child.id}),{code:"coordination_changed"});
      await deleteWithReviewedChildren(sdk,child.id);
      console.log("Installed protocol-58 typed catalogue, actual restricted data worker, canonical SQL reads and root-bound coordination preserve actor, approval and no-model authority.");
      }` : ""}
      ${installedProtocol >= 41 ? `{
      assert.equal(sdk.settings.get().values.memory.useTieredContext,false);
      const temporarySession=await sdk.sessions.create(p.id,"Generated installed knowledge source",undefined,undefined,"checkout");
      const sky=await sdk.knowledge.save({tier:"Sky",sessionId:temporarySession.id,lifetime:"session",title:"Generated installed Sky",text:"Generated reviewed installed knowledge with temporary detail."});
      const skyRead=await sdk.knowledge.read(sky.id);
      const terra=await sdk.knowledge.promote(sky.id,0,skyRead.record.contentDigest,{tier:"Terra",title:"Generated installed Terra",text:"Generated reviewed installed knowledge."},true);
      const terraRead=await sdk.knowledge.read(terra.id);
      const glacier=await sdk.knowledge.promote(terra.id,0,terraRead.record.contentDigest,{tier:"Glacier",title:"Generated installed Glacier",text:"Generated installed knowledge."},true);
      await deleteWithReviewedChildren(sdk,temporarySession.id);
      await assert.rejects(()=>sdk.knowledge.read(sky.id),{code:"knowledge_missing"});
      assert.equal((await sdk.knowledge.read(glacier.id)).text,"Generated installed knowledge.");
      await sdk.knowledge.forget(terra.id,0,true);
      const hook=await sdk.hooks.import(p.id,{schemaVersion:1,name:"generated-installed-hook",description:"Generated installed hook",trigger:"turn.start",command:"printf generated-installed",timeoutMs:1000});
      assert.equal(sdk.getState().snapshot.registry.find(entry=>entry.id===hook.id).enabled,false);
      assert.equal((await sdk.capabilities.history(hook.id)).entries.length,1);
      const catalog={schemaVersion:1,packages:[{schemaVersion:1,name:"generated-installed-bundle",version:"1.0.0",description:"Generated installed bundle",license:"MIT",
        minimumProtocol:PROTOCOL_VERSION,maximumProtocol:PROTOCOL_VERSION,skills:["---\\nname: generated-installed-style\\ndescription: Generated installed style\\n---\\nUse generated fixture types."],scripts:[],hooks:[]}]};
      await writeFile(join(project,"moguri-marketplace.json"),JSON.stringify(catalog));
      git(["add","--","moguri-marketplace.json"]);git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated installed catalog"]);
      const marketInput={projectId:p.id,sourceProjectId:p.id,commit:git(["rev-parse","HEAD"]).trim(),path:"moguri-marketplace.json",packageName:"generated-installed-bundle",version:"1.0.0"};
      assert.equal((await sdk.marketplace.catalog({projectId:p.id,sourceProjectId:p.id,commit:marketInput.commit,path:marketInput.path})).catalog.packages.length,1);
      const marketReview=(await sdk.marketplace.preview(marketInput)).preview;
      const bundle=await sdk.marketplace.install(marketInput,marketReview.digest,true);
      assert.equal(sdk.getState().snapshot.registry.filter(entry=>entry.id===bundle.id||entry.ownerPluginId===bundle.id).every(entry=>!entry.enabled),true);
      git(["config","core.hooksPath","/dev/null"]);git(["config","tag.gpgSign","false"]);git(["config","commit.gpgSign","false"]);
      const gitSession=await sdk.sessions.create(p.id,"Generated installed Git source",undefined,undefined,"checkout"),gitHead=git(["rev-parse","HEAD"]).trim(),gitIndex=await readFile(join(project,".git/index"));
      const gitReview=(await sdk.github.preview({env:"Local",projectId:p.id,sessionId:gitSession.id},{kind:"git.tag.create",tag:"generated-installed-reviewed-tag",target:gitHead,annotated:false,message:""})).preview;
      const gitStarted=await sdk.github.execute(gitReview,gitReview.document.confirmations,true);
      const gitFinished=await sdk.github.wait(gitStarted.id,{timeoutMs:10000});
      assert.equal(gitFinished.operation.status,"completed");assert.equal(git(["rev-parse","refs/tags/generated-installed-reviewed-tag"]).trim(),gitHead);
      assert.equal(git(["rev-parse","HEAD"]).trim(),gitHead);assert.deepEqual(await readFile(join(project,".git/index")),gitIndex);
      await deleteWithReviewedChildren(sdk,gitSession.id);assert.equal((await sdk.github.read(gitStarted.id)).operation.originSessionId,gitSession.id);
      assert.deepEqual((await sdk.cache.registries.list()).registries,[]);assert.equal((await sdk.containment.status()).containment.required,false);
      console.log("Installed protocol-41 SDK/runtime preserves tier lifetimes and independent promotion, disabled catalog/hooks, exact real Git publication and source-independent results without inference.");
      }` : ""}
      let operationSessionId;
      assert.equal(sdk.getState().snapshot.protocolVersion,PROTOCOL_VERSION);
      ${installedProtocol >= 62 ? `
      {
      const prices=await sdk.prices.catalog();assert.equal(prices.revision,0);
      assert.equal(prices.catalogs.find(value=>value.provider==="anthropic").prices.find(value=>value.modelId==="claude-opus-5.5").inputUsdPerMillion,4);
      const boardRoot=join(root,"generated-installed-kanban");await mkdir(boardRoot);
      const project=await sdk.projects.add(boardRoot,"generated_installed_kanban"),opened=await sdk.kanban.open(project.id);
      assert.equal((await sdk.kanban.open(project.id)).id,opened.id);
      const board=(await sdk.issues.board(project.id)).board;
      const card=await sdk.issues.create(project.id,{title:"Generated installed card",body:"Generated installed board source.",kind:"feature",phaseId:"backlog",pullRequestUrl:null});
      await sdk.issues.configure(project.id,{...board,kanban:{visible:false,source:"kanban",phaseIds:["backlog"]}},board.revision);
      await sdk.sessions.organize(opened.id,{workItemId:card.id,workItemUrl:null});
      assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===opened.id).purpose,"kanban");
      assert.equal((await sdk.kanban.items(project.id,"kanban",1,opened.id)).local[0].body,"Generated installed board source.");
      await sdk.slash(opened.id,"/kanban show","tui");
      assert.equal((await sdk.issues.board(project.id)).board.kanban.visible,true);
      assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===opened.id).workItemId,card.id);
      assert.equal(sdk.getState().snapshot.projectWorkRuns.length,0);
      assert.equal(sdk.getState().snapshot.settings.values.budgets.useProviderRatesForLimits,false);
      if(PROTOCOL_VERSION>=64){
        const second=await sdk.issues.create(project.id,{title:"Generated installed ordered card",body:"",kind:"misc",phaseId:"backlog",pullRequestUrl:null});
        const current=(await sdk.issues.board(project.id)).issues;
        const source=current.find(value=>value.id===second.id);
        await sdk.issues.reorder(second.id,"backlog",card.id,current.map(value=>({issueId:value.id,phaseId:value.phaseId,order:value.order??value.number})),source.revision);
        const ordered=(await sdk.issues.board(project.id)).issues.sort((a,b)=>(a.order??a.number)-(b.order??b.number));
        assert.deepEqual(ordered.map(value=>value.id),[second.id,card.id]);
        const reviewed=await sdk.slash(opened.id,"/continue-work","cli");
        assert.equal(reviewed.kind,"continue-work");assert.deepEqual(reviewed.choices,["kanban","prompt"]);
        assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===opened.id).draft.text,"/continue-work");
        assert.equal(sdk.getState().snapshot.projectWorkRuns.length,0);
        await sdk.command({type:"draft.save",sessionId:opened.id,expectedRevision:reviewed.review.expectedRevision,text:"",attachments:[]});
        console.log("Installed protocol-64 SDK/runtime preserves structural card order and returns an exact per-request continuation review without a model call.");
      }
      console.log("Installed Kanban SDK/runtime exposes one board chat, shared visibility/card bindings and public API-equivalent references without hidden inference or finite-limit consent.");
      }
      ` : ""}
      ${installedProtocol >= 65 ? `{
      const firstRoot=join(root,"generated-installed-group-first"),secondRoot=join(root,"generated-installed-group-second");
      await mkdir(firstRoot);await mkdir(secondRoot);await writeFile(join(firstRoot,"generated-group.txt"),"Generated installed first-root source.");
      const first=await sdk.projects.add(firstRoot),second=await sdk.projects.add(secondRoot);
      const grouped=await sdk.projects.group("Generated installed group",[{projectId:first.id,revision:0},{projectId:second.id,revision:0}]);
      const opened=await sdk.sessions.createFolder(grouped.id,"Generated installed folder chat");
      const original=sdk.getState().snapshot.sessions.find(value=>value.id===opened.id);
      assert.equal(original.projectId,null);assert.deepEqual(original.repositories.map(value=>value.projectId),[first.id,second.id]);
      await assert.rejects(()=>sdk.workspaces.files(opened.id,"."),{code:"repository_required"});
      assert.ok((await sdk.workspaces.files(opened.id,".",first.id)).entries.includes("generated-group.txt"));
      if(PROTOCOL_VERSION>=73){
        const current=sdk.settings.get();
        await sdk.settings.update({...current.values,permissions:{...current.values.permissions,tools:[...current.values.permissions.tools,
          {id:"generated-installed-folder-review",tool:"write_file",pathPrefix:"",decision:"ask"}]}},current.revision);
      }
      const tool=(await sdk.tools.catalog(opened.id,"write_file")).tools.find(value=>value.name==="write_file");
      const started=await sdk.tools.execute(opened.id,tool.name,{repository:second.id,path:"generated-external.txt",text:"Generated installed selected-root edit.",expectedDigest:"absent"},tool.schemaDigest);
      const approval=sdk.getState().snapshot.sessions.find(value=>value.id===opened.id).pendingApproval;
      await sdk.approvals.respond(opened.id,approval.id,true,{scope:"project",match:"tool"});
      assert.equal((await sdk.jobs.wait(started.id)).status,"completed");
      assert.equal(await readFile(join(secondRoot,"generated-external.txt"),"utf8"),"Generated installed selected-root edit.");
      const side=await sdk.sessions.side(opened.id),again=await sdk.sessions.side(opened.id);
      assert.equal(side.id,again.id);
      const question=sdk.getState().snapshot.sessions.find(value=>value.id===side.id);
      assert.equal(question.mode,"read-only");assert.deepEqual(question.repositories,original.repositories);
      assert.deepEqual(question.controls,original.controls);
      await assert.rejects(()=>sdk.voice.readCapture(side.id,randomUUID(),randomUUID()),{code:"speech_capture_owner"});
      await assert.rejects(()=>sdk.voice.appendCapture(side.id,randomUUID(),randomUUID(),1,new Uint8Array(2)),{code:"speech_capture_owner"});
      const host=fileURLToPath(new URL("./node_modules/${sdkName}/dist/speech-host.mjs",import.meta.url));
      execFileSync(process.execPath,[host,process.execPath,"-e","setInterval(()=>{},1000)"],{input:"",timeout:10000});
      const failedHost=spawn(process.execPath,[host,process.execPath,"-e","process.kill(process.pid,'SIGTERM')"],{stdio:["pipe","ignore","pipe"]});
      let nativeDiagnostic="";failedHost.stderr.on("data",chunk=>{nativeDiagnostic+=chunk.toString();});
      assert.equal(await new Promise((resolve,reject)=>{failedHost.once("close",resolve);failedHost.once("error",reject);}),1);
      assert.match(nativeDiagnostic,/recognizer.*SIGTERM/);
      const grant=sdk.approvals.list().find(value=>value.scope.kind==="project"&&value.scope.projectId===second.id);
      await sdk.approvals.revoke(grant.id);
      if(PROTOCOL_VERSION>=73){
        const current=sdk.settings.get();
        await sdk.settings.update({...current.values,permissions:{...current.values.permissions,
          tools:current.values.permissions.tools.filter(rule=>rule.id!=="generated-installed-folder-review")}},current.revision);
      }
      await deleteWithReviewedChildren(sdk,opened.id);
      console.log("Installed protocol-65 typed root scopes, actual selected-root SDK edits, whole-tool grants, immediate read-only sides, private speech host and stream ownership gates pass without inference or audio capture.");
      }` : ""}
      ${installedProtocol >= 71 ? `
      {
        const speechBytes=Buffer.from("Generated installed buffered-readiness recognizer weights.");
        const speechState=join(root,"generated-installed-speech");
        const speechProvider=()=>({state:{status:"disconnected",models:[],login:null,diagnostic:null},onChange:()=>{},refresh:async()=>{},cancel:async()=>{},logout:async()=>{},
          login:()=>{throw new Error("Generated speech probe forbids personal login");},prepare:async()=>{throw new Error("Generated speech probe forbids inference");}});
        const speechOptions=(args=[])=>({stateDir:speechState,retentionKey:Buffer.alloc(32,0x68),provider:speechProvider(),platform:{speech:{
          executable:process.execPath,prefixArgs:[${JSON.stringify(resolve("tests/fixtures/fake-speech.mjs"))},...args],
          model:{id:"generated-installed-speech",revision:"generated",filename:"generated-installed-speech.gguf",bytes:speechBytes.length,
            sha256:createHash("sha256").update(speechBytes).digest("hex"),license:"Generated fixture only"},fetch:async()=>new Response(speechBytes)}}});
        let speechRuntime=await createRuntime(speechOptions(["--buffered-ready","--listener-delay","200"]));
        let speechSdk=await connectMoguri({stateDir:speechState,autoStart:false});
        try{
          const owner=await speechSdk.sessions.create(null,"Generated installed speech owner");
          await speechSdk.jobs.wait((await speechSdk.voice.download(true)).id);
          const lease=await speechSdk.voice.startCapture(owner.id,undefined,{streaming:true});
          const pcm=new Uint8Array(6400).fill(1);
          await speechSdk.voice.appendCapture(owner.id,lease.id,lease.token,1,pcm);
          await speechSdk.voice.finishCapture(owner.id,lease.id,lease.token,1);
          assert.equal((await speechSdk.jobs.wait(lease.id)).status,"completed");
          assert.equal(await speechSdk.voice.transcript(owner.id,lease.id),"Generated local dictation.");
          const retained=JSON.stringify(speechSdk.getState().events);
          assert.ok(!retained.includes(lease.token));assert.ok(!retained.includes(Buffer.from(pcm).toString("base64")));
          assert.equal(speechSdk.getState().snapshot.budgetEntries.length,0);
          speechSdk.disconnect();await speechRuntime.close();
          speechRuntime=await createRuntime(speechOptions(["--fail-with-diagnostic"]));
          speechSdk=await connectMoguri({stateDir:speechState,autoStart:false});
          assert.equal(await speechSdk.voice.transcript(owner.id,lease.id),"Generated local dictation.");
          const failedLease=await speechSdk.voice.startCapture(owner.id,undefined,{streaming:true});
          const failed=await speechSdk.jobs.wait(failedLease.id);
          assert.equal(failed.status,"failed");assert.match(failed.error,/Generated recognizer could not initialize/);
          await assert.rejects(()=>speechSdk.voice.readCapture(owner.id,failedLease.id,failedLease.token),{message:failed.error});
          await assert.rejects(()=>speechSdk.voice.startCapture(owner.id,lease.id,{streaming:true}),/already exists|identity/i);
          console.log("Installed protocol-71 service/SDK uses delayed authenticated readiness without a stdout event, retains the exact final transcript across restart, preserves original capture errors and never replays PCM or inference.");
        }finally{speechSdk.disconnect();await speechRuntime.close();}
      }
      ` : ""}
      const profileCreation=await sdk.profiles.create("Generated installed profile","#557799");
      const profile=await sdk.profiles.wait(profileCreation.id);
      beta=await sdk.profiles.open(profile.id);
      ${installedProtocol >= 36 ? `
      assert.deepEqual(modelContextWindows({contextWindow:32769}),{source:"maximum-and-half",values:[32769,16384]});
      const pasteSession=await sdk.sessions.create(null,"Generated installed exact paste");
      const pasteDraft=sdk.getState().snapshot.sessions.find(session=>session.id===pasteSession.id).draft;
      const pasteEditor=new DraftEditor(sdk,pasteSession.id,pasteDraft);
      const exactPaste=Array.from({length:51},(_,index)=>"Generated installed paste "+index+" 🍊").join("\\r\\n");
      try{
        await pasteEditor.paste(exactPaste);
        const captured=sdk.getState().snapshot.sessions.find(session=>session.id===pasteSession.id).draft;
        assert.equal(captured.text,"");assert.equal(captured.attachments[0].kind,"paste_file");
        const file=captured.attachments[0];
        assert.deepEqual((await sdk.attachments.read(pasteSession.id,file.id)).content,{kind:"text",text:exactPaste});
        await assert.rejects(()=>beta.attachments.read(pasteSession.id,file.id),{code:"attachment_session"});
        await pasteEditor.send("queue",true);
        const held=sdk.getState().snapshot.sessions.find(session=>session.id===pasteSession.id).queue[0];
        assert.equal(held.held,true);assert.equal(held.text,"");assert.equal(held.attachments[0].digest,file.digest);
        await deleteWithReviewedChildren(sdk,pasteSession.id);
        await assert.rejects(()=>sdk.attachments.read(pasteSession.id,file.id),{code:"attachment_session"});
      }finally{pasteEditor.dispose();}
      ` : ""}
      assert.equal(Reflect.set(sdk,"profileId",profile.id),false);
      assert.equal(sdk.profileId,"default");assert.equal(beta.profileId,profile.id);
      assert.equal(beta.getState().snapshot.projects.length,0);assert.equal(beta.getState().snapshot.sessions.length,0);
      assert.equal(beta.getState().snapshot.provider.status,"disconnected");
      ${installedProtocol >= 53 ? `
      {
      assert.deepEqual(sdk.settings.get().values.interactions,{confirmSessionAttachments:true,confirmTerminalClose:true,...(PROTOCOL_VERSION>=60?{confirmSessionDetach:true}:{})});
      const interactionRoot=join(root,"generated-interaction-project");await mkdir(interactionRoot);
      await writeFile(join(interactionRoot,"generated.txt"),"Generated installed interaction snapshot.");
      const interactionProject=await sdk.projects.add(interactionRoot,"generated_interactions");
      const first=await sdk.sessions.create(interactionProject.id,"Generated installed first"),second=await sdk.sessions.create(interactionProject.id,"Generated installed second");
      await sdk.sessions.reorder([second.id,first.id]);
      assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===second.id).order,0);
      const source=await sdk.attachments.projectPath(first.id,interactionProject.id,"generated.txt");
      assert.equal(source.kind,"file");assert.equal(source.path,join(await realpath(interactionRoot),"generated.txt"));
      const captured=await sdk.attachments.file(first.id,source.path);
      assert.equal((await sdk.attachments.read(first.id,captured.id)).content.text,"Generated installed interaction snapshot.");
      await assert.rejects(()=>beta.attachments.read(first.id,captured.id),{code:"attachment_session"});
      await sdk.slash(first.id,"/reorder-sessions "+first.id+" "+second.id,"tui");
      assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===first.id).order,0);
      await deleteWithReviewedChildren(sdk,first.id);await deleteWithReviewedChildren(sdk,second.id);await sdk.projects.remove(interactionProject.id,true,0);
      console.log("Installed protocol-53 browser-safe SDK and TUI commands preserve safe identifiers, exact Local context resolution, profile-private snapshots and atomic shared sibling order without inference.");
      }
      ` : ""}
      ${installedProtocol >= 53 ? `
      {
      const activityRoot=join(root,"generated-activity-project");await mkdir(activityRoot);
      const activityText="---\\nname: generated-installed-activity\\ndescription: Generated installed skill\\n---\\nGenerated exact retained skill bytes.\\n";
      const activityPath=join(activityRoot,"SKILL.md");await writeFile(activityPath,activityText);
      const activityProject=await sdk.projects.add(activityRoot,"generated_activity");
      const activitySession=await sdk.sessions.create(activityProject.id,"Generated installed activity");
      assert.deepEqual((await sdk.activity.list(activitySession.id)).activity.entries,[]);
      const imported=await sdk.capabilities.importSkill(activityProject.id,activityPath);await sdk.capabilities.toggle(imported.id,true,0);
      const skill=sdk.getState().snapshot.registry.find(value=>value.id===imported.id);
      ${installedProtocol >= 98 ? "await admitSkill(sdk,activitySession.id,skill.id,skill.contentDigest);" : ""}
      ${installedProtocol >= 107 ? `
      await sdk.capabilities.useSkill(activitySession.id,skill.id,skill.contentDigest);
      const chip=sdk.getState().snapshot.sessions.find(value=>value.id===activitySession.id).draft.attachments.find(value=>value.kind==="skill");
      assert.equal(chip.path,skill.name);assert.ok((await sdk.attachments.read(activitySession.id,chip.id)).content.text.includes(activityText));
      assert.deepEqual((await sdk.activity.list(activitySession.id)).activity.entries,[]);
      await sdk.skills.consume(activitySession.id,skill.id,skill.contentDigest);` : "await sdk.capabilities.useSkill(activitySession.id,skill.id,skill.contentDigest);"}
      const loaded=(await sdk.activity.list(activitySession.id)).activity.entries[0];
      const retainedSkill=(await sdk.activity.read(activitySession.id,loaded.id,"output")).content.text;
      assert.equal(loaded.kind,"load-skill");assert.equal(loaded.actor,${installedProtocol >= 107 ? '"model"' : '"user"'});assert.equal(loaded.turnId,null);
      assert.equal(loaded.outputBytes,Buffer.byteLength(retainedSkill));assert.ok(retainedSkill.includes(activityText));
      assert.equal(JSON.parse((await sdk.activity.read(activitySession.id,loaded.id,"arguments")).content.text).contentDigest,createHash("sha256").update(retainedSkill).digest("hex"));
      await assert.rejects(()=>beta.activity.list(activitySession.id),{code:"activity_scope"});
      await assert.rejects(()=>beta.activity.read(activitySession.id,loaded.id,"output"),{code:"activity_scope"});
      assert.equal((await sdk.slash(activitySession.id,"/activity","tui")).kind,"text");
      ${installedProtocol >= 53 ? `
      assert.deepEqual((await sdk.agentTerminals.list(activitySession.id)).activity.entries,[]);
      await assert.rejects(()=>sdk.agentTerminals.read(activitySession.id,loaded.id),{code:"activity_missing"});
      await assert.rejects(()=>beta.agentTerminals.list(activitySession.id),{code:"activity_scope"});
      const agentShared=await sdk.slash(activitySession.id,"/agent-terminal list","tui");
      assert.equal(agentShared.kind,"text");assert.deepEqual(JSON.parse(agentShared.text).activity.entries,[]);
      console.log("Installed protocol-53 Agent SDK/React/TUI views preserve exact session/profile/source filters; a retained skill cannot masquerade as a command and inspection starts no shell or inference.");
      ` : ""}
      await deleteWithReviewedChildren(sdk,activitySession.id);
      await assert.rejects(()=>sdk.activity.read(activitySession.id,loaded.id,"output"),{code:"activity_scope"});
      await sdk.projects.remove(activityProject.id,true,(await sdk.projects.configuration(activityProject.id)).configuration.revision);
      console.log("Installed protocol-53 SDK/React/TUI activity preserves exact session-granted source bytes, profile/deletion isolation and actual user provenance without inference or private-ledger content.");
      }
      ` : ""}
      ${installedProtocol >= 54 ? `
      {
      const linkedPr="https://github.com/generated/example/pull/7",pr=await sdk.sessions.fromWork(p.id,{prUrl:linkedPr});
      const state=sdk.getState().snapshot,owner=state.sessions.find(value=>value.id===pr.id);
      assert.equal(owner.prObservation.pullRequest.draft,true);assert.equal(sessionIndicator(owner,state).prState,"draft");
      assert.equal(sessionPrScope(owner,state).root,await realpath(project));assert.equal(sessionPullRequestUrl(owner,state),linkedPr);
      assert.equal(sessionPullRequest(owner,beta.getState().snapshot),null);
      assert.equal((await sdk.slash(pr.id,"/pr","tui")).url,linkedPr);assert.equal(sessionPrLookups,1);
      const publicPr=await sdk.sessions.create(null,"Generated installed root-null PR");
      await sdk.sessions.organize(publicPr.id,{prUrl:linkedPr});
      for(let attempt=0;attempt<200&&!sdk.getState().snapshot.sessions.find(value=>value.id===publicPr.id).prObservation;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      const publicOwner=sdk.getState().snapshot.sessions.find(value=>value.id===publicPr.id);
      assert.equal(publicOwner.prObservation.scope.root,null);assert.equal(publicOwner.prObservation.scope.access,"public");
      assert.equal(publicOwner.status,"idle");assert.equal(sessionPrLookups,2);
      await deleteWithReviewedChildren(sdk,publicPr.id);await deleteWithReviewedChildren(sdk,pr.id);
      console.log("Installed protocol-54 browser-safe session/PR selectors, retained draft metadata and shared TUI PR commands preserve exact project/profile and public root-null scope without a model, Git write or duplicate verification.");
      }
      ` : ""}
      const betaSession=await beta.sessions.create(null,"Generated installed Beta chat");
      assert.equal(beta.getState().snapshot.sessions[0].controls.modelId,null);
      const betaDocument=await beta.artifacts.create(betaSession.id,{kind:"decision",name:"Generated Beta private note",text:"Generated Beta-only installed bytes."});
      await assert.rejects(()=>sdk.artifacts.read(betaDocument.id),/outside this profile/);
      assert.equal(beta.getState().snapshot.profileId,profile.id);
      assert.equal((await beta.voice.status()).voice.runtimeReady,true);
      assert.deepEqual((await beta.mcp.tools("builtin","",0,betaSession.id)).tools.map(tool=>tool.name),${JSON.stringify(rootlessTools)});
      for(const client of [sdk,beta]){const settings=structuredClone(client.settings.get().values);settings.mcpServers=[{id:"generated-installed-mcp",name:"Generated scoped MCP",enabled:true,transport:{type:"http",url:"https://generated-sdk.invalid/mcp",auth:"bearer"}}];await client.settings.update(settings,client.settings.get().revision);}
      await sdk.mcp.setToken("generated-installed-mcp","generated-installed-default-only");
      assert.equal((await sdk.mcp.auth("generated-installed-mcp")).state,"configured");
      assert.equal((await beta.mcp.auth("generated-installed-mcp")).state,"required");
      await sdk.profiles.update(profile.id,{name:"Generated installed profile renamed"},profile.revision);
      assert.equal(beta.profileId,profile.id);
      const isolated=await sdk.workspaces.create(p.id,"moguri/generated-external");
      const owned=await sdk.workspaces.wait(isolated.id);
      assert.ok((await sdk.workspaces.discover(p.id)).registrations.some(entry=>entry.managedId===owned.id&&entry.locked));
      const bound=await sdk.sessions.create(p.id,"Generated external worktree",{env:"Local"},owned.id);
      assert.match((await sdk.workspaces.file(bound.id,"generated.ts")).text,/portableSdkMemory/);
      assert.equal((await sdk.workspaces.git(bound.id)).branch,"moguri/generated-external");
      await deleteWithReviewedChildren(sdk,bound.id);
      await sdk.workspaces.remove(owned.id,owned.revision,true);
      assert.equal((await sdk.workspaces.wait(owned.id)).status,"removed");
      if(PROTOCOL_VERSION>=29){
        const directory=join(root,"generated-installed-candidates");await mkdir(directory);
        const original="Generated installed candidate base.\\n",proposed="Generated installed reviewed candidate.\\n";
        await writeFile(join(directory,"candidate.txt"),original);
        git(["init","--initial-branch=main"],directory);git(["add","--","candidate.txt"],directory);
        git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated installed candidate base"],directory);
        const options={stateDir:join(root,"candidate-state"),provider:makeProvider(),retentionKey:Buffer.alloc(32,0x68),platform:{terminal:{defaultRoot:generatedHome,vault:remoteVault}}};
        let candidateRuntime=await createRuntime(options),candidateSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
        try{
          let budgetOwnerId=null;
          if(PROTOCOL_VERSION>=30){
            const owner=await candidateSdk.sessions.create(null,"Generated installed planned hold",{env:"Local",modelId:null});budgetOwnerId=owner.id;
            const control=candidateRuntime.controller,current=control.snapshot().sessions.find(session=>session.id===owner.id);
            const planned=control.platform.budgets.plan(current,{id:randomUUID(),turnId:randomUUID(),modelId:"generated-planned-model",providerId:"generated-provider",apiModelId:"generated-canonical",
              role:"checkpoint",inputEstimate:10,maxOutputTokens:20,authorityDigest:"a".repeat(64)});
            control.store.commit([planned.event]);control.refreshProfile();
            const page=await candidateSdk.budgets.plans({sessionId:owner.id,status:"held"});assert.equal(page.plans[0].id,planned.plan.id);
            const status=(await candidateSdk.budgets.status(owner.id)).status;assert.equal(status.totals.calls,0);assert.equal(status.totals.plannedHeldTokens,30);
            const shared=await candidateSdk.slash(owner.id,"/dashboard plans "+JSON.stringify({sessionId:owner.id}),"tui");assert.equal(JSON.parse(shared.text).plans[0].id,planned.plan.id);
            if(typeof control.platform.budgets.planBatch==="function"){
              const turnId=randomUUID(),requests=["critic","checkpoint"].map(role=>({id:randomUUID(),turnId,modelId:"generated-planned-model",providerId:"generated-provider",apiModelId:"generated-canonical",role,inputEstimate:10,maxOutputTokens:20,authorityDigest:"b".repeat(64)}));
              await candidateSdk.budgets.policy({basis:"estimate",tokens:89},0,true);
              assert.throws(()=>control.platform.budgets.planBatch(current,requests),{code:"budget_plan_capacity"});assert.equal(control.snapshot().budgetPlans.length,1);
              await candidateSdk.budgets.policy({basis:"estimate",tokens:90},1,true);
              const batch=control.platform.budgets.planBatch(current,requests);control.store.commit(batch.events);control.refreshProfile();
              assert.equal((await candidateSdk.budgets.status(owner.id)).status.totals.plannedHeldTokens,90);
              assert.equal((await candidateSdk.budgets.calls({sessionId:owner.id})).calls.length,0);
              console.log("Installed complete planned-capacity batches honor cumulative finite limits, retain no failed prefix and create no model calls.");
            }
            await deleteWithReviewedChildren(candidateSdk,owner.id,control.snapshot().sessions.find(session=>session.id===owner.id).revision);
            const released=(await candidateSdk.budgets.plans({sessionId:owner.id})).plans;
            assert.equal(released.length,typeof control.platform.budgets.planBatch==="function"?3:1);assert.ok(released.every(plan=>plan.status==="released"));
            assert.equal((await candidateSdk.budgets.dashboard({sessionId:owner.id})).totals.plannedHolds,0);
            assert.equal((await candidateSdk.budgets.calls({sessionId:owner.id})).calls.length,0);
          }
          const project=await candidateSdk.command({type:"project.add",path:directory}),source=await candidateSdk.sessions.create(project.id,undefined,undefined,undefined,"checkout");
          const created=await candidateSdk.workspaces.create(project.id,"moguri/generated-installed-candidate"),stage=await candidateSdk.workspaces.wait(created.id);
          const index=await readFile(join(directory,".git/index")),head=git(["rev-parse","HEAD"],directory);
          const patch={kind:"patch",summary:"Generated installed exact candidate.",edits:[{path:"candidate.txt",baseDigest:createHash("sha256").update(original).digest("hex"),text:proposed}]};
          const preview=(await candidateSdk.candidates.preview(source.id,stage.id,patch)).preview;
          const staged=await candidateSdk.candidates.wait((await candidateSdk.candidates.stage(source.id,stage.id,patch,preview.digest)).id);
          assert.equal(staged.candidate.status,"staged");assert.equal(await readFile(join(directory,"candidate.txt"),"utf8"),original);
          const review=(await candidateSdk.candidates.applyPreview(staged.candidate.id,source.id)).preview,commandId=randomUUID();
          const command={type:"candidate.apply",candidateId:staged.candidate.id,sessionId:source.id,expectedRevision:staged.candidate.revision,expectedDigest:review.digest,confirm:true};
          await candidateSdk.command(command,commandId);assert.equal((await candidateSdk.candidates.wait(staged.candidate.id)).candidate.status,"applied");
          assert.deepEqual(await readFile(join(directory,".git/index")),index);assert.equal(git(["rev-parse","HEAD"],directory),head);
          assert.equal(JSON.parse((await candidateSdk.artifacts.export(staged.candidate.id)).export.text).schemaVersion,PROTOCOL_VERSION>=57?10:2);
          if(PROTOCOL_VERSION>=57)assert.equal((await candidateSdk.candidates.eligibility(source.id)).eligible,true);
          const shared=await candidateSdk.slash(source.id,"/candidate read "+staged.candidate.id,"tui");assert.equal(shared.kind,"text");
          candidateSdk.disconnect();await candidateRuntime.close();candidateRuntime=await createRuntime(options);candidateSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
          assert.equal((await candidateSdk.candidates.read(staged.candidate.id)).candidate.acceptance.actor,"user");
          if(PROTOCOL_VERSION>=30){assert.equal((await candidateSdk.budgets.plans({sessionId:budgetOwnerId})).plans[0].status,"released");console.log("Installed protocol-30 planned holds, SDK/shared queries and source-deletion/restart release remain distinct from actual model calls.");}
          await writeFile(join(directory,"candidate.txt"),"Generated newer installed user edit.\\n");
          assert.equal((await candidateSdk.command(command,commandId)).id,staged.candidate.id);
          assert.equal(await readFile(join(directory,"candidate.txt"),"utf8"),"Generated newer installed user edit.\\n");
          if(PROTOCOL_VERSION>=57){
            await deleteWithReviewedChildren(candidateSdk,source.id);
            await assert.rejects(()=>candidateSdk.candidates.read(staged.candidate.id),{code:"candidate_missing"});
            assert.equal(await readFile(join(directory,"candidate.txt"),"utf8"),"Generated newer installed user edit.\\n");
          }
          console.log("Installed SDK candidate stage, separate exact apply, ownership-bearing history, exact retention boundaries and canonical restart replay preserved source index/HEAD without a model.");
        }finally{candidateSdk.disconnect();await candidateRuntime.close();}
      }
      const general=await sdk.sessions.create();
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===general.id).projectId,null);
      if(PROTOCOL_VERSION>=72)assert.equal((await sdk.workspaces.home(general.id)).root.root,await realpath(generatedHome));
      if(PROTOCOL_VERSION>=57)assert.equal((await sdk.candidates.eligibility(general.id)).eligible,false);
      assert.equal((await sdk.suggestions.preview(general.id)).preview.scope,"project-free");
      if(PROTOCOL_VERSION>=73){
        const before=(await sdk.budgets.dashboard()).totals.calls;
        await sdk.webAllowlist.add("global.example.invalid",{kind:"global"});
        await sdk.webAllowlist.add("project.example.invalid",{kind:"project",projectId:p.id});
        await sdk.webAllowlist.add("session.example.invalid",{kind:"session",sessionId:general.id});
        assert.deepEqual(sdk.webAllowlist.list(general.id).map(entry=>entry.site),["global.example.invalid","session.example.invalid"]);
        assert.deepEqual(sdk.webAllowlist.list(s.id).map(entry=>entry.site),["global.example.invalid","project.example.invalid"]);
        const shared=await sdk.slash(general.id,"/firewall list","tui");assert.equal(shared.kind,"text");assert.equal(JSON.parse(shared.text).effective.length,2);
        for(const entry of [...sdk.webAllowlist.list()])await sdk.webAllowlist.remove(entry.id);
        const write=(await sdk.tools.catalog(general.id,"write_file")).tools.find(tool=>tool.name==="write_file");
        const written=await sdk.tools.execute(general.id,write.name,{path:"generated-installed-native-policy.txt",text:"GENERATED_NATIVE_POLICY\\n",expectedDigest:"absent"},write.schemaDigest);
        assert.equal(sdk.getState().snapshot.sessions.find(session=>session.id===general.id).pendingApproval,null);
        assert.equal((await sdk.jobs.wait(written.id)).status,"completed");
        const read=(await sdk.tools.catalog(general.id,"read_file")).tools.find(tool=>tool.name==="read_file");
        const refreshed=await sdk.tools.execute(general.id,read.name,{path:"generated-installed-native-policy.txt",expectedDigest:"0".repeat(64)},read.schemaDigest);
        assert.equal((await sdk.jobs.wait(refreshed.id)).status,"completed");
        const original=JSON.parse((await sdk.mcp.readResult(refreshed.id)).text),view=JSON.parse(original.text);
        assert.equal(original.isError,false);assert.equal(view.text,"GENERATED_NATIVE_POLICY\\n");
        assert.equal(view.sourceVersion.refreshed,true);assert.equal(view.sourceVersion.requestedDigest,"0".repeat(64));
        assert.match(view.sourceRef.expectedDigest,/^[a-f0-9]{64}$/);assert.notEqual(view.sourceRef.expectedDigest,"0".repeat(64));
        const nativeDecisions=sdk.getState().events.filter(event=>event.session_id===general.id&&event.event_type==="tool.decided");
        assert.equal(nativeDecisions.length,2);assert.ok(nativeDecisions.every(event=>event.payload.actor==="policy"));
        assert.equal((await sdk.budgets.dashboard()).totals.calls,before);
        console.log("Installed protocol-73 SDK/shared TUI preserve exact scoped Local website allowances, policy-owned native Home writes/reads and explicit fresh-source provenance without a model call.");
      }
      if(PROTOCOL_VERSION>=72&&process.platform==="darwin"){
        const homeOptions={stateDir:join(root,"home-execution-state"),provider:makeProvider(),retentionKey:Buffer.alloc(32,0x72),
          platform:{terminal:{...platform.terminal,defaultRoot:generatedHome,vault:remoteVault}}};
        let homeRuntime=await createRuntime(homeOptions),homeSdk=await connectMoguri({stateDir:homeOptions.stateDir,autoStart:false});
        try{
          const created=await homeSdk.sessions.create(null,"Generated installed Home chat"),homeId=created.id;
          await homeSdk.sessions.autonomy(homeId,"Autopilot");
          const bound=(await homeSdk.workspaces.home(homeId)).root;
          assert.equal(bound.root,await realpath(generatedHome));assert.equal(homeSdk.getState().snapshot.projects.length,0);
          const fileTool=(await homeSdk.tools.catalog(homeId,"write_file")).tools.find(tool=>tool.name==="write_file");
          const written=await homeSdk.tools.execute(homeId,fileTool.name,{path:"generated-installed-home.txt",text:"GENERATED_INSTALLED_HOME\\n",expectedDigest:"absent"},fileTool.schemaDigest);
          assert.equal((await homeSdk.jobs.wait(written.id)).status,"completed");
          assert.equal((await homeSdk.workspaces.file(homeId,"generated-installed-home.txt")).text,"GENERATED_INSTALLED_HOME\\n");
          const commandTool=(await homeSdk.tools.catalog(homeId,"run_command")).tools.find(tool=>tool.name==="run_command");
          const command=await homeSdk.tools.execute(homeId,commandTool.name,{command:"pwd",timeoutMs:2000},commandTool.schemaDigest);
          assert.equal((await homeSdk.jobs.wait(command.id)).status,"completed");
          const agent=(await homeSdk.agentTerminals.list(homeId)).activity.entries[0];
          assert.ok((await homeSdk.agentTerminals.read(homeId,agent.id)).content.text.includes(bound.root));
          assert.equal(homeSdk.getState().snapshot.chatWriters.filter(writer=>writer.status==="settled").length,2);
          const tui=await homeSdk.slash(homeId,"/home","tui");assert.equal(tui.kind,"text");assert.deepEqual(JSON.parse(tui.text).root,bound);
          const view=JSON.parse((await homeSdk.slash(homeId,"/home status","cli")).text);
          assert.deepEqual(view.root,bound);assert.deepEqual(view.writers,[]);
          homeSdk.disconnect();await homeRuntime.close();
          const alternate=join(root,"generated-alternate-home");await mkdir(alternate);
          homeRuntime=await createRuntime({...homeOptions,platform:{terminal:{...homeOptions.platform.terminal,defaultRoot:alternate}}});
          homeSdk=await connectMoguri({stateDir:homeOptions.stateDir,autoStart:false});
          assert.deepEqual((await homeSdk.workspaces.home(homeId)).root,bound);
          assert.equal((await homeSdk.workspaces.file(homeId,"generated-installed-home.txt")).text,"GENERATED_INSTALLED_HOME\\n");
          assert.equal(homeSdk.getState().snapshot.sessions.find(session=>session.id===homeId).projectId,null);
          console.log("Installed protocol-72 SDK/shared TUI execute approved Home files and commands without a project, read actual Agent output, retain exact writer settlement and preserve the original Home across changed-default restart without inference.");
        }finally{homeSdk.disconnect();await homeRuntime.close();}
      }
      assert.equal((await sdk.remote.status()).remote.ready,false);
      if(PROTOCOL_VERSION>=17&&process.env.MOGURI_GENERATED_REMOTE){
        const target=JSON.parse(process.env.MOGURI_GENERATED_REMOTE),remoteDirectory=join(root,"generated-remote-workspace");
        await mkdir(remoteDirectory);const remoteRoot=await realpath(remoteDirectory);await mkdir(join(remoteRoot,"docs"));
        await writeFile(join(remoteRoot,"generated.ts"),"Generated installed SSH baseline.\\n");
        git(["init","--initial-branch=generated-remote"],remoteRoot);git(["add","--","generated.ts"],remoteRoot);
        git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated remote SDK base"],remoteRoot);
        await writeFile(join(remoteRoot,"generated.ts"),"Generated installed SSH-only change.\\n");
        await writeFile(join(remoteRoot,"docs/plan.md"),"Generated installed SSH-only plan.\\n");
        const settings=structuredClone(sdk.settings.get());settings.values.remote=target;
        await sdk.settings.update(settings.values,settings.revision);await sdk.remote.probe();
        const configuration=(await sdk.projects.configuration(p.id)).configuration;
        await sdk.projects.configure(p.id,{...configuration.values,remotePath:remoteRoot},configuration.revision);
        const viewer=await sdk.sessions.create(p.id,"Generated installed SSH views",{env:"Remote",modelId:null});
        assert.equal((await sdk.workspaces.file(viewer.id,"generated.ts")).text,"Generated installed SSH-only change.\\n");
        assert.ok((await sdk.workspaces.files(viewer.id)).entries.includes("docs/"));
        assert.match((await sdk.workspaces.git(viewer.id)).diff,/Generated installed SSH-only change/);
        assert.equal((await sdk.plans.read(viewer.id)).text,"Generated installed SSH-only plan.\\n");
        assert.deepEqual(await sdk.slash(viewer.id,"/plan","cli"),{kind:"text",text:"Generated installed SSH-only plan.\\n"});
        if(PROTOCOL_VERSION>=20){
          const plan=await sdk.plans.read(viewer.id);
          const saved=await sdk.plans.save(viewer.id,"Generated actual installed first Remote plan save.\\n",plan.digest,plan.bindingDigest);
          assert.equal((await sdk.plans.read(viewer.id)).text,"Generated actual installed first Remote plan save.\\n");
          const retained=await sdk.artifacts.read(saved.id);assert.equal(retained.artifact.sources[0].boundary.env,"Remote");assert.equal(retained.artifact.sources[0].boundary.root,remoteRoot);
          assert.equal(retained.artifact.sources[0].actor,"user");
          const actual=await sdk.plans.read(viewer.id);
          const second=await sdk.plans.save(viewer.id,"Generated actual installed SDK Remote plan save.\\n",actual.digest,actual.bindingDigest);
          const operations=(await sdk.plans.saves(viewer.id)).saves;
          assert.equal(operations.length,2);assert.ok(operations.every(value=>value.status==="completed"&&value.fileOutcome==="written"));
          assert.equal((await sdk.plans.saveInfo(viewer.id,operations[1].id)).result.text,"Generated actual installed SDK Remote plan save.\\n");
          assert.equal((await sdk.artifacts.read(second.id)).text,"Generated actual installed SDK Remote plan save.\\n");
          await assert.rejects(()=>sdk.plans.stopSave(viewer.id,operations[0].id),/settled|newer|ownership/);
          assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===viewer.id).usage.length,0);
          assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===viewer.id).messages.some(value=>value.role==="user"),false);
        }
        if(PROTOCOL_VERSION>=24){
          const preview=(await sdk.mcp.remotePreview(viewer.id,"builtin")).preview;
          assert.equal(preview.granted,false);assert.equal((await sdk.mcp.servers(viewer.id)).servers[0].state,"review-required");
          await sdk.mcp.grantRemote(viewer.id,"builtin",preview.digest,preview.settingsRevision,false,true);await sdk.remote.probe();
          const tool=(await sdk.mcp.tools("builtin","grep",0,viewer.id)).tools.find(tool=>tool.name==="grep_logs");
          assert.equal(tool.scope.root,remoteRoot);
          const pending=await sdk.mcp.call(viewer.id,"builtin",tool.name,{path:"generated.ts",query:"SSH-only change"},tool.digest);
          const waiting=(await sdk.mcp.remoteCalls(viewer.id)).calls[0];
          assert.equal(waiting.actor,"external");if(PROTOCOL_VERSION<73){assert.equal(waiting.executionId,null);assert.equal(waiting.accessForwarded,false);}
          const approval=sdk.getState().snapshot.sessions.find(value=>value.id===viewer.id).pendingApproval;
          if(PROTOCOL_VERSION>=73)assert.equal(approval,null);
          else await sdk.command({type:"approval.respond",sessionId:viewer.id,approvalId:approval.id,allow:true});
          assert.equal((await sdk.jobs.wait(pending.id)).status,"completed");
          const call=(await sdk.mcp.remoteCalls(viewer.id)).calls[0],result=await sdk.mcp.remoteCall(viewer.id,call.id);
          assert.equal(call.status,"completed");assert.equal(call.root,remoteRoot);
          assert.match(JSON.stringify(result.result),/Generated installed SSH-only change/);
          assert.equal(sdk.getState().snapshot.executions.find(value=>value.id===call.executionId).cleanup,"owned-worker-stopped");
          assert.equal((await sdk.telemetry.operations({sessionId:viewer.id,family:"mcp",env:"Remote"})).totals.completed,1);
          const inspected=await sdk.slash(viewer.id,"/mcp-remote inspect "+call.id,"tui");assert.equal(inspected.kind,"text");assert.match(inspected.text,/SSH-only change/);
          await sdk.mcp.revokeRemote(viewer.id,"builtin",sdk.settings.get().revision,true);
          assert.match(JSON.stringify((await sdk.mcp.remoteCall(viewer.id,call.id)).result),/SSH-only change/);
          assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===viewer.id).usage.length,0);
        }
        assert.match((await sdk.workspaces.file(s.id,"generated.ts")).text,/portableSdkMemory/);
      }
      const workerPath=fileURLToPath(new URL("../worker.mjs",import.meta.resolve("${sdkName}/node")));
      const workerHash=createHash("sha256").update(await readFile(workerPath)).digest("hex");
      const role=spawn(process.execPath,[${JSON.stringify(join(packageRoot, "bin", "moguri-worker.mjs"))},"--stdio"],{stdio:["pipe","pipe","pipe"]});
      const roleExit=new Promise(resolve=>role.once("exit",resolve));
      try {
        const response=await new Promise((resolve,reject)=>{
          let text="";const timer=setTimeout(()=>reject(new Error("Installed SSH worker entrypoint did not answer.")),10000);
          role.once("error",reject);
          role.stdout.on("data",data=>{text+=data;if(text.includes("\\n")){clearTimeout(timer);try{resolve(JSON.parse(text.split("\\n")[0]));}catch(error){reject(error);}}});
          role.stdin.write(JSON.stringify({action:"probe",protocol:PROTOCOL_VERSION,workerDigest:workerHash,stateDir:join(root,"unused-remote-state"),root:null})+"\\n");
        });
        assert.equal(response.kind,"probe");assert.equal(response.info.workerDigest,workerHash);
        role.stdin.end();assert.equal(await roleExit,0);
      } finally {if(role.exitCode===null&&role.signalCode===null){role.kill("SIGTERM");await roleExit;}}
      const source=join(root,"generated-client.txt");await writeFile(source,"Generated external client context.");
      const captured=await sdk.attachments.file(general.id,source);
      assert.equal((await sdk.attachments.read(general.id,captured.id)).content.text,"Generated external client context.");
      ${installedProtocol >= 43 ? `
      for(const [format,data] of ${JSON.stringify(documentInputs)}){
        const path=join(root,"generated-installed."+format);await writeFile(path,Buffer.from(data,"base64"));
        const captured=await sdk.attachments.document(general.id,path);
        const descriptor=await sdk.attachments.read(general.id,captured.id);assert.equal(descriptor.content.kind,"document");
        assert.equal((await sdk.attachments.original(general.id,captured.id)).data,data);
        const selection=format==="pdf"?{page:1}:format==="docx"?{section:2}:{sheet:"Generated sheet",range:"A1:C1"};
        const page=(await sdk.attachments.readDocument(general.id,captured.id,{...selection,limit:4096})).page;
        assert.equal(page.boundary,"scoped-controller-snapshot");assert.equal(page.untrusted,true);assert.match(page.text,/GENERATED_DOCUMENT_SECRET/);
        assert.ok(Buffer.byteLength(page.text)<=4096);
        const search=(await sdk.attachments.searchDocument(general.id,captured.id,{query:"GENERATED_DOCUMENT_SECRET",limit:2})).result;
        assert.equal(search.matches.length,1);
      }
      const checked=(await sdk.sessions.progress(general.id)).progress;assert.equal(checked.checklist.percent,null);assert.equal(checked.model,null);
      const documents=(await sdk.attachments.listDocuments(general.id,{limit:20})).result;assert.equal(documents.documents.length,3);assert.equal(JSON.stringify(documents).includes(root),false);
      console.log("Installed document worker, encrypted originals, bounded PDF/DOCX/XLSX reads/searches and progress API qualified without inference.");
      ` : ""}
      const folder=(await sdk.attachments.folderPreview(general.id,project)).preview;
      await sdk.attachments.folder(general.id,project,folder.digest,true);
      assert.deepEqual((await sdk.mcp.tools("builtin","",0,general.id)).tools.map(t=>t.name),${JSON.stringify(rootlessTools)});
      await assert.rejects(()=>sdk.plans.read(general.id),/Select a project/);
      const meta=await sdk.metachat.create(null,general.id,"Generated external settings request.");
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===meta.id).kind,"metachat");
      const proposal=await sdk.configuration.propose(meta.id,{target:"global",section:"instructions",value:"Generated external guidance.",reason:"Generated external exact review."});
      const reviewed=await sdk.configuration.review(proposal.id);
      await assert.rejects(()=>sdk.configuration.decide(proposal.id,true,reviewed.proposal.contentDigest,false),/Acknowledge/);
      await sdk.configuration.decide(proposal.id,true,reviewed.proposal.contentDigest,true);
      assert.equal(sdk.settings.get().values.instructions,"Generated external guidance.");
      assert.equal(sdk.settings.get().values.notifications.os,false);
      const context=(await sdk.sessions.context(s.id)).context;
      assert.ok(context.estimatedTokens>0);assert.equal(context.source,"estimated");
      if(process.platform==="darwin") {
        const terminal=await sdk.terminal.open(s.id);
        await sdk.terminal.input(terminal.id,"GENERATED_EXTERNAL_PTY_INPUT\\n");
        let output="";
        for(let index=0;index<50 && !(output.includes("GENERATED_EXTERNAL_PTY_READY") && output.includes("GENERATED_EXTERNAL_PTY_INPUT"));index++) {
          output=(await sdk.terminal.read(terminal.id)).data;
          if(!(output.includes("GENERATED_EXTERNAL_PTY_READY") && output.includes("GENERATED_EXTERNAL_PTY_INPUT"))) await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.match(output,/GENERATED_EXTERNAL_PTY_READY/); assert.match(output,/GENERATED_EXTERNAL_PTY_INPUT/);
        await sdk.terminal.close(terminal.id);
      }
      const editor=new DraftEditor(sdk,s.id,sdk.getState().snapshot.sessions.find(v=>v.id===s.id).draft);
      editor.edit("Generated external held prompt");
      const held=await editor.send("queue",true); editor.dispose();
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===s.id).queue[0].held,true);
      assert.equal(sdk.prompts.text(s.id,held.id),"Generated external held prompt");
      await sdk.slash(s.id,"/rename Generated external session","cli");
      await sdk.slash(s.id,"/read-only","cli");
      const side=await sdk.sessions.spawn(s.id,"side");
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===side.id).kind,"side");
      await assert.rejects(()=>sdk.sessions.mode(side.id,"agent"),/Question-only/);
      await sdk.slash(s.id,"/agent","cli");
      const projectSettings=(await sdk.projects.configuration(p.id)).configuration;
      await sdk.projects.configure(p.id,{...projectSettings.values,port:4321},projectSettings.revision);
      const artifact=await sdk.plans.save(s.id,"Generated external retained plan.","absent");
      const preview=await sdk.prompt.preview(s.id); assert.match(preview.effective,/moguri-execution-contract/);
      const settings=structuredClone(sdk.settings.get().values); settings.memory.enabled=true;
      await sdk.settings.update(settings,sdk.settings.get().revision);
      const job=await sdk.memory.index(p.id); assert.equal((await sdk.jobs.wait(job.id)).status,"completed");
      assert.ok((await sdk.memory.search(p.id,"portable sdk memory")).items.length>0);
      assert.ok((await sdk.mcp.tools("builtin","grep",0,s.id)).tools.some(t=>t.name==="grep_logs"));
      if(PROTOCOL_VERSION>=21){
        const beforeCalls=(await sdk.budgets.dashboard()).totals.calls;
        operationSessionId=(await sdk.sessions.create(p.id,"Generated installed MCP source",{env:"Local"},undefined,"checkout")).id;
        const actualTool=(await sdk.mcp.tools("builtin","grep",0,operationSessionId)).tools.find(value=>value.name==="grep_logs");
        assert.ok(actualTool);
        const actualJob=await sdk.mcp.call(operationSessionId,"builtin",actualTool.name,{path:"generated.ts",query:"portableSdkMemory"},actualTool.digest);
        if(PROTOCOL_VERSION>=73)assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===operationSessionId).pendingApproval,null);
        else{
          let actualApproval;
          for(let n=0;n<400&&!actualApproval;n++){actualApproval=sdk.getState().snapshot.sessions.find(value=>value.id===operationSessionId).pendingApproval;if(!actualApproval)await new Promise(resolve=>setTimeout(resolve,20));}
          assert.ok(actualApproval);await sdk.command({type:"approval.respond",sessionId:operationSessionId,approvalId:actualApproval.id,allow:true});
        }
        assert.equal((await sdk.jobs.wait(actualJob.id)).status,"completed");
        assert.equal((await sdk.telemetry.operations({sessionId:operationSessionId,family:"mcp"})).totals.completed,1);
        assert.equal((await sdk.budgets.dashboard()).totals.calls,beforeCalls);
        await sdk.refresh();await deleteWithReviewedChildren(sdk,operationSessionId);
      }
      const ticket=await sdk.issues.create(p.id,{title:"Generated external SDK ticket",body:"Generated",kind:"feature",phaseId:"backlog",pullRequestUrl:null});
      await sdk.issues.move(ticket.id,"in-progress",0);
      assert.equal((await sdk.issues.board(p.id)).issues[0].phaseId,"in-progress");
      await writeFile(join(project,"package.json"),JSON.stringify({name:"generated-sdk-cache",version:"1.0.0"}));
      await writeFile(join(project,"package-lock.json"),JSON.stringify({name:"generated-sdk-cache",version:"1.0.0",lockfileVersion:3,packages:{"":{name:"generated-sdk-cache",version:"1.0.0"}}}));
      const plan=(await sdk.cache.inspect(p.id,"npm")).plan;
      const prepared=await sdk.cache.prepare(p.id,"npm",plan.digest,true);
      assert.equal((await sdk.jobs.wait(prepared.id)).status,"completed");
      const installed=await sdk.cache.install(p.id,"npm",plan.digest,true);
      assert.equal((await sdk.jobs.wait(installed.id)).status,"completed");
      assert.equal((await sdk.voice.status()).voice.runtimeReady,true);
      assert.equal((await sdk.voice.status()).voice.modelReady,false);
      await deleteWithReviewedChildren(sdk,s.id);
      assert.equal((await sdk.plans.artifact(artifact.id)).text,"Generated external retained plan.");
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===side.id).parentSessionId,undefined);
      const artifactFolder=await sdk.projects.folder("Generated external artifact folder");
      const retained=await sdk.artifacts.create(null,{projectId:p.id,kind:"decision",name:"Generated independent project decision",text:"Generated first decision.",folderId:artifactFolder.id,workItemId:ticket.id});
      await sdk.artifacts.update(retained.id,{text:"Generated revised decision."},0);
      assert.equal((await sdk.artifacts.read(retained.id,0)).text,"Generated first decision.");
      const exported=(await sdk.artifacts.projectExport(p.id));
      const saved=await saveArtifactExport(join(root,"generated-external-artifacts.json"),exported.export);
      assert.equal(saved.digest,exported.export.digest);
      assert.equal(await readFile(saved.path,"utf8"),exported.export.text);
      const copyOptions={commitBranch:"moguri/generated-external-artifacts"};
      const copyPreview=(await sdk.artifacts.materializePreview(p.id,copyOptions)).preview;
      const publication=await sdk.artifacts.materialize(p.id,copyPreview.digest,copyOptions);
      assert.equal((await sdk.jobs.wait(publication.id)).status,"completed");
      const materialized=(await sdk.artifacts.materialization(publication.id)).result;
      assert.equal(createHash("sha256").update(await readFile(join(materialized.root,materialized.path))).digest("hex"),copyPreview.fileDigest);
      assert.equal(git(["rev-parse","HEAD"]).trim(),copyPreview.commit.base);
      assert.equal(git(["rev-parse",copyOptions.commitBranch]).trim(),materialized.commit.commit);
      const configuration=(await sdk.projects.configuration(p.id)).configuration;
      await sdk.projects.remove(p.id,true,configuration.revision,{action:"retain",expectedDigest:exported.preview.digest});
      assert.equal((await sdk.artifacts.read(retained.id)).artifact.projectId,null);
      assert.equal((await sdk.artifacts.read(retained.id)).artifact.workItemId,null);
      assert.equal((await sdk.artifacts.read(retained.id)).artifact.folderId,artifactFolder.id);
      await sdk.artifacts.delete(retained.id,2,true);
      await assert.rejects(()=>sdk.artifacts.read(retained.id),/missing|deleted|outside/);
      const generatedRequests=[];
      budgetServer=createServer(async(request,response)=>{
        if(PROTOCOL_VERSION>=70&&request.method==="GET"&&request.url.endsWith("/models")){
          response.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({data:[{id:"generated-external-budget"}]}));return;
        }
        const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
        const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));generatedRequests.push(body);
        response.writeHead(200,{"Content-Type":"text/event-stream"});
        const frame=(delta,finish_reason=null)=>response.write("data: "+JSON.stringify({id:"generated-external-response",object:"chat.completion.chunk",model:"generated-external-budget",choices:[{index:0,delta,finish_reason}]})+"\\n\\n");
        const user=body.messages.findLastIndex(value=>value.role==="user");
        if(body.messages.some(value=>["system","developer"].includes(value.role)&&String(value.content).includes("You classify a Moguri task"))){
          frame({role:"assistant",content:JSON.stringify({pattern:"single",modelId:"generated-external-budget",confidence:0.95,reason:"Generated installed classifier-only advice."})});frame({},"stop");
        }else if(String(body.messages[user]?.content).includes("Generated installed Guided question")&&!body.messages.slice(user+1).some(value=>value.role==="tool")){
          frame({role:"assistant",tool_calls:[{index:0,id:"generated-installed-guided-call",type:"function",function:{name:"ask_user",arguments:JSON.stringify({question:"Choose a generated installed approach?",choices:["Generated installed first","Generated installed second"],allowFreeform:false,recommendation:{choiceIndex:1,reason:"Generated installed solver recommendation."}})}}]});frame({},"tool_calls");
        }else if(PROTOCOL_VERSION>=82&&String(body.messages[user]?.content).includes("Generated installed direct MCP")){
          const results=body.messages.slice(user+1).filter(value=>value.role==="tool");
          let selected;
          if(!results.length)selected={name:"mcp_gateway",arguments:{action:"tools",serverId:"builtin",query:"grep_logs"}};
          else if(results.length===1)selected={name:"discover_tools",arguments:{query:JSON.parse(results[0].content).tools.find(value=>value.name==="grep_logs").directName}};
          else if(results.length===2){
            const name=JSON.parse(results[0].content).tools.find(value=>value.name==="grep_logs").directName;
            assert.ok(body.tools.some(value=>value.function.name===name&&value.function.parameters.properties.path));
            selected={name,arguments:{path:"generated.ts",query:"portableSdkMemory"}};
          }
          if(selected){frame({role:"assistant",tool_calls:[{index:0,id:"generated-installed-direct-"+generatedRequests.length,type:"function",function:{name:selected.name,arguments:JSON.stringify(selected.arguments)}}]});frame({},"tool_calls");}
          else{frame({role:"assistant",content:"Generated installed direct result retained."});frame({},"stop");}
        }else{frame({role:"assistant",content:"Generated external budget response."});frame({},"stop");}
        response.write("data: "+JSON.stringify({choices:[],usage:{prompt_tokens:30,completion_tokens:12,total_tokens:42,...(PROTOCOL_VERSION>=66?{prompt_tokens_details:{cached_tokens:10}}:{})}})+"\\n\\n");response.end("data: [DONE]\\n\\n");
      });
      await new Promise(resolve=>budgetServer.listen(0,"127.0.0.1",resolve));
      const generatedModel={id:"generated-external-budget",name:"Generated external budget model",api:"openai-completions",provider:"github-copilot",baseUrl:"http://127.0.0.1:"+budgetServer.address().port,reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:128};
      provider.state={status:"connected",models:[{id:generatedModel.id,name:generatedModel.name,contextWindow:8192,maxTokens:128,imageInput:false}],login:null,diagnostic:null};
      provider.prepare=async id=>{assert.equal(id,generatedModel.id);return{model:generatedModel,auth:{apiKey:"generated-external-only",baseUrl:generatedModel.baseUrl}};};
      provider.onChange();await sdk.models.refresh();
      const metered=await sdk.sessions.create(null,"Generated installed SDK budget",{modelId:generatedModel.id});
      await sdk.command({type:"draft.save",sessionId:metered.id,expectedRevision:0,text:"Generated installed finite request.",attachments:[]});
      const estimate=(await sdk.sessions.context(metered.id)).context.estimatedTokens;
      const meteredSession=sdk.getState().snapshot.sessions.find(v=>v.id===metered.id);
      await sdk.sessions.configure(metered.id,{...meteredSession.controls,budget:{kind:"limited",basis:"estimate",tokens:Math.ceil(estimate)+16}});
      await sdk.command({type:"message.send",sessionId:metered.id,expectedRevision:1,delivery:"queue"});
      for(let n=0;n<400&&!["completed","partial","failed","stopped"].includes(sdk.getState().snapshot.sessions.find(v=>v.id===metered.id).status);n++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===metered.id).status,"completed");
      assert.equal(generatedRequests.length,1);assert.equal(generatedRequests[0].max_tokens??generatedRequests[0].max_completion_tokens,16);
      assert.equal((await sdk.budgets.status(metered.id)).status.totals.reportedTokens,42);
      await sdk.budgets.policy({basis:"estimate",tokens:1},sdk.getState().snapshot.budgetPolicy.revision,true);
      await sdk.command({type:"draft.save",sessionId:metered.id,expectedRevision:2,text:"Generated blocked installed request.",attachments:[]});
      await sdk.command({type:"message.send",sessionId:metered.id,expectedRevision:3,delivery:"queue"});
      for(let n=0;n<400&&!["completed","partial","failed","stopped"].includes(sdk.getState().snapshot.sessions.find(v=>v.id===metered.id).status);n++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===metered.id).status,"partial");
      assert.equal(generatedRequests.length,1);assert.equal((await sdk.budgets.dashboard({role:"solver"})).totals.calls,1);
      assert.ok(sdk.getState().snapshot.artifacts.some(v=>v.origin==="checkpoint"));
      const betaProvider=providers.get(beta.profileId);betaProvider.state=structuredClone(provider.state);betaProvider.prepare=provider.prepare;
      betaProvider.onChange();await beta.models.refresh();
      const betaMetered=await beta.sessions.create(null,"Generated installed Beta model",{modelId:generatedModel.id});
      await beta.command({type:"draft.save",sessionId:betaMetered.id,expectedRevision:0,text:"Generated isolated installed worker.",attachments:[]});
      const betaEstimate=(await beta.sessions.context(betaMetered.id)).context.estimatedTokens;
      const betaCurrent=beta.getState().snapshot.sessions.find(value=>value.id===betaMetered.id);
      await beta.sessions.configure(betaMetered.id,{...betaCurrent.controls,budget:{kind:"limited",basis:"estimate",tokens:Math.ceil(betaEstimate)+16}});
      await beta.command({type:"message.send",sessionId:betaMetered.id,expectedRevision:1,delivery:"queue"});
      for(let n=0;n<400&&!["completed","partial","failed","stopped"].includes(beta.getState().snapshot.sessions.find(v=>v.id===betaMetered.id).status);n++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(beta.getState().snapshot.sessions.find(v=>v.id===betaMetered.id).status,"completed");assert.equal(generatedRequests.length,2);
      assert.equal((await beta.budgets.dashboard()).totals.reportedTokens,42);
      assert.equal((await sdk.budgets.dashboard()).totals.reportedTokens,42);
      const guided=await beta.sessions.create(null,"Generated installed Guided advice",{modelId:generatedModel.id,autonomy:"Guided"});
      await beta.command({type:"draft.save",sessionId:guided.id,expectedRevision:0,text:"Generated installed Guided question.",attachments:[]});
      await beta.command({type:"message.send",sessionId:guided.id,expectedRevision:1,delivery:"queue"});
      for(let n=0;n<400&&!beta.getState().snapshot.questions.some(value=>value.sessionId===guided.id&&value.status==="open");n++)await new Promise(resolve=>setTimeout(resolve,20));
      const pending=beta.getState().snapshot.questions.find(value=>value.sessionId===guided.id&&value.status==="open");
      assert.ok(pending);assert.equal(pending.answer,null);assert.equal(pending.recommendation.actor,"model");assert.equal(pending.recommendation.choice,pending.choices[1]);assert.equal(generatedRequests.length,3);
      await beta.questions.answer(pending.id,pending.choices[0],pending.revision);
      for(let n=0;n<400&&beta.getState().snapshot.sessions.find(value=>value.id===guided.id).status!=="completed";n++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(beta.getState().snapshot.sessions.find(value=>value.id===guided.id).status,"completed");
      assert.equal(beta.getState().snapshot.questions.find(value=>value.id===pending.id).answer.actor,"user");
      assert.equal(beta.getState().snapshot.questions.find(value=>value.id===pending.id).answer.text,pending.choices[0]);assert.equal(generatedRequests.length,4);
      ${conversationNavigationAvailable ? `
      const navigation=conversationNavigation(beta.getState().snapshot,guided.id);
      assert.deepEqual(navigation.map(value=>value.kind),["prompt","answer"]);assert.equal(navigation[1].answer,pending.choices[0]);
      assert.equal(navigation[1].questionId,pending.id);assert.equal(navigation[1].profileId,beta.profileId);
      assert.throws(()=>conversationNavigation(sdk.getState().snapshot,guided.id),{code:"session_missing"});
      const reopenedNavigation=await sdk.profiles.open(beta.profileId);
      try{assert.deepEqual(conversationNavigation(reopenedNavigation.getState().snapshot,guided.id),navigation);}finally{reopenedNavigation.disconnect();}
      assert.equal(generatedRequests.length,4);
      console.log("Installed shared conversation navigation retains exact actual-user question choices, immutable source identities and owning-profile reopen without tool permissions or another model call.");
      ` : ""}
      const guidedArtifact=beta.getState().snapshot.artifacts.find(value=>value.questionId===pending.id);
      assert.match((await beta.artifacts.read(guidedArtifact.id)).text,/Model recommendation \\(not a user answer\\)/);
      assert.deepEqual(beta.routing.policy(),defaultKupoSettings());
      await beta.routing.configure({...${installedProtocol >= 61 ? "defaultSingleKupoSettings()" : "defaultKupoSettings()"},enabled:true,classifierModelId:generatedModel.id,approvedModelIds:[generatedModel.id],allowHosted:true},beta.settings.get().revision);
      const routed=await beta.sessions.create(null,"Generated installed Single");
      assert.equal((await beta.slash(routed.id,"/model kupo","cli")).kind,"ok");
      assert.equal(JSON.parse((await beta.slash(routed.id,"/kupo status","cli")).text).policy.enabled,true);assert.equal(generatedRequests.length,4);
      await beta.refresh();
      const routedDraftRevision=beta.getState().snapshot.sessions.find(value=>value.id===routed.id).draft.revision;
      await beta.command({type:"draft.save",sessionId:routed.id,expectedRevision:routedDraftRevision,text:"Generated installed Single task.",attachments:[]});
      await beta.command({type:"message.send",sessionId:routed.id,expectedRevision:routedDraftRevision+1,delivery:"queue"});
      for(let n=0;n<400&&!["completed","partial","failed","stopped"].includes(beta.getState().snapshot.sessions.find(value=>value.id===routed.id).status);n++)await new Promise(resolve=>setTimeout(resolve,20));
      const routedSession=beta.getState().snapshot.sessions.find(value=>value.id===routed.id);
      assert.equal(routedSession.status,"completed");assert.equal(routedSession.controls.modelId,KUPO_MODEL_ID);
      assert.deepEqual(routedSession.usage.map(value=>value.role),["router","solver"]);
      assert.equal(generatedRequests.length,6);assert.equal(generatedRequests[4].max_tokens??generatedRequests[4].max_completion_tokens,128);
      assert.equal(generatedRequests[4].tools,undefined);assert.equal(JSON.stringify(generatedRequests[5]).includes("Generated installed classifier-only advice."),false);
      assert.equal(beta.routing.history(routed.id)[0].status,"completed");assert.equal(beta.routing.history(routed.id)[0].plan.modelId,generatedModel.id);
      assert.equal((await beta.budgets.status(routed.id)).status.totals.reportedTokens,84);
      const dated=await beta.budgets.dashboard({sessionId:routed.id,range:{kind:"days",days:7},bucket:"day"});
      assert.equal(dated.totals.calls,2);assert.equal(dated.totals.reportedTokens,84);assert.equal(dated.totals.inputTokens,60);assert.equal(dated.totals.outputTokens,24);
      assert.equal(dated.periods.length,1);assert.equal(dated.totals.observedOutputTokensPerSecond,null);
      const retainedCalls=await beta.budgets.calls({sessionId:routed.id,limit:1});
      assert.equal(retainedCalls.calls.length,1);assert.equal(retainedCalls.calls[0].stream.outputEvents,1);assert.equal(retainedCalls.calls[0].stream.streamMs,null);
      const rangedCalls=await beta.budgets.calls({range:{kind:"days",days:7},sessionId:routed.id,limit:1});
      assert.equal(rangedCalls.type,"budget.calls");assert.equal(rangedCalls.calls[0].reportedTokens,42);
      if(PROTOCOL_VERSION>=21){
        const outcomes=await beta.telemetry.operations({sessionId:routed.id});
        assert.equal(outcomes.type,"telemetry.operations");assert.equal(outcomes.totals.attempts,0);assert.equal(outcomes.totals.failureRate,null);
        assert.equal(outcomes.coverage.priorHistory,"retained-events-only");
        const retained=(await beta.telemetry.storage()).storage;
        assert.equal(retained.profileId,beta.profileId);assert.ok(retained.bytes.total>0);assert.equal(retained.physicalBytes,null);
        assert.equal(retained.bytes.total,retained.bytes.events+retained.bytes.blobGrants+retained.bytes.keys);
        assert.equal(retained.measurement,"key-backed-retained-ciphertext");
        const slash=await beta.slash(routed.id,"/dashboard operations "+JSON.stringify({sessionId:routed.id}),"tui");
        assert.equal(slash.kind,"text");assert.equal(JSON.parse(slash.text).totals.attempts,0);
        const actualOutcome=await sdk.telemetry.operations({sessionId:operationSessionId,family:"mcp"});
        assert.equal(actualOutcome.totals.completed,1);assert.equal(actualOutcome.entries[0].actor,"external");
        assert.equal((await beta.telemetry.operations({sessionId:operationSessionId})).totals.attempts,0);
        assert.equal((await sdk.telemetry.operations({sessionId:operationSessionId})).totals.completed,1);
        assert.equal(JSON.stringify(actualOutcome).includes("portableSdkMemory"),false);assert.equal(generatedRequests.length,6);
      }
      if(PROTOCOL_VERSION>=22){
        const directory=join(root,"generated-repository-attribution");await mkdir(directory);
        await writeFile(join(directory,"fixture.txt"),"Generated installed attributed MCP bytes.");
        git(["init","--initial-branch=main"],directory);git(["add","--","fixture.txt"],directory);
        git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated attribution base"],directory);
        git(["remote","add","origin","https://github.com/generated/example.git"],directory);
        const project=await sdk.command({type:"project.add",path:directory}),session=await sdk.sessions.create(project.id,"Generated installed attributed source",{env:"Local"},undefined,"checkout");
        const preview=(await sdk.repositories.preview(session.id)).preview;assert.equal(preview.lookupBoundary,"control-plane-public");assert.equal(repositoryLookups,0);
        const refresh=await sdk.repositories.refresh(session.id,preview.bindingDigest,preview.revision,true);assert.equal((await sdk.jobs.wait(refresh.id)).status,"completed");
        assert.equal((await sdk.repositories.state(session.id)).observation.repository.publicOsiLicensed,true);assert.equal(repositoryLookups,1);
        const tool=(await sdk.mcp.tools("builtin","grep",0,session.id)).tools.find(value=>value.name==="grep_logs"),job=await sdk.mcp.call(session.id,"builtin",tool.name,{path:"fixture.txt",query:"Generated"},tool.digest);
        if(PROTOCOL_VERSION>=73)assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===session.id).pendingApproval,null);
        else{
          let approval;
          for(let n=0;n<400&&!approval;n++){approval=sdk.getState().snapshot.sessions.find(value=>value.id===session.id).pendingApproval;if(!approval)await new Promise(resolve=>setTimeout(resolve,20));}
          assert.ok(approval);await sdk.command({type:"approval.respond",sessionId:session.id,approvalId:approval.id,allow:true});
        }
        assert.equal((await sdk.jobs.wait(job.id)).status,"completed");
        const observed=await sdk.telemetry.operations({repositoryId:42,visibility:"open-source"});
        assert.equal(observed.totals.completed,1);assert.equal(observed.entries[0].repository.fullName,"generated/example");assert.equal(observed.entries[0].actor,"external");
        assert.equal(JSON.stringify(observed).includes("GENERATED_UNRETAINED_REPOSITORY_BODY"),false);assert.equal((await beta.telemetry.operations({repositoryId:42})).totals.attempts,0);
        assert.equal((await sdk.repositories.state(session.id)).observation.repository.id,42);
        const slash=await sdk.slash(session.id,"/repository state","tui");assert.equal(slash.kind,"text");assert.equal(JSON.parse(slash.text).observation.repository.licenseId,"MIT");
        await sdk.refresh();await deleteWithReviewedChildren(sdk,session.id);
        const removal=(await sdk.artifacts.projectPreview(project.id)).preview,configuration=(await sdk.projects.configuration(project.id)).configuration;
        await sdk.projects.remove(project.id,true,configuration.revision,{action:"retain",expectedDigest:removal.digest});
        assert.equal((await sdk.telemetry.operations({repositoryId:42})).totals.completed,1);assert.equal(repositoryLookups,1);assert.equal(generatedRequests.length,6);
      }
      assert.deepEqual(sdk.routing.policy(),defaultKupoSettings());
      if(PROTOCOL_VERSION>=19){
        const compact=await beta.sessions.create(null,"Generated installed compaction",{modelId:generatedModel.id,autonomy:"Manual"});
        for(let turn=0;turn<3;turn++){
          const current=beta.getState().snapshot.sessions.find(value=>value.id===compact.id);
          await beta.command({type:"draft.save",sessionId:compact.id,expectedRevision:current.draft.revision,text:"Generated installed retained turn "+turn+". "+"Generated retained compaction detail. ".repeat(16),attachments:[]});
          const sizing=(await beta.sessions.context(compact.id)).context;
          assert.ok(sizing.estimatedTokens+4096<generatedModel.contextWindow,"The generated compaction fixture must fit the unchanged input/headroom bound before dispatch: estimated="+sizing.estimatedTokens+", window="+generatedModel.contextWindow+".");
          await beta.command({type:"message.send",sessionId:compact.id,expectedRevision:current.draft.revision+1,delivery:"queue"});
          for(let n=0;n<400&&beta.getState().snapshot.sessions.find(value=>value.id===compact.id).turnId;n++)await new Promise(resolve=>setTimeout(resolve,20));
          const settled=beta.getState().snapshot.sessions.find(value=>value.id===compact.id);
          assert.equal(settled.status,"completed",settled.lastError??"Installed compaction source turn did not complete.");
        }
        const invoke=text=>beta.slash(compact.id,text,"cli");
        const preview=JSON.parse((await invoke('/compact preview {"keepRecentTurns":1}')).text).preview;
        assert.equal(generatedRequests.length,9);
        const requested=await invoke("/compact generate "+JSON.stringify({digest:preview.digest,modelId:preview.modelId,keepRecentTurns:preview.keepRecentTurns})+" confirm-cost");
        assert.equal(requested.kind,"ok");
        let proposal;
        for(let n=0;n<400;n++){
          proposal=(await beta.compactions.state(compact.id)).compactions[0];
          if(proposal&&proposal.status!=="running")break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.equal(proposal.status,"proposed");assert.match((await invoke("/compact read "+proposal.id)).text,/Generated external budget response/);
        await assert.rejects(()=>beta.compactions.stop(compact.id,proposal.id),/settled|ownership|newer/);
        await assert.rejects(()=>sdk.compactions.read(compact.id,proposal.id),{code:"not_found"});
        await beta.compactions.apply(compact.id,proposal.id,proposal.revision);
        const active=await beta.compactions.state(compact.id);
        assert.equal(active.activeId,proposal.id);assert.ok(active.estimatedTokens<active.originalEstimatedTokens);
        assert.equal((await beta.budgets.calls({sessionId:compact.id,role:"compaction"})).calls[0].reportedTokens,42);
        await invoke("/compact restore "+proposal.id+" "+active.sourceDigest+" confirm-restore");
        const restored=await beta.compactions.state(compact.id);assert.equal(restored.activeId,null);assert.equal(restored.estimatedTokens,restored.originalEstimatedTokens);
        assert.equal(generatedRequests.length,10);
      }
      if(PROTOCOL_VERSION>=61){
        const previousPolicy=beta.routing.policy(),before=generatedRequests.length;
        await beta.routing.configure(defaultKupoSettings(),beta.settings.get().revision);
        assert.equal(beta.routing.policy().workflow,"auto");
        assert.equal(beta.routing.capabilities("Local").length,1);
        assert.equal(beta.routing.capabilities("Local")[0].modelId,generatedModel.id);
        const automatic=await beta.sessions.create(null,"Generated installed automatic Kupo",{modelId:KUPO_MODEL_ID,autonomy:"Manual"});
        await beta.command({type:"draft.save",sessionId:automatic.id,expectedRevision:0,text:"Generated installed automatic Kupo response.",attachments:[]});
        await beta.command({type:"message.send",sessionId:automatic.id,expectedRevision:1,delivery:"queue"});
        for(let n=0;n<400&&!["completed","partial","failed","stopped"].includes(beta.getState().snapshot.sessions.find(value=>value.id===automatic.id).status);n++)await new Promise(resolve=>setTimeout(resolve,20));
        const settled=beta.getState().snapshot.sessions.find(value=>value.id===automatic.id);
        assert.equal(settled.status,"completed");assert.equal(generatedRequests.length,before+1);
        assert.deepEqual(settled.usage.map(value=>value.role),["solver"]);
        assert.equal(beta.routing.history(automatic.id)[0].classifierStepId,null);
        assert.equal(beta.routing.history(automatic.id)[0].plan.basis,"only-model");
        await beta.routing.configure(previousPolicy,beta.settings.get().revision);
        if(PROTOCOL_VERSION>=66){
          const saved=beta.getState().snapshot.sessionTelemetry[automatic.id];
          assert.equal(saved.turns[0].usage.cacheReadTokens,10);assert.equal(saved.turns[0].usage.inputTokens,30);
          assert.equal(saved.estimate.outputTokens,12);assert.equal(saved.estimate.estimatedCalls,0);assert.ok(saved.context.estimatedTokens>0);
          assert.equal(sdk.getState().snapshot.sessionTelemetry[automatic.id],undefined);
          const reopened=await sdk.profiles.open(beta.profileId);
          try{assert.deepEqual(reopened.getState().snapshot.sessionTelemetry[automatic.id].turns,saved.turns);assert.deepEqual(reopened.getState().snapshot.sessionTelemetry[automatic.id].context,saved.context);}
          finally{reopened.disconnect();}
          assert.equal(generatedRequests.length,before+1);
          console.log("Installed protocol-66 snapshots retain original turn/cache/context and captured-rate estimates across client reopen without detail queries, new model calls or foreign-profile data.");
        }
        console.log("Installed protocol-61 Kupo catalogue, automatic default and capability inventory use the exact sole model through the real delivered worker without a classifier or extra permission.");
      }
      if(PROTOCOL_VERSION>=67){
        const before=generatedRequests.length;
        const parent=await beta.sessions.create(null,"Generated installed live side parent",{modelId:generatedModel.id,autonomy:"Manual"});
        const send=async(id,text)=>{
          const current=beta.getState().snapshot.sessions.find(value=>value.id===id);
          await beta.command({type:"draft.save",sessionId:id,expectedRevision:current.draft.revision,text,attachments:[]});
          await beta.command({type:"message.send",sessionId:id,expectedRevision:current.draft.revision+1,delivery:"queue"});
          for(let n=0;n<400&&!["completed","partial","failed","stopped"].includes(beta.getState().snapshot.sessions.find(value=>value.id===id).status);n++)await new Promise(resolve=>setTimeout(resolve,20));
          assert.equal(beta.getState().snapshot.sessions.find(value=>value.id===id).status,"completed");
        };
        await send(parent.id,"Generated INSTALLED_MAIN_TIME_ONE.");
        const side=await beta.sessions.side(parent.id);
        await send(side.id,"Generated INSTALLED_SIDE_TIME_ONE.");
        const first=JSON.stringify(generatedRequests.at(-1).messages);
        await send(parent.id,"Generated INSTALLED_MAIN_TIME_TWO.");
        await send(side.id,"Generated INSTALLED_SIDE_TIME_TWO.");
        const last=JSON.stringify(generatedRequests.at(-1).messages);
        for(const sentinel of ["INSTALLED_MAIN_TIME_ONE","INSTALLED_MAIN_TIME_TWO","INSTALLED_SIDE_TIME_ONE","INSTALLED_SIDE_TIME_TWO"])assert.equal(last.split(sentinel).length-1,1);
        assert.ok(!first.includes("INSTALLED_MAIN_TIME_TWO"));
        const retained=beta.getState().snapshot.sessions.find(value=>value.id===side.id);
        assert.equal(retained.mode,"read-only");assert.equal(retained.sideContext.parentSessionId,parent.id);
        const reopened=await sdk.profiles.open(beta.profileId);
        try{assert.deepEqual(reopened.getState().snapshot.sessions.find(value=>value.id===side.id).sideContext,retained.sideContext);assert.ok(!sdk.getState().snapshot.sessions.some(value=>value.id===side.id));}
        finally{reopened.disconnect();}
        assert.equal(generatedRequests.length,before+4);
        if(PROTOCOL_VERSION>=68){
          const draft=beta.getState().snapshot.sessions.find(value=>value.id===side.id).draft;
          await beta.command({type:"draft.save",sessionId:side.id,expectedRevision:draft.revision,text:"Generated installed side draft preserved.",attachments:[]});
          await beta.sessions.askSide(parent.id,"Generated installed atomic slash side prompt.");
          for(let n=0;n<400&&beta.getState().snapshot.sessions.find(value=>value.id===side.id).status!=="completed";n++)await new Promise(resolve=>setTimeout(resolve,20));
          assert.equal(beta.getState().snapshot.sessions.find(value=>value.id===side.id).draft.text,"Generated installed side draft preserved.");
          assert.equal(generatedRequests.length,before+5);
          const directory=join(root,"generated-installed-command-skills");await mkdir(directory);
          await writeFile(join(directory,"SKILL.md"),"---\\nname: generated-installed-slash-skill\\ndescription: Generated installed command guidance\\n---\\nUse generated fixtures only.\\n");
          const settings=beta.settings.get();await beta.settings.update({...settings.values,skillSources:[{id:"generated-installed-slashes",name:"Generated installed slash source",kind:"local",enabled:true,path:directory}]},settings.revision);
          const catalog=await beta.commands.list(parent.id),skill=catalog.find(value=>value.kind==="skill");
          assert.equal(catalog[0].kind,"builtin");assert.ok(skill);assert.ok(catalog.slice(catalog.findIndex(value=>value.kind==="skill")).every(value=>value.kind==="skill"));
          ${installedProtocol >= 98 ? "await admitSkill(beta,parent.id,skill.skill.id,skill.skill.digest);" : ""}
          const original=beta.getState().snapshot.sessions.find(value=>value.id===parent.id).draft;
          await beta.skills.use(parent.id,skill.skill.id,skill.skill.digest,original.revision,"Generated installed skill task.");
          assert.match(beta.getState().snapshot.sessions.find(value=>value.id===parent.id).draft.text,/Generated installed skill task/);
          assert.equal(generatedRequests.length,before+5);
          console.log("Installed protocol-68 SDK retains side-draft isolation and complete builtins-first fresh skill commands with actual selected-source grants and no additional model call.");
        }
        console.log("Installed protocol-67 side questions refresh exact retained main history once per new turn, retain original side exchanges and read-only model controls across profile-owned reopen without extra model calls.");
      }
      if(PROTOCOL_VERSION>=69){
        const before=generatedRequests.length,previous=structuredClone(betaProvider.state.models),maximum=generatedModel.contextWindow;
        try{
          generatedModel.contextWindow=32769;betaProvider.state.models[0].contextWindow=32769;
          betaProvider.onChange();await beta.models.refresh();
          const tuned=await beta.sessions.create(null,"Generated installed tuning shortcuts",{modelId:generatedModel.id});
          await beta.slash(tuned.id,"/thinking default","tui");await beta.slash(tuned.id,"/effort default","desktop");
          for(const [argument,tokens] of [["24577",24577],["min",8192],["half",16384],["max",32769]]){
            await beta.slash(tuned.id,"/context-window "+argument,"cli");
            assert.equal(beta.getState().snapshot.sessions.find(value=>value.id===tuned.id).controls.modelOptions.contextWindow,tokens);
          }
          await assert.rejects(()=>beta.slash(tuned.id,"/context-window 32770"),/context|window|ceiling/i);
          await assert.rejects(()=>beta.slash(tuned.id,"/thinking low"),/not supported/i);
          await beta.slash(tuned.id,"/context-window 8192");
          assert.equal(generatedRequests.length,before);
          console.log("Installed protocol-69 shortcuts preserve exact/min/half/max context ceilings, real unsupported-effort errors and profile-owned model controls without inference.");
        }finally{generatedModel.contextWindow=maximum;betaProvider.state.models=previous;betaProvider.onChange();await beta.models.refresh();}
      }
      if(PROTOCOL_VERSION>=90){
        const before=generatedRequests.length,originalRefresh=betaProvider.refresh,gate=Promise.withResolvers();
        let refreshes=0;
        betaProvider.refresh=async signal=>{refreshes++;await gate.promise;signal?.throwIfAborted();await originalRefresh();};
        const first=beta.models.refresh(),second=beta.models.refresh();
        try{
          for(let index=0;index<100&&refreshes===0;index++)await new Promise(resolve=>setTimeout(resolve,5));
          assert.equal(refreshes,1);
          await new Promise(resolve=>setTimeout(resolve,20));assert.equal(refreshes,1);
          const created=await beta.sessions.create(null,"Generated installed refresh-independent chat");
          await beta.command({type:"draft.save",sessionId:created.id,expectedRevision:0,text:"Generated installed draft during metadata refresh.",attachments:[]});
          gate.resolve();await Promise.all([first,second]);
          assert.equal(refreshes,1);
          assert.equal(beta.getState().snapshot.sessions.find(value=>value.id===created.id).draft.text,"Generated installed draft during metadata refresh.");
          assert.equal(generatedRequests.length,before);
          console.log("Actual installed SDK/runtime shares one original startup/manual metadata discovery while New chat and exact draft acknowledgement proceed without login, inference or mutation replay.");
        }finally{gate.resolve();await Promise.allSettled([first,second]);betaProvider.refresh=originalRefresh;}
      }
      if(PROTOCOL_VERSION>=70){
        const before=generatedRequests.length,savedSettings=structuredClone(beta.settings.get().values),savedModels=structuredClone(betaProvider.state.models);
        const extra=Array.from({length:20},(_,index)=>({...savedModels[0],id:"generated-installed-choice-"+index,apiModelId:"generated-installed-choice-"+index,name:"Generated installed choice "+index}));
        try{
          betaProvider.state.models=[...savedModels,...extra];betaProvider.onChange();await beta.models.refresh();
          for(const model of extra.slice(2))await beta.models.setEnabled(model.apiModelId,false);
          assert.equal(beta.getState().snapshot.provider.models.filter(model=>!model.synthetic).length,3);
          assert.equal(beta.models.catalogue().models.length,21);
          await assert.rejects(()=>beta.slash(betaMetered.id,"/model "+extra[2].id),/available|disabled/i);
          const settings=beta.settings.get();await beta.settings.update({...settings.values,localModels:[...settings.values.localModels,{id:"installed-choice",name:"Generated installed source",enabled:true,baseUrl:generatedModel.baseUrl+"/v1",auth:"none",models:[{id:generatedModel.id,name:"Generated installed duplicate",contextWindow:8192,maxTokens:128,imageInput:false}]}]},settings.revision);
          await beta.models.refresh();
          let group=beta.models.catalogue().models.find(model=>model.apiModelId===generatedModel.id);
          assert.equal(group.offerings.length,2);assert.equal(group.sourceModelId,null);
          const local=group.offerings.find(offering=>offering.model.source==="local").model;
          await beta.models.selectSource(generatedModel.id,local.id);
          assert.ok(beta.getState().snapshot.provider.models.some(model=>model.id===local.id));
          assert.ok(!beta.getState().snapshot.provider.models.some(model=>model.id===generatedModel.id));
          await beta.models.setProviderEnabled(local.providerId,false);
          group=beta.models.catalogue().models.find(model=>model.apiModelId===generatedModel.id);
          assert.equal(group.sourceModelId,local.id);assert.ok(group.diagnostic);
          assert.ok(!beta.getState().snapshot.provider.models.some(model=>model.id===generatedModel.id));
          await beta.models.selectSource(generatedModel.id,generatedModel.id);
          assert.equal(generatedRequests.length,before);
          console.log("Installed protocol-70 SDK reduces 21 models to three, blocks disabled slash selection and enforces an exact retained provider source without fallback or inference.");
        }finally{betaProvider.state.models=savedModels;betaProvider.onChange();await beta.settings.update(savedSettings,beta.settings.get().revision);await beta.models.refresh();}
      }
      ${installedProtocol >= 82 ? `{
        const previousModels=structuredClone(betaProvider.state.models),previousWindow=generatedModel.contextWindow;
        try{
        generatedModel.contextWindow=32768;betaProvider.state.models[0].contextWindow=32768;betaProvider.onChange();await beta.models.refresh();
        for(const name of ["impeccable","continue","suggestions","orchestrate","spawn","spar","critique","roast-me"])assert.ok(slashCommands.some(command=>command.name===name));
        const before=beta.settings.get(),ranked=["cli","rest","mcp-direct","mcp-gateway"];
        await beta.settings.update({...before.values,toolPreferences:{order:ranked}},before.revision);
        assert.deepEqual(effectiveToolPreferences(sdk.settings.get().values.toolPreferences),defaultToolPreferences());
        const opened=await beta.projects.add(project),parent=await beta.sessions.create(opened.id,"Generated installed command owner",{modelId:generatedModel.id,modelOptions:{contextWindow:32768}},undefined,"checkout");
        await beta.sessions.autonomy(parent.id,"Autopilot");
        const current=()=>beta.getState().snapshot.sessions.find(value=>value.id===parent.id);
        const terminal=async id=>{for(let n=0;n<400;n++){const value=beta.getState().snapshot.sessions.find(value=>value.id===id);if(!value.turnId&&["completed","failed","partial","stopped"].includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error("Generated installed82 work did not settle.");};
        const requestsBefore=generatedRequests.length;
        const editor=new DraftEditor(beta,parent.id,current().draft);
        try{editor.edit("Generated installed direct MCP task.");await editor.send("queue");}finally{editor.dispose();}
        const directOutcome=await terminal(parent.id);
        assert.equal(directOutcome.status,"completed",directOutcome.lastError??JSON.stringify(directOutcome.messages.slice(-3)));
        assert.equal(generatedRequests.length,requestsBefore+4);
        assert.match(JSON.stringify(generatedRequests[requestsBefore]),/1. CLI/);
        const original=(await beta.tools.results(parent.id)).sources.find(value=>value.name==="mcp_gateway"&&value.rawComplete);
        const sources=(await beta.tools.results(parent.id)).sources;
        const actual=original??sources.find(value=>value.name==="mcp_gateway");
        assert.ok(actual);assert.match((await beta.tools.resultById(parent.id,actual.operationId)).text,/portableSdkMemory/);
        const second=await beta.sessions.create(opened.id,"Generated installed distinct direct owner",{modelId:generatedModel.id,modelOptions:{contextWindow:32768}},undefined,"checkout");
        await beta.sessions.autonomy(second.id,"Autopilot");
        const secondSession=beta.getState().snapshot.sessions.find(value=>value.id===second.id),secondEditor=new DraftEditor(beta,second.id,secondSession.draft);
        try{secondEditor.edit("Generated installed direct MCP second owner.");await secondEditor.send("queue");}finally{secondEditor.dispose();}
        assert.equal((await terminal(second.id)).status,"completed");
        const leafFor=id=>beta.getState().events.find(value=>value.session_id===id&&value.event_type==="tool.completed"&&value.payload.call.directMcp)?.payload.call.directMcp;
        const firstBinding=leafFor(parent.id),secondBinding=leafFor(second.id);
        assert.ok(firstBinding);assert.ok(secondBinding);assert.notEqual(firstBinding.name,secondBinding.name);
        assert.notEqual(firstBinding.bindingDigest,secondBinding.bindingDigest);
        const assignment=await beta.sessions.spawnPrompt(parent.id,"Generated installed actual child assignment.");
        const child=await terminal(assignment.id);assert.equal(child.status,"completed");assert.equal(child.controls.autonomy,"Manual");
        assert.ok(child.messages.some(message=>message.role==="notice"&&message.text.includes("Generated installed actual child assignment.")));
        await beta.workflows.start(parent.id,"impeccable","Generated installed actual UI task.");assert.equal((await terminal(parent.id)).status,"completed");
        await beta.workflows.start(parent.id,"continue");assert.equal((await terminal(parent.id)).status,"completed");
        const reopened=await sdk.profiles.open(beta.profileId);
        try{assert.deepEqual(reopened.settings.get().values.toolPreferences.order,ranked);assert.equal((await reopened.tools.resultById(parent.id,actual.operationId,{expectedDigest:actual.digest,expectedRevision:actual.revision})).text,(await beta.tools.resultById(parent.id,actual.operationId)).text);}
        finally{reopened.disconnect();}
        await beta.settings.reset("toolPreferences",beta.settings.get().revision);
        console.log("Installed protocol-82 typed commands/ranking, profile isolation, actual owner-distinct direct MCP leaves/workers/results, assigned Manual child, UI workflow and prompt-free continuation pass through the external SDK.");
        }finally{generatedModel.contextWindow=previousWindow;betaProvider.state.models=previousModels;betaProvider.onChange();await beta.models.refresh();}
      }` : ""}
      const rootCharges=(await sdk.budgets.dashboard()).totals.knownReportedTokens+(await beta.budgets.dashboard()).totals.knownReportedTokens;
      await sdk.profiles.globalBudget({basis:"estimate",tokens:rootCharges},0,true);
      assert.equal((await beta.budgets.status(betaMetered.id)).status.remainingTokens,0);
      await assert.rejects(()=>beta.sessions.configure(routed.id,routedSession.controls),/finite budgets|wind-down/);
      const globals=(await beta.profiles.list()).catalog.globalDefaults;
      await beta.profiles.defaults({autonomy:"Guided"},globals.revision);
      const inherited=await sdk.sessions.create(null,"Generated installed shared preference");
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===inherited.id).controls.autonomy,"Guided");
      assert.ok(beta.getState().events.every(event=>event.profile_id===beta.profileId));
      assert.ok(sdk.getState().events.every(event=>event.profile_id==="default"));
      await beta.command({type:"policy.set",allowedEnvs:["Remote"]});await sdk.refresh();
      assert.deepEqual(sdk.getState().snapshot.policy.allowedEnvs,["Remote"]);
      const gammaCreated=await sdk.profiles.create("Generated installed policy Gamma");
      await sdk.profiles.wait(gammaCreated.id);
      const gamma=await sdk.profiles.open(gammaCreated.id);
      try{assert.deepEqual(gamma.getState().snapshot.policy.allowedEnvs,["Remote"]);assert.equal(gamma.getState().snapshot.projects.length,0);}finally{gamma.disconnect();}
    } finally {beta?.disconnect();sdk.disconnect();await runtime.close();if(budgetServer){budgetServer.closeAllConnections();await new Promise(resolve=>budgetServer.close(resolve));}}
    if(PROTOCOL_VERSION>=31&&process.platform==="darwin"){
      const {qualifyCandidateGeneration}=await import(${JSON.stringify(new URL("./qualify-candidate-generation.mjs", import.meta.url).href)});
      let reply="";const requests=[];
      const server=createServer(async(request,response)=>{
        const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));response.writeHead(200,{"Content-Type":"text/event-stream"});
        const frame=(delta,finish_reason=null)=>response.write("data: "+JSON.stringify({id:"generated-installed-proposal",object:"chat.completion.chunk",model:"generated-installed-proposal",choices:[{index:0,delta,finish_reason}]})+"\\n\\n");
        frame({role:"assistant",content:typeof reply==="function"?reply(requests.at(-1)):reply});frame({},"stop");
        response.write("data: "+JSON.stringify({choices:[],usage:{prompt_tokens:30,completion_tokens:12,total_tokens:42}})+"\\n\\n");response.end("data: [DONE]\\n\\n");
      });
      let generationRuntime,generationSdk;
      try{
        await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
        const model={id:"generated-installed-proposal",name:"Generated installed proposal model",api:"openai-completions",provider:"github-copilot",baseUrl:"http://127.0.0.1:"+server.address().port,reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:16384,maxTokens:256};
        const provider={...makeProvider(),state:{status:"connected",models:[{id:model.id,name:model.name,contextWindow:model.contextWindow,maxTokens:model.maxTokens,imageInput:false}],login:null,diagnostic:null},
          prepare:async id=>{assert.equal(id,model.id);return{model,auth:{apiKey:"generated-installed-only",baseUrl:model.baseUrl}};}};
        const options={stateDir:join(root,"generation-state"),retentionKey:Buffer.alloc(32,0x79),provider,platform:{terminal:{defaultRoot:generatedHome,vault:remoteVault}}};
        generationRuntime=await createRuntime(options);generationSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
        const proof=await qualifyCandidateGeneration({sdk:generationSdk,
          directory:join(root,"generated-installed-generation"),stateDir:options.stateDir,modelId:model.id,setReply:value=>{reply=value??"";},requests});
        generationSdk.disconnect();await generationRuntime.close();generationRuntime=await createRuntime(options);generationSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
        await proof.verifyRecovery(generationSdk);
        console.log("Installed SDK/shared generation used the actual owned worker/draft ledger, immutable model provenance and ownership-bearing history, separate reviewed stage/apply and missing-receipt restart replay without another model request.");
        ${installedMajor > 0 || installedMinor >= 26 ? `
        generationSdk.disconnect();await generationRuntime.close();
        model.contextWindow=262144;provider.state.models[0].contextWindow=model.contextWindow;
        const ownedOptions={...options,stateDir:join(root,"owned-role-state")};
        generationRuntime=await createRuntime(ownedOptions);generationSdk=await connectMoguri({stateDir:ownedOptions.stateDir,autoStart:false});
        const {qualifyOwnedSequence}=await import(${JSON.stringify(new URL("./qualify-owned-sequence.mjs", import.meta.url).href)});
        const ownedProof=await qualifyOwnedSequence({sdk:generationSdk,controller:generationRuntime.controller,
          directory:join(root,"generated-installed-owned-roles"),modelId:model.id,setReply:value=>{reply=value??"";},requests,proposalOrigin:PROTOCOL_VERSION>=33,roleContracts:PROTOCOL_VERSION>=35});
        generationSdk.disconnect();await generationRuntime.close();generationRuntime=await createRuntime(ownedOptions);
        generationSdk=await connectMoguri({stateDir:ownedOptions.stateDir,autoStart:false});
        await ownedProof.verifyRecovery(generationSdk,generationRuntime.controller);
        console.log("Actual installed controller/worker owns complete planned, bounded, independently retained roles with explicit untrusted prior-result context, shared TUI/SDK reads, source deletion/reopen and lost-receipt/deletion-intent replay refusal. No public compound or family-quality readiness.");
        if(PROTOCOL_VERSION>=33)console.log("Actual installed SDK/shared final-role proposals preserve exact review-bound origin, separate staging/application, source-role deletion, independent raw-copy exports/reopen, actual-user acceptance and exact retention boundaries without another model.");
        if(PROTOCOL_VERSION>=35)console.log("Actual installed controller/worker binds version-2 router/patch/critic contracts, excludes router explanations from selected contexts and retains four actual 168-token role calls; SDK/shared contract reads, canonical origin/copy/reopen keep declared validity separate from quality or approval.");
        ` : ""}
      }finally{generationSdk?.disconnect();await generationRuntime?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    }
    if(PROTOCOL_VERSION>=32){
      const evidence=${JSON.stringify(retainedRoles)},options={stateDir:evidence.stateDir,retentionKey:Buffer.alloc(32,0x67),provider:makeProvider()};
      let roleRuntime=await createRuntime(options),roleSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
      try{
        assert.equal(roleSdk.getState().snapshot.sessions.some(session=>session.id===evidence.originSessionId),false);
        assert.equal(roleSdk.getState().snapshot.projects.length,0);
        const value=await roleSdk.roleSequences.read(evidence.sequenceId,1);
        assert.equal(value.sequence.status,"completed");assert.equal(value.sequence.inputDigest,evidence.inputDigest);assert.ok(value.step.result.includes(evidence.rawMarker));
        assert.equal(roleSdk.roleSequences.list().length,1);
        assert.equal(JSON.parse((await roleSdk.artifacts.export(evidence.sequenceId)).export.text).schemaVersion,4);
        assert.equal(value.sequence.id,evidence.sequenceId);
        const observer=await roleSdk.sessions.create(null,"Generated role-data observer");
        assert.equal(JSON.parse((await roleSdk.slash(observer.id,"/roles "+evidence.sequenceId+" 1","tui")).text).sequence.id,evidence.sequenceId);
        roleSdk.disconnect();await roleRuntime.close();roleRuntime=await createRuntime(options);roleSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
        assert.equal((await roleSdk.roleSequences.read(evidence.sequenceId,1)).sequence.status,"completed");
        assert.deepEqual(roleRuntime.controller.platform.roles.original(evidence.commandId,evidence.commandDigest),{id:evidence.sequenceId,revision:evidence.revision});
        const artifact=(await roleSdk.artifacts.read(evidence.sequenceId)).artifact;await roleSdk.artifacts.delete(evidence.sequenceId,artifact.revision,true);
        await assert.rejects(()=>roleSdk.roleSequences.read(evidence.sequenceId),{code:"role_sequence_missing"});
        assert.throws(()=>roleRuntime.controller.platform.roles.original(evidence.commandId,evidence.commandDigest),{code:"role_sequence_deleted"});
        assert.equal((await roleSdk.budgets.calls()).calls.length,2);
        console.log("Actual installed protocol-32 SDK/runtime/shared role inspection preserves independent raw input/results after source deletion/reopen, version-4 history, immutable bytes and deletion intent without inference.");
      }finally{roleSdk.disconnect();await roleRuntime.close();}
    }
    if(PROTOCOL_VERSION>=26&&process.env.MOGURI_GENERATED_GITHUB){
      const observed=JSON.parse(process.env.MOGURI_GENERATED_GITHUB),state=join(root,"generated-metadata-state"),remoteRoot=await realpath(join(root,"generated-remote-workspace"));
      git(["remote","add","origin","https://github.com/generated/example.git"],remoteRoot);
      const options={stateDir:state,retentionKey:Buffer.alloc(32,0x73),provider:makeProvider(),platform:{remote:{vault:remoteVault,modelsVault:remoteVault},terminal:{defaultRoot:generatedHome,vault:remoteVault}}};
      let metadataRuntime=await createRuntime(options),metadataSdk=await connectMoguri({stateDir:state,autoStart:false});
      try{
        const metadataProject=await metadataSdk.command({type:"project.add",path:project}),session=await metadataSdk.sessions.create(metadataProject.id,undefined,undefined,undefined,"checkout");
        const settings=structuredClone(metadataSdk.settings.get().values);settings.remote=JSON.parse(process.env.MOGURI_GENERATED_REMOTE);
        await metadataSdk.settings.update(settings,metadataSdk.settings.get().revision);
        const config=(await metadataSdk.projects.configuration(metadataProject.id)).configuration;
        await metadataSdk.projects.configure(metadataProject.id,{...config.values,remotePath:remoteRoot,repo:{...config.values.repo,githubAccess:"gh-cli"}},config.revision);
        await metadataSdk.remote.probe();await metadataSdk.sessions.env(session.id,"Remote");
        const preview=(await metadataSdk.repositories.preview(session.id)).preview;assert.equal(preview.lookupBoundary,"remote-gh-cli");assert.equal(preview.remote.root,remoteRoot);
        const refresh=await metadataSdk.repositories.refresh(session.id,preview.bindingDigest,preview.revision,true);assert.equal((await metadataSdk.jobs.wait(refresh.id)).status,"completed");
        const retained=(await metadataSdk.repositories.state(session.id)).observation;assert.equal(retained.repository.visibility,"private");assert.deepEqual(retained.remote,preview.remote);
        assert.match((await metadataSdk.slash(session.id,"/repository state","cli")).text,/remote-gh-cli/);
        assert.match((await metadataSdk.slash(session.id,"/repository state","tui")).text,/private/);
        metadataSdk.disconnect();await metadataRuntime.close();metadataRuntime=await createRuntime(options);metadataSdk=await connectMoguri({stateDir:state,autoStart:false});
        await metadataSdk.remote.probe();assert.deepEqual((await metadataSdk.repositories.state(session.id)).observation,retained);
        const calls=(await readFile(observed.calls,"utf8")).trim().split("\\n").map(line=>JSON.parse(line));assert.equal(calls.length,1);assert.equal(calls[0].home,observed.home);assert.equal(calls[0].cwd,remoteRoot);
        await assert.rejects(()=>lstat(observed.controllerMarker),{code:"ENOENT"});
      }finally{metadataSdk.disconnect();await metadataRuntime.close();}
    }
    if(PROTOCOL_VERSION>=27&&process.env.MOGURI_GENERATED_REMOTE){
      const state=join(root,"generated-memory-state"),remoteRoot=await realpath(join(root,"generated-remote-workspace"));
      const options={stateDir:state,retentionKey:Buffer.alloc(32,0x75),provider:makeProvider(),platform:{remote:{vault:remoteVault,modelsVault:remoteVault},terminal:{defaultRoot:generatedHome,vault:remoteVault}}};
      let memoryRuntime=await createRuntime(options),memorySdk=await connectMoguri({stateDir:state,autoStart:false});
      try{
        const memoryProject=await memorySdk.command({type:"project.add",path:project}),session=await memorySdk.sessions.create(memoryProject.id,undefined,undefined,undefined,"checkout");
        const settings=structuredClone(memorySdk.settings.get().values);settings.remote=JSON.parse(process.env.MOGURI_GENERATED_REMOTE);settings.memory.enabled=true;
        await memorySdk.settings.update(settings,memorySdk.settings.get().revision);
        const config=(await memorySdk.projects.configuration(memoryProject.id)).configuration;
        await memorySdk.projects.configure(memoryProject.id,{...config.values,remotePath:remoteRoot},config.revision);
        await memorySdk.remote.probe();await memorySdk.sessions.env(session.id,"Remote");
        await assert.rejects(()=>memorySdk.memory.searchSession(session.id,"generated"),{code:"memory_missing"});
        const command={type:"memory.index",sessionId:session.id},commandId=randomUUID(),indexed=await memorySdk.command(command,commandId);
        assert.equal((await memorySdk.jobs.wait(indexed.id)).status,"completed");
        const before=(await memorySdk.memory.state(session.id)).index;assert.equal(before.binding.env,"Remote");assert.equal(before.binding.root,remoteRoot);
        const hits=await memorySdk.memory.searchSession(session.id,"SSH-only change");assert.ok(hits.items.some(hit=>hit.text.includes("SSH-only change")&&!hit.stale));
        assert.match((await memorySdk.slash(session.id,"/memory state","tui")).text,/Remote/);
        memorySdk.disconnect();await memoryRuntime.close();memoryRuntime=await createRuntime(options);memorySdk=await connectMoguri({stateDir:state,autoStart:false});
        assert.equal((await memorySdk.command(command,commandId)).id,indexed.id);assert.equal((await memorySdk.remote.status()).remote.ready,false);
        await memorySdk.remote.probe();assert.deepEqual((await memorySdk.memory.state(session.id)).index,before);
        const preview=(await memorySdk.mcp.remotePreview(session.id,"builtin")).preview;
        await memorySdk.mcp.grantRemote(session.id,"builtin",preview.digest,preview.settingsRevision,false,true);await memorySdk.remote.probe();
        const tool=(await memorySdk.mcp.tools("builtin","memory",0,session.id)).tools.find(tool=>tool.name==="search_memory");
        const requested=await memorySdk.mcp.call(session.id,"builtin",tool.name,{query:"SSH-only change"},tool.digest);
        const approval=memorySdk.getState().snapshot.sessions.find(value=>value.id===session.id).pendingApproval;
        if(PROTOCOL_VERSION>=73)assert.equal(approval,null);
        else await memorySdk.command({type:"approval.respond",sessionId:session.id,approvalId:approval.id,allow:true});
        assert.equal((await memorySdk.jobs.wait(requested.id)).status,"completed");assert.match((await memorySdk.mcp.readResult(requested.id)).text,/SSH-only change/);
        assert.equal(memorySdk.getState().snapshot.sessions.find(value=>value.id===session.id).usage.length,0);
      }finally{memorySdk.disconnect();await memoryRuntime.close();}
    }
    if(PROTOCOL_VERSION>=23&&process.platform==="darwin")for(const mode of ["Local",...(PROTOCOL_VERSION>=25&&process.env.MOGURI_GENERATED_REMOTE?["Remote"]:[])]){
      const consoleRoot=join(root,"generated-console-project-"+mode),consoleState=join(root,"generated-console-state-"+mode),keys=new Map();
      await mkdir(consoleRoot);
      const vault={read:async id=>keys.get(id)??null,write:async(id,value)=>{keys.set(id,value);},remove:async id=>{keys.delete(id);}};
      const options={stateDir:consoleState,retentionKey:Buffer.alloc(32,0x71),provider:makeProvider(),platform:{remote:{vault,modelsVault:vault},terminal:{vault,defaultRoot:generatedHome,executable:"/bin/sh",args:["-c","printf 'GENERATED_INSTALLED_CONSOLE_READY\\\\n'; exec cat"]}}};
      let consoleRuntime=await createRuntime(options),consoleSdk=await connectMoguri({stateDir:consoleState,autoStart:false});
      try{
        const project=await consoleSdk.command({type:"project.add",path:consoleRoot}),session=await consoleSdk.sessions.create(project.id);
        if(mode==="Remote"){
          const settings=structuredClone(consoleSdk.settings.get().values);settings.remote=JSON.parse(process.env.MOGURI_GENERATED_REMOTE);
          await consoleSdk.settings.update(settings,consoleSdk.settings.get().revision);
          const configuration=(await consoleSdk.projects.configuration(project.id)).configuration;
          await consoleSdk.projects.configure(project.id,{...configuration.values,remotePath:await realpath(consoleRoot)},configuration.revision);
          await consoleSdk.remote.probe();assert.ok((await consoleSdk.remote.status()).remote.terminalBuild);
          await consoleSdk.sessions.env(session.id,"Remote");
        }
        const opened=await consoleSdk.terminal.open(session.id),before=await consoleSdk.terminal.read(opened.id),owner=consoleSdk.getState().snapshot.terminalOwners[0];
        assert.equal(before.terminal.env,mode);assert.equal(before.terminal.binding.root,await realpath(consoleRoot));
        if(mode==="Remote")assert.ok(owner.remote);else assert.equal(owner.remote,undefined);
        await consoleSdk.terminal.input(opened.id,"GENERATED_INSTALLED_CONSOLE_INPUT\\n");
        for(let n=0;n<250&&!(await consoleSdk.terminal.read(opened.id)).data.includes("GENERATED_INSTALLED_CONSOLE_INPUT");n++)await new Promise(resolve=>setTimeout(resolve,20));
        await consoleSdk.refresh();const list=consoleSdk.getState().snapshot;assert.equal(list.terminalOwners.length,1);assert.equal(list.terminals.length,1);
        await consoleSdk.terminal.reconcileOwner(owner.id);await consoleSdk.terminal.reconcile(opened.id);
        consoleSdk.disconnect();await stopMoguriService(consoleState,{preserveTerminals:true});
        consoleRuntime=await createRuntime(options);consoleSdk=await connectMoguri({stateDir:consoleState,autoStart:false});
        const after=await consoleSdk.terminal.read(opened.id);
        assert.equal(after.terminal.pid,before.terminal.pid);assert.equal(consoleSdk.getState().snapshot.terminalOwners[0].pid,owner.pid);
        assert.notEqual(after.terminal.attachmentId,before.terminal.attachmentId);assert.equal(after.terminal.status,"running");
        assert.match(after.data,/GENERATED_INSTALLED_CONSOLE_INPUT/);
        assert.equal(after.data.split("GENERATED_INSTALLED_CONSOLE_READY").length-1,1);
        const tui=await consoleSdk.slash(session.id,"/terminals read "+opened.id,"tui");assert.equal(tui.kind,"text");assert.equal(JSON.parse(tui.text).terminal.pid,before.terminal.pid);
        await consoleSdk.terminal.close(opened.id);
        if(PROTOCOL_VERSION>=53&&mode==="Local"){
          const global=await consoleSdk.terminal.openGlobal(),globalState=(await consoleSdk.terminal.read(global.id)).terminal;
          assert.equal(globalState.sessionId,null);assert.equal(globalState.projectId,null);assert.equal(globalState.binding.root,await realpath(PROTOCOL_VERSION>=59?generatedHome:consoleState));
          const globalTui=await consoleSdk.slash(session.id,"/terminals read "+global.id,"tui");assert.equal(JSON.parse(globalTui.text).terminal.sessionId,null);
          await deleteWithReviewedChildren(consoleSdk,session.id);assert.equal((await consoleSdk.terminal.read(global.id)).terminal.pid,globalState.pid);
          await consoleSdk.terminal.close(global.id);
          console.log("Installed protocol-"+PROTOCOL_VERSION+" compatibility Local console retains exact "+(PROTOCOL_VERSION>=59?"configured HOME":"data directory")+" independently of sessions/projects, with SDK ownership and TUI inspection, no model context or launch replay.");
        }
        consoleSdk.disconnect();await stopMoguriService(consoleState,{expectedConnection:consoleRuntime.connection});
        assert.equal(keys.size,0);if(mode==="Local")await assert.rejects(()=>lstat(owner.directory),{code:"ENOENT"});
      }finally{consoleSdk.disconnect();await consoleRuntime.close();}
    }
    console.log("External SDK imports/types, approved/audited install, immutable profiles and shared policies, actual Single router/solver roles/receipts/no context promotion/finite-cap rejection, solver-sourced Guided advice/human answer/artifact without an extra call, installed compaction slash lifecycle and real metered SDK history, installed worker handshake, actual model-free SSH plan saves through the installed SDK with reviewed bindings and independent boundary artifacts, reviewed Remote MCP peer/root grants and actual no-model SSH connector/result/cleanup/TUI/revocation, macOS SSH files/Git/plan without Local fallback, context/worktrees/PTY, retained artifacts/local commits, budgets/checkpoints, explicit verified repository/owner/license snapshots and installed pinned-SSH private gh account/restart/TUI provenance without controller fallback, session-bound Remote memory/index/restart/original command/TUI and exact approved MCP retrieval without Local cache reuse or model calls, sanitized outcomes and key-backed storage, metachat, vectors, MCP credentials, script-free cache and installed authenticated Local/Remote terminal-owner restart/input/TUI/no-replay/private-cleanup passed.");
  `);
  try {
    execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit", timeout: 240_000, env: { ...process.env, MOGURI_GENERATED_REMOTE: ssh ? JSON.stringify(ssh.target) : "", MOGURI_GENERATED_GITHUB: github ? JSON.stringify({ calls: github.calls, home: github.home, controllerMarker: controllerGithub.marker }) : "" } });
  } catch (error) {
    const root = resolve(".native/qualification"); await mkdir(root, { recursive: true, mode: 0o700 });
    const retained = await mkdtemp(join(root, "sdk-failure-"));
    await writeFile(join(retained, "smoke.mjs"), await readFile(join(consumer, "smoke.mjs")), { flag: "wx", mode: 0o600 });
    await writeFile(join(retained, "consumer.ts"), await readFile(join(consumer, "consumer.ts")), { flag: "wx", mode: 0o600 });
    console.error("Generated packed-consumer failure sources retained:", retained);
    throw error;
  }
  if (kanbanObservationAvailable) {
    const { qualifyKanbanObservation } = await import("./qualify-kanban-observation.mjs");
    console.log(await qualifyKanbanObservation({ packageRoot, directory: join(temporary, "generated-installed-kanban") }));
  }
  if (installedMajor > 0 || installedMajor === 0 && installedMinor >= 24) {
    execFileSync(process.execPath, ["--import", "tsx", "--test", resolve("tests/owned-role-worker.test.ts"), resolve("tests/owned-role-ledger.test.ts")], {
      stdio: "inherit", timeout: 60_000, env: { ...process.env, MOGURI_TEST_ROLE_WORKER: join(packageRoot, "dist", "worker.mjs") },
    });
    console.log("The actual installed worker passed private acknowledged tool-less role, complete budget-transfer, failed-receipt and control-loss probes. No public compound workflow or quality readiness is implied.");
  }
} finally { try { await ssh?.close(); } finally { controllerGithub?.restore(); await rm(temporary, { recursive: true, force: true }); } }
