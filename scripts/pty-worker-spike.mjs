import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as pty from "node-pty";

if (process.platform !== "darwin") throw new Error("This host PTY primitive is qualified on macOS; other platforms need their own native run.");
const started = performance.now(), payload = randomBytes(1024 * 1024).toString("base64");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const code = `
  const crypto=require("node:crypto");
  if(!process.stdin.isTTY)throw Error("Generated bridge requires its own controlling PTY");
  process.stdin.setRawMode(true);
  let input="";
  process.stdin.on("data",data=>{
    input+=data.toString("utf8");if(input.length>4*1024*1024)throw Error("Generated input exceeded its bound");
    const end=input.indexOf("\\n");if(end<0)return;
    const line=input.slice(0,end);if(!line.startsWith("MOGURI_PTY_V1:"))throw Error("Missing generated frame prefix");
    const message=JSON.parse(Buffer.from(line.slice(14),"base64").toString("utf8"));
    const result={bytes:Buffer.byteLength(message.payload),digest:crypto.createHash("sha256").update(message.payload).digest("hex")};
    process.stdout.write("MOGURI_PTY_V1:"+Buffer.from(JSON.stringify(result)).toString("base64")+"\\n",()=>process.exit(0));
  });
  process.stdin.pause();
  process.stdout.write("GENERATED_MOGURI_PTY_READY\\n");
  setTimeout(()=>process.stdin.resume(),150);
`;
const terminal = pty.spawn(process.execPath, ["-e", code], { cwd: process.cwd(), env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" }, cols: 80, rows: 24 });
let output = "", sent = false, result;
try {
  const exit = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Generated PTY worker roundtrip timed out; cleanup is not assumed.")), 10_000);
    terminal.onData((data) => {
      output += data;
      if (output.length > 64 * 1024) { clearTimeout(deadline); reject(new Error("Generated bridge output exceeded its bound or echoed private input.")); return; }
      if (!sent && output.includes("GENERATED_MOGURI_PTY_READY")) { sent = true; terminal.write(`MOGURI_PTY_V1:${Buffer.from(JSON.stringify({ payload })).toString("base64")}\n`); }
      for (const line of output.split(/\r?\n/)) if (line.startsWith("MOGURI_PTY_V1:")) {
        try { result = JSON.parse(Buffer.from(line.slice(14), "base64").toString("utf8")); }
        catch (error) { clearTimeout(deadline); reject(error); }
      }
    });
    terminal.onExit((value) => { clearTimeout(deadline); resolve(value); });
  });
  assert.equal(exit.exitCode, 0); assert.equal(exit.signal, 0);
  assert.equal(result?.bytes, Buffer.byteLength(payload)); assert.equal(result?.digest, hash(payload));
  assert.equal(output.includes(payload.slice(0, 100)), false);
  console.log(JSON.stringify({ status: "PASS", primitive: "Owned raw-PTY ASCII frame, delayed reader/backpressure and exact generated payload without echo", bytes: Buffer.byteLength(payload), ms: performance.now() - started, qualification: "Host primitive only, not native SendBox readiness or its guest input-credit proof." }, null, 2));
} catch (error) {
  try { process.kill(terminal.pid, "SIGTERM"); } catch (cleanup) { if (cleanup.code !== "ESRCH") console.error("Generated PTY cleanup unconfirmed:", cleanup.code); }
  console.error(error instanceof Error ? error.message : "PTY primitive failed."); process.exitCode = 1;
}
