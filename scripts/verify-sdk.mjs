import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const temporary = await mkdtemp(join(tmpdir(), "moguri-sdk-consumer-"));
let ssh, github, controllerGithub;
try {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const archive = process.argv[2] ? resolve(process.argv[2]) :
    join(temporary, JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], { encoding: "utf8" }))[0].filename);
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "generated-moguri-sdk-consumer", private: true, type: "module",
    dependencies: { moguri: `file:${archive}` },
    allowScripts: { ...manifest.allowScripts, [manifest.name]: true },
  }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--no-progress"], { cwd: consumer, stdio: "inherit" });
  execFileSync("npm", ["install-scripts", "approve", manifest.name, "--no-allow-scripts-pin"], { cwd: consumer, stdio: "inherit" });
  execFileSync("npm", ["rebuild", manifest.name, "--no-fund", "--no-progress"], { cwd: consumer, stdio: "inherit" });
  execFileSync("npm", ["audit", "--audit-level=moderate"], { cwd: consumer, stdio: "inherit" });
  const { PROTOCOL_VERSION: installedProtocol } = await import(pathToFileURL(join(consumer, "node_modules", "moguri", "dist", "sdk", "index.mjs")).href);
  const installedManifest = JSON.parse(await readFile(join(consumer, "node_modules", "moguri", "package.json"), "utf8"));
  const [installedMajor, installedMinor] = installedManifest.version.split(".").map(Number);
  const retainedRoles = installedProtocol >= 32 ? JSON.parse(execFileSync(process.execPath, ["--import", "tsx", resolve("tests/fixtures/role-sequence-export.ts"), join(temporary, "generated-retained-role-state"), String(installedProtocol)], { encoding: "utf8" })) : null;
  if (process.platform === "darwin") {
    const { createSshTarget } = await import("../tests/fixtures/ssh-target.ts");
    const directory = join(temporary, "generated-ssh"); await mkdir(directory, { mode: 0o700 });
    ssh = await createSshTarget(directory);
    ssh.target.command = [process.execPath, join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"), "worker", "--stdio"];
    ssh.target.allowCopilot = false;
    if (installedProtocol >= 26) {
      const { generatedRemoteGithub, forbidControllerGithub } = await import("../tests/fixtures/remote-github.ts");
      github = await generatedRemoteGithub(directory, ssh.target, { bridge: join(consumer, "node_modules", "moguri", "dist", "remote-bridge.mjs") });
      ssh.target = github.target; controllerGithub = await forbidControllerGithub(directory);
    }
  }
  const help = execFileSync(process.execPath, [join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"), "--help"], { cwd: consumer, encoding: "utf8" });
  if (!help.includes("Moguri CLI + SDK")) throw new Error("The installed CLI did not expose its SDK entrypoint.");
  await writeFile(join(consumer, "consumer.ts"), `
    import {MoguriSdk, DraftEditor, KUPO_MODEL_ID, defaultKupoSettings, slashCommands, type UserSettings, type KupoSettings${installedProtocol >= 28 ? ", type CandidateRecord" : ""}${installedProtocol >= 29 ? ", type CandidatePatch" : ""}${installedProtocol >= 30 ? ", type BudgetPlan" : ""}${installedProtocol >= 31 ? ", type CandidateGenerationInput, type CandidateGenerationRecord" : ""}${installedProtocol >= 32 ? ", type RoleSequenceRecord" : ""}${installedProtocol >= 34 ? ", type ModelEvidenceReport" : ""}} from "moguri";
    import {connectMoguri, createRuntime, saveArtifactExport, stopMoguriService} from "moguri/node";
    import {useMoguri} from "moguri/react";
    import {createGatewayMcpServer} from "moguri/mcp";
    ${installedProtocol >= 36 ? 'import {modelContextWindows} from "moguri";' : ""}
    async function typedConsumer() {
      const sdk = await connectMoguri({autoStart:false});
      ${installedProtocol >= 34 ? 'const evidence:ModelEvidenceReport=(await sdk.models.evidence("generated-model")).evidence;void evidence.claimed.family;void evidence.source.familyField;' : ""}
      const snapshot = sdk.settings.get();
      if (!snapshot) throw new Error("Not connected");
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
    import {spawn,execFile,execFileSync} from "node:child_process";
    import {promisify} from "node:util";
    import {createHash,randomUUID} from "node:crypto";
    import {createServer} from "node:http";
    import {fileURLToPath} from "node:url";
    import {join} from "node:path";
    import {createRuntime,connectMoguri,saveArtifactExport,stopMoguriService} from "moguri/node";
    import {DraftEditor,KUPO_MODEL_ID,defaultKupoSettings,PROTOCOL_VERSION${installedProtocol >= 36 ? ",modelContextWindows" : ""}} from "moguri";
    const root=${JSON.stringify(join(temporary, "runtime"))};
    const project=join(root,"generated-project"); await mkdir(project,{recursive:true});
    await writeFile(join(project,"generated.ts"),"export function portableSdkMemory() { return 'generated'; }");
    const git=(args,cwd=project)=>execFileSync("git",["--no-pager","-c","core.hooksPath=/dev/null","-c","core.fsmonitor=false",...args],{cwd,encoding:"utf8"});
    git(["init","--initial-branch=main"]);git(["add","--","generated.ts"]);
    git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated external SDK base"]);
    git(["config","user.name","Generated fixture"]);git(["config","user.email","fixture@example.invalid"]);
    const makeProvider=()=>{const value={state:{status:"disconnected",models:[],login:null,diagnostic:null},onChange:()=>{},refresh:async()=>value.onChange(),login:()=>{throw Error("No real authorization in SDK verification")},cancel:async()=>{},logout:async()=>{},prepare:async()=>{throw Error("No paid calls in SDK verification")}};return value;};
    const provider=makeProvider(),providers=new Map([["default",provider]]),vaults=new Map();
    const remoteSecrets=new Map();
    const remoteVault={read:async id=>remoteSecrets.get(id)??null,write:async(id,value)=>{remoteSecrets.set(id,value);},remove:async id=>{remoteSecrets.delete(id);}};
    let repositoryLookups=0;
    const repositoryMetadata={id:42,name:"example",full_name:"generated/example",html_url:"https://github.com/generated/example",owner:{login:"generated",type:"Organization"},private:false,visibility:"public",license:{spdx_id:"MIT"},description:"GENERATED_UNRETAINED_REPOSITORY_BODY"};
    const platform={terminal:{executable:"/bin/sh",args:["-c","printf 'GENERATED_EXTERNAL_PTY_READY\\n'; exec cat"]},remote:{vault:remoteVault,modelsVault:remoteVault},integrations:{fetch:async url=>{assert.equal(String(url),"https://api.github.com/repos/generated/example");repositoryLookups++;return Response.json(repositoryMetadata);}}};
    const runtime=await createRuntime({stateDir:join(root,"state"),retentionKey:Buffer.alloc(32,0x67),platform,profiles:{
      provider:id=>{if(!providers.has(id))providers.set(id,makeProvider());return providers.get(id);},
      platform:id=>{if(!vaults.has(id))vaults.set(id,new Map());const values=vaults.get(id);return{...(id==="default"?platform:{}),vault:{read:async key=>values.get(key)??null,write:async(key,value)=>{values.set(key,value);},remove:async key=>{values.delete(key);}}};}
    }});
    const sdk=await connectMoguri({stateDir:join(root,"state"),autoStart:false});
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
      const s=await sdk.command({type:"session.create",projectId:p.id});
      let operationSessionId;
      assert.equal(sdk.getState().snapshot.protocolVersion,PROTOCOL_VERSION);
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
        await sdk.sessions.delete(pasteSession.id,true);
        await assert.rejects(()=>sdk.attachments.read(pasteSession.id,file.id),{code:"attachment_session"});
      }finally{pasteEditor.dispose();}
      ` : ""}
      assert.equal(Reflect.set(sdk,"profileId",profile.id),false);
      assert.equal(sdk.profileId,"default");assert.equal(beta.profileId,profile.id);
      assert.equal(beta.getState().snapshot.projects.length,0);assert.equal(beta.getState().snapshot.sessions.length,0);
      assert.equal(beta.getState().snapshot.provider.status,"disconnected");
      const betaSession=await beta.sessions.create(null,"Generated installed Beta chat");
      assert.equal(beta.getState().snapshot.sessions[0].controls.modelId,null);
      const betaDocument=await beta.artifacts.create(betaSession.id,{kind:"decision",name:"Generated Beta private note",text:"Generated Beta-only installed bytes."});
      await assert.rejects(()=>sdk.artifacts.read(betaDocument.id),/outside this profile/);
      const scopedCli=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"status","--profile",profile.id],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
      assert.equal(JSON.parse(scopedCli.stdout).profileId,profile.id);
      assert.equal((await beta.voice.status()).voice.runtimeReady,true);
      assert.deepEqual((await beta.mcp.tools("builtin","",0,betaSession.id)).tools.map(tool=>tool.name),["fetch_page"]);
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
      await sdk.sessions.delete(bound.id,true);
      await sdk.workspaces.remove(owned.id,owned.revision,true);
      assert.equal((await sdk.workspaces.wait(owned.id)).status,"removed");
      if(PROTOCOL_VERSION>=29){
        const directory=join(root,"generated-installed-candidates");await mkdir(directory);
        const original="Generated installed candidate base.\\n",proposed="Generated installed reviewed candidate.\\n";
        await writeFile(join(directory,"candidate.txt"),original);
        git(["init","--initial-branch=main"],directory);git(["add","--","candidate.txt"],directory);
        git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated installed candidate base"],directory);
        const options={stateDir:join(root,"candidate-state"),provider:makeProvider(),retentionKey:Buffer.alloc(32,0x68)};
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
            const cli=${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},env={...process.env,MOGURI_STATE_DIR:options.stateDir};
            const read=JSON.parse((await promisify(execFile)(process.execPath,[cli,"budget","plans","--session",owner.id],{env})).stdout);assert.equal(read.plans[0].id,planned.plan.id);
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
            await candidateSdk.sessions.delete(owner.id,true,control.snapshot().sessions.find(session=>session.id===owner.id).revision);
            const released=(await candidateSdk.budgets.plans({sessionId:owner.id})).plans;
            assert.equal(released.length,typeof control.platform.budgets.planBatch==="function"?3:1);assert.ok(released.every(plan=>plan.status==="released"));
            assert.equal((await candidateSdk.budgets.dashboard({sessionId:owner.id})).totals.plannedHolds,0);
            assert.equal((await candidateSdk.budgets.calls({sessionId:owner.id})).calls.length,0);
          }
          const project=await candidateSdk.command({type:"project.add",path:directory}),source=await candidateSdk.sessions.create(project.id);
          const created=await candidateSdk.workspaces.create(project.id,"moguri/generated-installed-candidate"),stage=await candidateSdk.workspaces.wait(created.id);
          const index=await readFile(join(directory,".git/index")),head=git(["rev-parse","HEAD"],directory);
          const patch={kind:"patch",summary:"Generated installed exact candidate.",edits:[{path:"candidate.txt",baseDigest:createHash("sha256").update(original).digest("hex"),text:proposed}]};
          const path=join(root,"generated-installed-patch.json");await writeFile(path,JSON.stringify(patch));
          const cli=${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},env={...process.env,MOGURI_STATE_DIR:options.stateDir};
          const preview=JSON.parse((await promisify(execFile)(process.execPath,[cli,"candidate","preview",path,"--session",source.id,"--workspace",stage.id],{env})).stdout).preview;
          const staged=JSON.parse((await promisify(execFile)(process.execPath,[cli,"candidate","stage",path,"--session",source.id,"--workspace",stage.id,"--digest",preview.digest,"--confirm-write"],{env})).stdout);
          assert.equal(staged.candidate.status,"staged");assert.equal(await readFile(join(directory,"candidate.txt"),"utf8"),original);
          const review=(await candidateSdk.candidates.applyPreview(staged.candidate.id,source.id)).preview,commandId=randomUUID();
          const command={type:"candidate.apply",candidateId:staged.candidate.id,sessionId:source.id,expectedRevision:staged.candidate.revision,expectedDigest:review.digest,confirm:true};
          await candidateSdk.command(command,commandId);assert.equal((await candidateSdk.candidates.wait(staged.candidate.id)).candidate.status,"applied");
          assert.deepEqual(await readFile(join(directory,".git/index")),index);assert.equal(git(["rev-parse","HEAD"],directory),head);
          assert.equal(JSON.parse((await candidateSdk.artifacts.export(staged.candidate.id)).export.text).schemaVersion,2);
          const shared=await candidateSdk.slash(source.id,"/candidate read "+staged.candidate.id,"tui");assert.equal(shared.kind,"text");
          candidateSdk.disconnect();await candidateRuntime.close();candidateRuntime=await createRuntime(options);candidateSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
          assert.equal((await candidateSdk.candidates.read(staged.candidate.id)).candidate.acceptance.actor,"user");
          if(PROTOCOL_VERSION>=30){assert.equal((await candidateSdk.budgets.plans({sessionId:budgetOwnerId})).plans[0].status,"released");console.log("Installed protocol-30 planned holds, SDK/CLI/shared queries and source-deletion/restart release remain distinct from actual model calls.");}
          await writeFile(join(directory,"candidate.txt"),"Generated newer installed user edit.\\n");
          assert.equal((await candidateSdk.command(command,commandId)).id,staged.candidate.id);
          assert.equal(await readFile(join(directory,"candidate.txt"),"utf8"),"Generated newer installed user edit.\\n");
          console.log("Installed SDK/CLI candidate stage, separate exact apply, version-2 history and canonical restart replay preserved source index/HEAD without a model.");
        }finally{candidateSdk.disconnect();await candidateRuntime.close();}
      }
      const general=await sdk.sessions.create();
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===general.id).projectId,null);
      assert.equal((await sdk.suggestions.preview(general.id)).preview.scope,"project-free");
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
          const plan=await sdk.plans.read(viewer.id),inputPath=join(root,"generated-explicit-remote-plan.md");
          await writeFile(inputPath,"Generated actual installed CLI Remote plan save.\\n");
          const saved=JSON.parse((await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"plan","save",inputPath,"--session",viewer.id,"--digest",plan.digest,"--binding",plan.bindingDigest],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}})).stdout);
          assert.equal((await sdk.plans.read(viewer.id)).text,"Generated actual installed CLI Remote plan save.\\n");
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
          assert.equal(waiting.actor,"external");assert.equal(waiting.executionId,null);assert.equal(waiting.accessForwarded,false);
          const approval=sdk.getState().snapshot.sessions.find(value=>value.id===viewer.id).pendingApproval;
          await sdk.command({type:"approval.respond",sessionId:viewer.id,approvalId:approval.id,allow:true});
          assert.equal((await sdk.jobs.wait(pending.id)).status,"completed");
          const call=(await sdk.mcp.remoteCalls(viewer.id)).calls[0],result=await sdk.mcp.remoteCall(viewer.id,call.id);
          assert.equal(call.status,"completed");assert.equal(call.root,remoteRoot);
          assert.match(JSON.stringify(result.result),/Generated installed SSH-only change/);
          assert.equal(sdk.getState().snapshot.executions.find(value=>value.id===call.executionId).cleanup,"owned-worker-stopped");
          assert.equal((await sdk.telemetry.operations({sessionId:viewer.id,family:"mcp",env:"Remote"})).totals.completed,1);
          const inspected=await sdk.slash(viewer.id,"/mcp-remote inspect "+call.id,"tui");assert.equal(inspected.kind,"text");assert.match(inspected.text,/SSH-only change/);
          const cli=JSON.parse((await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"mcp","remote-calls","--session",viewer.id],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}})).stdout);
          assert.equal(cli.calls[0].id,call.id);
          await sdk.mcp.revokeRemote(viewer.id,"builtin",sdk.settings.get().revision,true);
          assert.match(JSON.stringify((await sdk.mcp.remoteCall(viewer.id,call.id)).result),/SSH-only change/);
          assert.equal(sdk.getState().snapshot.sessions.find(value=>value.id===viewer.id).usage.length,0);
        }
        assert.match((await sdk.workspaces.file(s.id,"generated.ts")).text,/portableSdkMemory/);
      }
      const workerPath=fileURLToPath(new URL("../worker.mjs",import.meta.resolve("moguri/node")));
      const workerHash=createHash("sha256").update(await readFile(workerPath)).digest("hex");
      const role=spawn(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"worker","--stdio"],{stdio:["pipe","pipe","pipe"]});
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
      const folder=(await sdk.attachments.folderPreview(general.id,project)).preview;
      await sdk.attachments.folder(general.id,project,folder.digest,true);
      assert.deepEqual((await sdk.mcp.tools("builtin","",0,general.id)).tools.map(t=>t.name),["fetch_page"]);
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
        operationSessionId=(await sdk.sessions.create(p.id,"Generated installed MCP source",{env:"Local"})).id;
        const actualTool=(await sdk.mcp.tools("builtin","grep",0,operationSessionId)).tools.find(value=>value.name==="grep_logs");
        assert.ok(actualTool);
        const actualJob=await sdk.mcp.call(operationSessionId,"builtin",actualTool.name,{path:"generated.ts",query:"portableSdkMemory"},actualTool.digest);
        let actualApproval;
        for(let n=0;n<400&&!actualApproval;n++){actualApproval=sdk.getState().snapshot.sessions.find(value=>value.id===operationSessionId).pendingApproval;if(!actualApproval)await new Promise(resolve=>setTimeout(resolve,20));}
        assert.ok(actualApproval);await sdk.command({type:"approval.respond",sessionId:operationSessionId,approvalId:actualApproval.id,allow:true});
        assert.equal((await sdk.jobs.wait(actualJob.id)).status,"completed");
        assert.equal((await sdk.telemetry.operations({sessionId:operationSessionId,family:"mcp"})).totals.completed,1);
        assert.equal((await sdk.budgets.dashboard()).totals.calls,beforeCalls);
        await sdk.refresh();await sdk.sessions.delete(operationSessionId,true);
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
      await sdk.sessions.delete(s.id,true);
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
        const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
        const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));generatedRequests.push(body);
        response.writeHead(200,{"Content-Type":"text/event-stream"});
        const frame=(delta,finish_reason=null)=>response.write("data: "+JSON.stringify({id:"generated-external-response",object:"chat.completion.chunk",model:"generated-external-budget",choices:[{index:0,delta,finish_reason}]})+"\\n\\n");
        const user=body.messages.findLastIndex(value=>value.role==="user");
        if(body.messages.some(value=>["system","developer"].includes(value.role)&&String(value.content).includes("You classify a Moguri task"))){
          frame({role:"assistant",content:JSON.stringify({pattern:"single",modelId:"generated-external-budget",confidence:0.95,reason:"Generated installed classifier-only advice."})});frame({},"stop");
        }else if(String(body.messages[user]?.content).includes("Generated installed Guided question")&&!body.messages.slice(user+1).some(value=>value.role==="tool")){
          frame({role:"assistant",tool_calls:[{index:0,id:"generated-installed-guided-call",type:"function",function:{name:"ask_user",arguments:JSON.stringify({question:"Choose a generated installed approach?",choices:["Generated installed first","Generated installed second"],allowFreeform:false,recommendation:{choiceIndex:1,reason:"Generated installed solver recommendation."}})}}]});frame({},"tool_calls");
        }else{frame({role:"assistant",content:"Generated external budget response."});frame({},"stop");}
        response.write("data: "+JSON.stringify({choices:[],usage:{prompt_tokens:30,completion_tokens:12,total_tokens:42}})+"\\n\\n");response.end("data: [DONE]\\n\\n");
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
      const guidedArtifact=beta.getState().snapshot.artifacts.find(value=>value.questionId===pending.id);
      assert.match((await beta.artifacts.read(guidedArtifact.id)).text,/Model recommendation \\(not a user answer\\)/);
      assert.deepEqual(beta.routing.policy(),defaultKupoSettings());
      await beta.routing.configure({...defaultKupoSettings(),enabled:true,classifierModelId:generatedModel.id,approvedModelIds:[generatedModel.id],allowHosted:true},beta.settings.get().revision);
      const routed=await beta.sessions.create(null,"Generated installed Single");
      const installedSelection=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"slash","/model kupo","--session",routed.id,"--profile",beta.profileId],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
      assert.equal(JSON.parse(installedSelection.stdout).kind,"ok");
      const installedRouting=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"slash","/kupo status","--session",routed.id,"--profile",beta.profileId],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
      assert.equal(JSON.parse(JSON.parse(installedRouting.stdout).text).policy.enabled,true);assert.equal(generatedRequests.length,4);
      await beta.refresh();
      await beta.command({type:"draft.save",sessionId:routed.id,expectedRevision:0,text:"Generated installed Single task.",attachments:[]});
      await beta.command({type:"message.send",sessionId:routed.id,expectedRevision:1,delivery:"queue"});
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
      const cliCalls=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"budget","calls","--profile",beta.profileId,"--filters",JSON.stringify({range:{kind:"days",days:7},sessionId:routed.id,limit:1})],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
      assert.equal(JSON.parse(cliCalls.stdout).type,"budget.calls");assert.equal(JSON.parse(cliCalls.stdout).calls[0].reportedTokens,42);
      if(PROTOCOL_VERSION>=21){
        const outcomes=await beta.telemetry.operations({sessionId:routed.id});
        assert.equal(outcomes.type,"telemetry.operations");assert.equal(outcomes.totals.attempts,0);assert.equal(outcomes.totals.failureRate,null);
        assert.equal(outcomes.coverage.priorHistory,"retained-events-only");
        const retained=(await beta.telemetry.storage()).storage;
        assert.equal(retained.profileId,beta.profileId);assert.ok(retained.bytes.total>0);assert.equal(retained.physicalBytes,null);
        assert.equal(retained.bytes.total,retained.bytes.events+retained.bytes.blobGrants+retained.bytes.keys);
        const operationCli=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"telemetry","operations","--profile",beta.profileId,"--filters",JSON.stringify({sessionId:routed.id})],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
        assert.equal(JSON.parse(operationCli.stdout).totals.attempts,0);
        const storageCli=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"telemetry","storage","--profile",beta.profileId],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
        assert.equal(JSON.parse(storageCli.stdout).storage.measurement,"key-backed-retained-ciphertext");
        const slash=await beta.slash(routed.id,"/dashboard operations "+JSON.stringify({sessionId:routed.id}),"tui");
        assert.equal(slash.kind,"text");assert.equal(JSON.parse(slash.text).totals.attempts,0);
        const actualOutcome=await sdk.telemetry.operations({sessionId:operationSessionId,family:"mcp"});
        assert.equal(actualOutcome.totals.completed,1);assert.equal(actualOutcome.entries[0].actor,"external");
        assert.equal((await beta.telemetry.operations({sessionId:operationSessionId})).totals.attempts,0);
        const actualCli=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"telemetry","operations","--session",operationSessionId],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
        assert.equal(JSON.parse(actualCli.stdout).totals.completed,1);
        assert.equal(JSON.stringify(actualOutcome).includes("portableSdkMemory"),false);assert.equal(generatedRequests.length,6);
      }
      if(PROTOCOL_VERSION>=22){
        const directory=join(root,"generated-repository-attribution");await mkdir(directory);
        await writeFile(join(directory,"fixture.txt"),"Generated installed attributed MCP bytes.");
        git(["init","--initial-branch=main"],directory);git(["add","--","fixture.txt"],directory);
        git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated attribution base"],directory);
        git(["remote","add","origin","https://github.com/generated/example.git"],directory);
        const project=await sdk.command({type:"project.add",path:directory}),session=await sdk.sessions.create(project.id,"Generated installed attributed source",{env:"Local"});
        const preview=(await sdk.repositories.preview(session.id)).preview;assert.equal(preview.lookupBoundary,"control-plane-public");assert.equal(repositoryLookups,0);
        const refresh=await sdk.repositories.refresh(session.id,preview.bindingDigest,preview.revision,true);assert.equal((await sdk.jobs.wait(refresh.id)).status,"completed");
        assert.equal((await sdk.repositories.state(session.id)).observation.repository.publicOsiLicensed,true);assert.equal(repositoryLookups,1);
        const tool=(await sdk.mcp.tools("builtin","grep",0,session.id)).tools.find(value=>value.name==="grep_logs"),job=await sdk.mcp.call(session.id,"builtin",tool.name,{path:"fixture.txt",query:"Generated"},tool.digest);
        let approval;
        for(let n=0;n<400&&!approval;n++){approval=sdk.getState().snapshot.sessions.find(value=>value.id===session.id).pendingApproval;if(!approval)await new Promise(resolve=>setTimeout(resolve,20));}
        assert.ok(approval);await sdk.command({type:"approval.respond",sessionId:session.id,approvalId:approval.id,allow:true});assert.equal((await sdk.jobs.wait(job.id)).status,"completed");
        const observed=await sdk.telemetry.operations({repositoryId:42,visibility:"open-source"});
        assert.equal(observed.totals.completed,1);assert.equal(observed.entries[0].repository.fullName,"generated/example");assert.equal(observed.entries[0].actor,"external");
        assert.equal(JSON.stringify(observed).includes("GENERATED_UNRETAINED_REPOSITORY_BODY"),false);assert.equal((await beta.telemetry.operations({repositoryId:42})).totals.attempts,0);
        const cli=await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"repository","state","--session",session.id],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}});
        assert.equal(JSON.parse(cli.stdout).observation.repository.id,42);
        const slash=await sdk.slash(session.id,"/repository state","tui");assert.equal(slash.kind,"text");assert.equal(JSON.parse(slash.text).observation.repository.licenseId,"MIT");
        await sdk.refresh();await sdk.sessions.delete(session.id,true);
        const removal=(await sdk.artifacts.projectPreview(project.id)).preview,configuration=(await sdk.projects.configuration(project.id)).configuration;
        await sdk.projects.remove(project.id,true,configuration.revision,{action:"retain",expectedDigest:removal.digest});
        assert.equal((await sdk.telemetry.operations({repositoryId:42})).totals.completed,1);assert.equal(repositoryLookups,1);assert.equal(generatedRequests.length,6);
      }
      assert.deepEqual(sdk.routing.policy(),defaultKupoSettings());
      if(PROTOCOL_VERSION>=19){
        const compact=await beta.sessions.create(null,"Generated installed compaction",{modelId:generatedModel.id,autonomy:"Manual"});
        for(let turn=0;turn<3;turn++){
          const current=beta.getState().snapshot.sessions.find(value=>value.id===compact.id);
          await beta.command({type:"draft.save",sessionId:compact.id,expectedRevision:current.draft.revision,text:"Generated installed retained turn "+turn+". "+"Generated retained compaction detail. ".repeat(80),attachments:[]});
          await beta.command({type:"message.send",sessionId:compact.id,expectedRevision:current.draft.revision+1,delivery:"queue"});
          for(let n=0;n<400&&beta.getState().snapshot.sessions.find(value=>value.id===compact.id).turnId;n++)await new Promise(resolve=>setTimeout(resolve,20));
          assert.equal(beta.getState().snapshot.sessions.find(value=>value.id===compact.id).status,"completed");
        }
        const invoke=async text=>JSON.parse((await promisify(execFile)(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"slash",text,"--session",compact.id,"--profile",beta.profileId],{env:{...process.env,MOGURI_STATE_DIR:join(root,"state")}})).stdout);
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
        const options={stateDir:join(root,"generation-state"),retentionKey:Buffer.alloc(32,0x79),provider};
        generationRuntime=await createRuntime(options);generationSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
        const proof=await qualifyCandidateGeneration({sdk:generationSdk,node:process.execPath,cli:${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},
          directory:join(root,"generated-installed-generation"),stateDir:options.stateDir,modelId:model.id,setReply:value=>{reply=value??"";},requests});
        generationSdk.disconnect();await generationRuntime.close();generationRuntime=await createRuntime(options);generationSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
        await proof.verifyRecovery(generationSdk);
        console.log("Installed protocol-31 SDK/CLI/shared generation used the actual owned worker/draft ledger, immutable model provenance/version-3 history, separate reviewed stage/apply and missing-receipt restart replay without another model request.");
        ${installedMajor > 0 || installedMinor >= 26 ? `
        generationSdk.disconnect();await generationRuntime.close();
        model.contextWindow=262144;provider.state.models[0].contextWindow=model.contextWindow;
        const ownedOptions={...options,stateDir:join(root,"owned-role-state")};
        generationRuntime=await createRuntime(ownedOptions);generationSdk=await connectMoguri({stateDir:ownedOptions.stateDir,autoStart:false});
        const {qualifyOwnedSequence}=await import(${JSON.stringify(new URL("./qualify-owned-sequence.mjs", import.meta.url).href)});
        const ownedProof=await qualifyOwnedSequence({sdk:generationSdk,controller:generationRuntime.controller,node:process.execPath,
          cli:${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},directory:join(root,"generated-installed-owned-roles"),
          stateDir:ownedOptions.stateDir,modelId:model.id,setReply:value=>{reply=value??"";},requests,proposalOrigin:PROTOCOL_VERSION>=33,roleContracts:PROTOCOL_VERSION>=35});
        generationSdk.disconnect();await generationRuntime.close();generationRuntime=await createRuntime(ownedOptions);
        generationSdk=await connectMoguri({stateDir:ownedOptions.stateDir,autoStart:false});
        await ownedProof.verifyRecovery(generationSdk,generationRuntime.controller);
        console.log("Actual installed controller/worker owns complete planned, bounded, independently retained roles with explicit untrusted prior-result context, shared CLI/TUI/SDK reads, source deletion/reopen and lost-receipt/deletion-intent replay refusal. No public compound or family-quality readiness.");
        if(PROTOCOL_VERSION>=33)console.log("Actual installed SDK/CLI/shared final-role proposals preserve exact review-bound origin, separate staging/application, source-role deletion, independent raw-copy/export5/reopen and actual-user acceptance without another model.");
        if(PROTOCOL_VERSION>=35)console.log("Actual installed controller/worker binds version-2 router/patch/critic contracts, excludes router explanations from selected contexts and retains four actual 168-token role calls; SDK/CLI/shared contract reads, canonical origin/copy/reopen keep declared validity separate from quality or approval.");
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
        const cli=${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))};
        const inspected=JSON.parse((await promisify(execFile)(process.execPath,[cli,"roles",evidence.sequenceId,"1"],{env:{...process.env,MOGURI_STATE_DIR:options.stateDir}})).stdout);
        assert.equal(inspected.sequence.id,evidence.sequenceId);assert.ok(inspected.step.result.includes(evidence.rawMarker));
        const observer=await roleSdk.sessions.create(null,"Generated role-data observer");
        assert.equal(JSON.parse((await roleSdk.slash(observer.id,"/roles "+evidence.sequenceId+" 1","tui")).text).sequence.id,evidence.sequenceId);
        roleSdk.disconnect();await roleRuntime.close();roleRuntime=await createRuntime(options);roleSdk=await connectMoguri({stateDir:options.stateDir,autoStart:false});
        assert.equal((await roleSdk.roleSequences.read(evidence.sequenceId,1)).sequence.status,"completed");
        assert.deepEqual(roleRuntime.controller.platform.roles.original(evidence.commandId,evidence.commandDigest),{id:evidence.sequenceId,revision:evidence.revision});
        const artifact=(await roleSdk.artifacts.read(evidence.sequenceId)).artifact;await roleSdk.artifacts.delete(evidence.sequenceId,artifact.revision,true);
        await assert.rejects(()=>roleSdk.roleSequences.read(evidence.sequenceId),{code:"role_sequence_missing"});
        assert.throws(()=>roleRuntime.controller.platform.roles.original(evidence.commandId,evidence.commandDigest),{code:"role_sequence_deleted"});
        assert.equal((await roleSdk.budgets.calls()).calls.length,2);
        console.log("Actual installed protocol-32 SDK/runtime/CLI/shared role inspection preserves independent raw input/results after source deletion/reopen, version-4 history, immutable bytes and deletion intent without inference.");
      }finally{roleSdk.disconnect();await roleRuntime.close();}
    }
    if(PROTOCOL_VERSION>=26&&process.env.MOGURI_GENERATED_GITHUB){
      const observed=JSON.parse(process.env.MOGURI_GENERATED_GITHUB),state=join(root,"generated-metadata-state"),remoteRoot=await realpath(join(root,"generated-remote-workspace"));
      git(["remote","add","origin","https://github.com/generated/example.git"],remoteRoot);
      const options={stateDir:state,retentionKey:Buffer.alloc(32,0x73),provider:makeProvider(),platform:{remote:{vault:remoteVault,modelsVault:remoteVault}}};
      let metadataRuntime=await createRuntime(options),metadataSdk=await connectMoguri({stateDir:state,autoStart:false});
      try{
        const metadataProject=await metadataSdk.command({type:"project.add",path:project}),session=await metadataSdk.sessions.create(metadataProject.id);
        const settings=structuredClone(metadataSdk.settings.get().values);settings.remote=JSON.parse(process.env.MOGURI_GENERATED_REMOTE);
        await metadataSdk.settings.update(settings,metadataSdk.settings.get().revision);
        const config=(await metadataSdk.projects.configuration(metadataProject.id)).configuration;
        await metadataSdk.projects.configure(metadataProject.id,{...config.values,remotePath:remoteRoot,repo:{...config.values.repo,githubAccess:"gh-cli"}},config.revision);
        await metadataSdk.remote.probe();await metadataSdk.sessions.env(session.id,"Remote");
        const preview=(await metadataSdk.repositories.preview(session.id)).preview;assert.equal(preview.lookupBoundary,"remote-gh-cli");assert.equal(preview.remote.root,remoteRoot);
        const refresh=await metadataSdk.repositories.refresh(session.id,preview.bindingDigest,preview.revision,true);assert.equal((await metadataSdk.jobs.wait(refresh.id)).status,"completed");
        const retained=(await metadataSdk.repositories.state(session.id)).observation;assert.equal(retained.repository.visibility,"private");assert.deepEqual(retained.remote,preview.remote);
        const cli=${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))};
        assert.match((await promisify(execFile)(process.execPath,[cli,"slash","/repository state","--session",session.id],{env:{...process.env,MOGURI_STATE_DIR:state}})).stdout,/remote-gh-cli/);
        assert.match((await metadataSdk.slash(session.id,"/repository state","tui")).text,/private/);
        metadataSdk.disconnect();await metadataRuntime.close();metadataRuntime=await createRuntime(options);metadataSdk=await connectMoguri({stateDir:state,autoStart:false});
        await metadataSdk.remote.probe();assert.deepEqual((await metadataSdk.repositories.state(session.id)).observation,retained);
        const calls=(await readFile(observed.calls,"utf8")).trim().split("\\n").map(line=>JSON.parse(line));assert.equal(calls.length,1);assert.equal(calls[0].home,observed.home);assert.equal(calls[0].cwd,remoteRoot);
        await assert.rejects(()=>lstat(observed.controllerMarker),{code:"ENOENT"});
      }finally{metadataSdk.disconnect();await metadataRuntime.close();}
    }
    if(PROTOCOL_VERSION>=27&&process.env.MOGURI_GENERATED_REMOTE){
      const state=join(root,"generated-memory-state"),remoteRoot=await realpath(join(root,"generated-remote-workspace"));
      const options={stateDir:state,retentionKey:Buffer.alloc(32,0x75),provider:makeProvider(),platform:{remote:{vault:remoteVault,modelsVault:remoteVault}}};
      let memoryRuntime=await createRuntime(options),memorySdk=await connectMoguri({stateDir:state,autoStart:false});
      try{
        const memoryProject=await memorySdk.command({type:"project.add",path:project}),session=await memorySdk.sessions.create(memoryProject.id);
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
        const cli=${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))};
        assert.match((await promisify(execFile)(process.execPath,[cli,"memory","search","SSH-only change","--session",session.id],{env:{...process.env,MOGURI_STATE_DIR:state}})).stdout,/SSH-only change/);
        assert.match((await memorySdk.slash(session.id,"/memory state","tui")).text,/Remote/);
        memorySdk.disconnect();await memoryRuntime.close();memoryRuntime=await createRuntime(options);memorySdk=await connectMoguri({stateDir:state,autoStart:false});
        assert.equal((await memorySdk.command(command,commandId)).id,indexed.id);assert.equal((await memorySdk.remote.status()).remote.ready,false);
        await memorySdk.remote.probe();assert.deepEqual((await memorySdk.memory.state(session.id)).index,before);
        const preview=(await memorySdk.mcp.remotePreview(session.id,"builtin")).preview;
        await memorySdk.mcp.grantRemote(session.id,"builtin",preview.digest,preview.settingsRevision,false,true);await memorySdk.remote.probe();
        const tool=(await memorySdk.mcp.tools("builtin","memory",0,session.id)).tools.find(tool=>tool.name==="search_memory");
        const requested=await memorySdk.mcp.call(session.id,"builtin",tool.name,{query:"SSH-only change"},tool.digest);
        const approval=memorySdk.getState().snapshot.sessions.find(value=>value.id===session.id).pendingApproval;
        await memorySdk.command({type:"approval.respond",sessionId:session.id,approvalId:approval.id,allow:true});
        assert.equal((await memorySdk.jobs.wait(requested.id)).status,"completed");assert.match((await memorySdk.mcp.readResult(requested.id)).text,/SSH-only change/);
        assert.equal(memorySdk.getState().snapshot.sessions.find(value=>value.id===session.id).usage.length,0);
      }finally{memorySdk.disconnect();await memoryRuntime.close();}
    }
    if(PROTOCOL_VERSION>=23&&process.platform==="darwin")for(const mode of ["Local",...(PROTOCOL_VERSION>=25&&process.env.MOGURI_GENERATED_REMOTE?["Remote"]:[])]){
      const consoleRoot=join(root,"generated-console-project-"+mode),consoleState=join(root,"generated-console-state-"+mode),keys=new Map();
      await mkdir(consoleRoot);
      const vault={read:async id=>keys.get(id)??null,write:async(id,value)=>{keys.set(id,value);},remove:async id=>{keys.delete(id);}};
      const options={stateDir:consoleState,retentionKey:Buffer.alloc(32,0x71),provider:makeProvider(),platform:{remote:{vault,modelsVault:vault},terminal:{vault,executable:"/bin/sh",args:["-c","printf 'GENERATED_INSTALLED_CONSOLE_READY\\\\n'; exec cat"]}}};
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
        const cli=${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))};
        const invoke=args=>promisify(execFile)(process.execPath,[cli,...args],{env:{...process.env,MOGURI_STATE_DIR:consoleState}});
        const input=spawn(process.execPath,[cli,"terminal","input",opened.id],{env:{...process.env,MOGURI_STATE_DIR:consoleState},stdio:["pipe","pipe","pipe"]});
        let stdout="",stderr="";input.stdout.on("data",data=>{stdout+=data;});input.stderr.on("data",data=>{stderr+=data;});
        const completed=new Promise((resolve,reject)=>{input.once("error",reject);input.once("exit",resolve);});
        input.stdin.end("GENERATED_INSTALLED_CONSOLE_INPUT\\n");assert.equal(await completed,0,stderr);assert.equal(JSON.parse(stdout).acknowledged,true);
        const list=JSON.parse((await invoke(["terminal","list"])).stdout);assert.equal(list.owners.length,1);assert.equal(list.terminals.length,1);
        await invoke(["terminal","owner-reconcile",owner.id]);await invoke(["terminal","reconcile",opened.id]);
        consoleSdk.disconnect();await stopMoguriService(consoleState,{preserveTerminals:true});
        consoleRuntime=await createRuntime(options);consoleSdk=await connectMoguri({stateDir:consoleState,autoStart:false});
        const after=await consoleSdk.terminal.read(opened.id);
        assert.equal(after.terminal.pid,before.terminal.pid);assert.equal(consoleSdk.getState().snapshot.terminalOwners[0].pid,owner.pid);
        assert.notEqual(after.terminal.attachmentId,before.terminal.attachmentId);assert.equal(after.terminal.status,"running");
        assert.match(after.data,/GENERATED_INSTALLED_CONSOLE_INPUT/);
        assert.equal(after.data.split("GENERATED_INSTALLED_CONSOLE_READY").length-1,1);
        const read=JSON.parse((await invoke(["terminal","read",opened.id])).stdout);assert.equal(read.terminal.pid,before.terminal.pid);
        const tui=await consoleSdk.slash(session.id,"/terminals read "+opened.id,"tui");assert.equal(tui.kind,"text");assert.equal(JSON.parse(tui.text).terminal.pid,before.terminal.pid);
        await consoleSdk.terminal.close(opened.id);consoleSdk.disconnect();await stopMoguriService(consoleState);
        assert.equal(keys.size,0);if(mode==="Local")await assert.rejects(()=>lstat(owner.directory),{code:"ENOENT"});
      }finally{consoleSdk.disconnect();await consoleRuntime.close();}
    }
    console.log("External SDK imports/types, approved/audited install, immutable profiles and shared policies, actual Single router/solver roles/receipts/no context promotion/finite-cap rejection, solver-sourced Guided advice/human answer/artifact without an extra call, installed compaction CLI lifecycle and real metered SDK history, installed worker handshake, actual model-free SSH plan saves through installed CLI/SDK with reviewed bindings and independent boundary artifacts, reviewed Remote MCP peer/root grants and actual no-model SSH connector/result/cleanup/CLI/TUI/revocation, macOS SSH files/Git/plan without Local fallback, context/worktrees/PTY, retained artifacts/local commits, budgets/checkpoints, explicit verified repository/owner/license snapshots and installed pinned-SSH private gh account/restart/CLI/TUI provenance without controller fallback, session-bound Remote memory/index/restart/original command/CLI/TUI and exact approved MCP retrieval without Local cache reuse or model calls, sanitized outcomes and key-backed storage, metachat, vectors, MCP credentials, script-free cache and installed authenticated Local/Remote terminal-owner restart/input/CLI/TUI/no-replay/private-cleanup passed.");
  `);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit", timeout: 90_000, env: { ...process.env, MOGURI_GENERATED_REMOTE: ssh ? JSON.stringify(ssh.target) : "", MOGURI_GENERATED_GITHUB: github ? JSON.stringify({ calls: github.calls, home: github.home, controllerMarker: controllerGithub.marker }) : "" } });
  if (installedProtocol >= 40 && process.platform === "darwin") {
    const { qualifyDecisions } = await import("./qualify-decisions.mjs");
    console.log(await qualifyDecisions({ packageRoot: join(consumer, "node_modules", "moguri"), directory: join(temporary, "generated-installed-decisions") }));
  }
  if (installedProtocol >= 34) {
    const { qualifyModelEvidence } = await import("./qualify-model-evidence.mjs");
    console.log(await qualifyModelEvidence({ packageRoot: join(consumer, "node_modules", "moguri"), directory: join(temporary, "generated-explicit-model-evidence") }));
  }
  if (installedMajor > 0 || installedMajor === 0 && installedMinor >= 24) {
    execFileSync(process.execPath, ["--import", "tsx", "--test", resolve("tests/owned-role-worker.test.ts"), resolve("tests/owned-role-ledger.test.ts")], {
      stdio: "inherit", timeout: 60_000, env: { ...process.env, MOGURI_TEST_ROLE_WORKER: join(consumer, "node_modules", "moguri", "dist", "worker.mjs") },
    });
    console.log("The actual installed worker passed private acknowledged tool-less role, complete budget-transfer, failed-receipt and control-loss probes. No public compound workflow or quality readiness is implied.");
  }
} finally { try { await ssh?.close(); } finally { controllerGithub?.restore(); await rm(temporary, { recursive: true, force: true }); } }
