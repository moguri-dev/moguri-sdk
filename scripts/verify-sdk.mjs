import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "moguri-sdk-consumer-"));
try {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], { encoding: "utf8" }));
  const archive = join(temporary, packed[0].filename);
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
  const help = execFileSync(process.execPath, [join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"), "--help"], { cwd: consumer, encoding: "utf8" });
  if (!help.includes("Moguri CLI + SDK")) throw new Error("The installed CLI did not expose its SDK entrypoint.");
  await writeFile(join(consumer, "consumer.ts"), `
    import {MoguriSdk, DraftEditor, slashCommands, type UserSettings} from "moguri";
    import {connectMoguri, createRuntime, saveArtifactExport} from "moguri/node";
    import {useMoguri} from "moguri/react";
    import {createGatewayMcpServer} from "moguri/mcp";
    async function typedConsumer() {
      const sdk = await connectMoguri({autoStart:false});
      const snapshot = sdk.settings.get();
      if (!snapshot) throw new Error("Not connected");
      const settings: UserSettings = snapshot.values;
      const project = await sdk.projects.configuration("generated-id");
      await sdk.projects.configure("generated-id",project.configuration.values,project.configuration.revision);
      const editor = new DraftEditor(sdk,"generated-id",{revision:0,text:"",attachments:[]});
      const held = await editor.send("queue",true); void held.id;
      await sdk.sessions.mode("generated-id","read-only");
      await sdk.sessions.modelOptions("generated-id",{contextWindow:16384,thinkingEffort:"low"});
      const context=await sdk.sessions.context("generated-id"); void context.context.estimatedTokens;
      const general=await sdk.sessions.create(null);
      const document=await sdk.artifacts.create(null,{kind:"decision",name:"Generated independent note",text:"Generated retained text"});
      await sdk.artifacts.update(document.id!,{text:"Generated edited note"},0);
      const revisions=await sdk.artifacts.history(document.id!);void revisions.revisions[0]?.sources;
      const question=sdk.getState().snapshot?.questions[0];
      if(question){await sdk.questions.answer(question.id,"Generated actual user answer",question.revision);await sdk.questions.answerDraft(question.id,question.revision);}
      const exported=(await sdk.artifacts.export(document.id!)).export;
      await saveArtifactExport("/generated/explicit-export.json",exported);
      await sdk.sessions.env(general.id!,"Local");
      const remote=await sdk.remote.status();void remote.remote.workerDigest;
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
    import {mkdir,writeFile,readFile} from "node:fs/promises";
    import {spawn,execFileSync} from "node:child_process";
    import {createHash} from "node:crypto";
    import {fileURLToPath} from "node:url";
    import {join} from "node:path";
    import {createRuntime,connectMoguri,saveArtifactExport} from "moguri/node";
    import {DraftEditor} from "moguri";
    const root=${JSON.stringify(join(temporary, "runtime"))};
    const project=join(root,"generated-project"); await mkdir(project,{recursive:true});
    await writeFile(join(project,"generated.ts"),"export function portableSdkMemory() { return 'generated'; }");
    const git=args=>execFileSync("git",["--no-pager","-c","core.hooksPath=/dev/null","-c","core.fsmonitor=false",...args],{cwd:project,encoding:"utf8"});
    git(["init","--initial-branch=main"]);git(["add","--","generated.ts"]);
    git(["-c","user.name=Generated fixture","-c","user.email=fixture@example.invalid","commit","--no-gpg-sign","-m","Generated external SDK base"]);
    const provider={state:{status:"disconnected",models:[],login:null,diagnostic:null},onChange:()=>{},refresh:async()=>provider.onChange(),login:()=>{throw Error("No real authorization in SDK verification")},cancel:async()=>{},logout:async()=>{},prepare:async()=>{throw Error("No paid calls in SDK verification")}};
    const runtime=await createRuntime({stateDir:join(root,"state"),provider,retentionKey:Buffer.alloc(32,0x67),platform:{terminal:{executable:"/bin/sh",args:["-c","printf 'GENERATED_EXTERNAL_PTY_READY\\n'; exec cat"]}}});
    const sdk=await connectMoguri({stateDir:join(root,"state"),autoStart:false});
    try {
      assert.equal(sdk.settings.get().values.appearance.theme,"dark");
      const p=await sdk.command({type:"project.add",path:project});
      const s=await sdk.command({type:"session.create",projectId:p.id});
      assert.equal(sdk.getState().snapshot.protocolVersion,11);
      const isolated=await sdk.workspaces.create(p.id,"moguri/generated-external");
      const owned=await sdk.workspaces.wait(isolated.id);
      assert.ok((await sdk.workspaces.discover(p.id)).registrations.some(entry=>entry.managedId===owned.id&&entry.locked));
      const bound=await sdk.sessions.create(p.id,"Generated external worktree",{env:"Local"},owned.id);
      assert.match((await sdk.workspaces.file(bound.id,"generated.ts")).text,/portableSdkMemory/);
      assert.equal((await sdk.workspaces.git(bound.id)).branch,"moguri/generated-external");
      await sdk.sessions.delete(bound.id,true);
      await sdk.workspaces.remove(owned.id,owned.revision,true);
      assert.equal((await sdk.workspaces.wait(owned.id)).status,"removed");
      const general=await sdk.sessions.create();
      assert.equal(sdk.getState().snapshot.sessions.find(v=>v.id===general.id).projectId,null);
      assert.equal((await sdk.suggestions.preview(general.id)).preview.scope,"project-free");
      assert.equal((await sdk.remote.status()).remote.ready,false);
      const workerPath=fileURLToPath(new URL("../worker.mjs",import.meta.resolve("moguri/node")));
      const workerHash=createHash("sha256").update(await readFile(workerPath)).digest("hex");
      const role=spawn(process.execPath,[${JSON.stringify(join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"))},"worker","--stdio"],{stdio:["pipe","pipe","pipe"]});
      const roleExit=new Promise(resolve=>role.once("exit",resolve));
      try {
        const response=await new Promise((resolve,reject)=>{
          let text="";const timer=setTimeout(()=>reject(new Error("Installed SSH worker entrypoint did not answer.")),10000);
          role.once("error",reject);
          role.stdout.on("data",data=>{text+=data;if(text.includes("\\n")){clearTimeout(timer);try{resolve(JSON.parse(text.split("\\n")[0]));}catch(error){reject(error);}}});
          role.stdin.write(JSON.stringify({action:"probe",protocol:11,workerDigest:workerHash,stateDir:join(root,"unused-remote-state"),root:null})+"\\n");
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
      const retained=await sdk.artifacts.create(null,{projectId:p.id,kind:"decision",name:"Generated independent project decision",text:"Generated first decision."});
      await sdk.artifacts.update(retained.id,{text:"Generated revised decision."},0);
      assert.equal((await sdk.artifacts.read(retained.id,0)).text,"Generated first decision.");
      const exported=(await sdk.artifacts.projectExport(p.id));
      const saved=await saveArtifactExport(join(root,"generated-external-artifacts.json"),exported.export);
      assert.equal(saved.digest,exported.export.digest);
      assert.equal(await readFile(saved.path,"utf8"),exported.export.text);
      const configuration=(await sdk.projects.configuration(p.id)).configuration;
      await sdk.projects.remove(p.id,true,configuration.revision,{action:"retain",expectedDigest:exported.preview.digest});
      assert.equal((await sdk.artifacts.read(retained.id)).artifact.projectId,null);
      await sdk.artifacts.delete(retained.id,2,true);
      await assert.rejects(()=>sdk.artifacts.read(retained.id),/missing|deleted|outside/);
    } finally {sdk.disconnect();await runtime.close();}
    console.log("External SDK imports/types, approved/audited install, installed SSH-worker handshake, typed context, owned worktrees, real macOS PTY, independent artifact revisions/exports/project retention, metachat/config review, vectors, MCP and script-free cache install passed.");
  `);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit", timeout: 90_000 });
} finally { await rm(temporary, { recursive: true, force: true }); }
