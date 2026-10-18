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
  const help = execFileSync(process.execPath, [join(consumer, "node_modules", "moguri", "bin", "moguri.mjs"), "--help"], { cwd: consumer, encoding: "utf8" });
  if (!help.includes("Moguri CLI + SDK")) throw new Error("The installed CLI did not expose its SDK entrypoint.");
  await writeFile(join(consumer, "consumer.ts"), `
    import {MoguriSdk, type UserSettings} from "moguri";
    import {connectMoguri, createRuntime} from "moguri/node";
    import {useMoguri} from "moguri/react";
    import {createGatewayMcpServer} from "moguri/mcp";
    async function typedConsumer() {
      const sdk = await connectMoguri({autoStart:false});
      const snapshot = sdk.settings.get();
      if (!snapshot) throw new Error("Not connected");
      const settings: UserSettings = snapshot.values;
      return settings;
    }
    void MoguriSdk; void createRuntime; void useMoguri; void createGatewayMcpServer; void typedConsumer;
  `);
  execFileSync(resolve("node_modules/.bin/tsc"), [
    "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2024", "--noEmit", "consumer.ts",
  ], { cwd: consumer, stdio: "inherit" });
  await writeFile(join(consumer, "smoke.mjs"), `
    import assert from "node:assert/strict";
    import {mkdir,writeFile} from "node:fs/promises";
    import {join} from "node:path";
    import {createRuntime,connectMoguri} from "moguri/node";
    const root=${JSON.stringify(join(temporary, "runtime"))};
    const project=join(root,"generated-project"); await mkdir(project,{recursive:true});
    await writeFile(join(project,"generated.ts"),"export function portableSdkMemory() { return 'generated'; }");
    const provider={state:{status:"disconnected",models:[],login:null,diagnostic:null},onChange:()=>{},refresh:async()=>provider.onChange(),login:()=>{throw Error("No real authorization in SDK verification")},cancel:async()=>{},logout:async()=>{},prepare:async()=>{throw Error("No paid calls in SDK verification")}};
    const runtime=await createRuntime({stateDir:join(root,"state"),provider});
    const sdk=await connectMoguri({stateDir:join(root,"state"),autoStart:false});
    try {
      assert.equal(sdk.settings.get().values.appearance.theme,"dark");
      const p=await sdk.command({type:"project.add",path:project});
      const s=await sdk.command({type:"session.create",projectId:p.id});
      const preview=await sdk.prompt.preview(s.id); assert.match(preview.effective,/moguri-execution-contract/);
      const settings=structuredClone(sdk.settings.get().values); settings.memory.enabled=true;
      await sdk.settings.update(settings,sdk.settings.get().revision);
      const job=await sdk.memory.index(p.id); assert.equal((await sdk.jobs.wait(job.id)).status,"completed");
      assert.ok((await sdk.memory.search(p.id,"portable sdk memory")).items.length>0);
      assert.ok((await sdk.mcp.tools("builtin","grep",0,s.id)).tools.some(t=>t.name==="grep_logs"));
      assert.equal((await sdk.voice.status()).voice.runtimeReady,true);
      assert.equal((await sdk.voice.status()).voice.modelReady,false);
    } finally {sdk.disconnect();await runtime.close();}
    console.log("External SDK import, strict consumer types, embedded runtime, vector retrieval and native MCP passed.");
  `);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit", timeout: 90_000 });
} finally { await rm(temporary, { recursive: true, force: true }); }
