import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("importing Node SDK discovery does not load the service, provider, MCP or PTY runtime", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import {registerHooks} from "node:module";
    const runtime=[];
    const hook=registerHooks({resolve(specifier,context,next){
      const result=next(specifier,context);
      if(/earendil-works|modelcontextprotocol|napi-rs.keyring|node-pty|pdfjs-dist|yauzl|\\/sax\\/|apps\\/service\\/src\\/server\\.ts/.test(result.url))runtime.push(result.url);
      return result;
    }});
    await import(${JSON.stringify(pathToFileURL(resolve("packages/sdk/src/node.ts")).href)});
    hook.deregister();console.log(JSON.stringify([...new Set(runtime)]));
  `], { encoding: "utf8", timeout: ciTime(10_000) });
  assert.deepEqual(JSON.parse(output), []);
});

test("the private PTY broker imports only its narrow protocol, never the whole public application schema", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import {registerHooks} from "node:module";
    const application=[];
    const hook=registerHooks({resolve(specifier,context,next){
      const result=next(specifier,context);
      if(result.url.endsWith("/packages/protocol/src/index.ts"))application.push(result.url);
      return result;
    }});
    await import(${JSON.stringify(pathToFileURL(resolve("apps/service/src/terminal-broker.ts")).href)});
    hook.deregister();console.log(JSON.stringify([...new Set(application)]));
  `], { encoding: "utf8", timeout: ciTime(10_000) });
  assert.deepEqual(JSON.parse(output), []);
});
