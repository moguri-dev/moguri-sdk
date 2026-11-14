import { resolve } from "node:path";
import { MoguriError, MAX_TEXT } from "../../../packages/protocol/src/core.ts";
import { SCRIPT_REVIEW_MAX_BYTES, type ScriptExecution } from "../../../packages/protocol/src/script-reviews.ts";
import { bytesDigest } from "./files.ts";
import { sourceRoot } from "./repository-source.ts";
import { boundedProgram } from "./lean-files.ts";
import type { DelegatedResult } from "./worker-protocol.ts";

const nodeRunner = String.raw`
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {registerHooks} from "node:module";
import {pathToFileURL} from "node:url";
const input=JSON.parse(readFileSync(3,"utf8"));
if(createHash("sha256").update(input.text).digest("hex")!==input.digest)throw new Error("Original script digest changed.");
const url=pathToFileURL(input.filename).href;
registerHooks({resolve(specifier,context,next){return specifier===url?{url,shortCircuit:true}:next(specifier,context);},load(specifier,context,next){return specifier===url?{format:(input.interpreter==="node-commonjs"?"commonjs":"module")+(/\.[cm]?ts$/.test(input.filename)?"-typescript":""),source:input.text,shortCircuit:true}:next(specifier,context);}});
process.argv=[process.execPath,input.filename,...input.args];
await import(url);
`;
const pythonRunner = String.raw`
import hashlib,json,os,sys
with os.fdopen(3,"r",encoding="utf-8") as source:
    data=json.load(source)
if hashlib.sha256(data["text"].encode("utf-8")).hexdigest()!=data["digest"]:
    raise RuntimeError("Original script digest changed.")
sys.argv=[data["filename"],*data["args"]]
sys.path.insert(0,os.path.dirname(data["filename"]))
exec(compile(data["text"],data["filename"],"exec"),{"__name__":"__main__","__file__":data["filename"],"__package__":None})
`;
const sentinelRunner = `
import {accessSync,constants,readFileSync,lstatSync,realpathSync} from "node:fs";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
const input=JSON.parse(readFileSync(3,"utf8"));
const root=realpathSync(process.cwd()),metadata=lstatSync(root,{bigint:true});
const rootDigest=createHash("sha256").update(JSON.stringify({root,device:String(metadata.dev),inode:String(metadata.ino)})).digest("hex");
if(rootDigest!==input.executionRootDigest||createHash("sha256").update(input.text).digest("hex")!==input.digest||process.ppid!==input.parentPid)throw new Error("Original script owner/source/root changed.");
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;try{process.kill(-process.pid,"SIGTERM");}catch(error){if(error.code!=="ESRCH")throw error;}setTimeout(()=>{try{process.kill(-process.pid,"SIGKILL");}catch(error){if(error.code!=="ESRCH")throw error;}},600);};
process.on("SIGTERM",stop);
process.stdin.once("end",stop);process.stdin.once("error",stop);process.stdin.resume();
const shell=input.interpreter==="sh"||input.interpreter==="bash";
// Linux cannot reopen libuv's socket as /dev/fd; the shell supplies a real anonymous pipe.
const linuxShell=shell&&process.platform==="linux";
if(linuxShell)accessSync("/bin/cat",constants.X_OK);
const executable=shell?"/bin/"+input.interpreter:input.interpreter==="python3"?"python3":process.execPath;
const args=shell?["-c",linuxShell?"/bin/cat <&3 | . /dev/fd/3 3<&0 </dev/null":". /dev/fd/3",input.filename,...input.args]:input.interpreter==="python3"?["-I","-c",${JSON.stringify(pythonRunner)}]:["--input-type=module","-e",${JSON.stringify(nodeRunner)}];
const child=spawn(executable,args,{stdio:["ignore","inherit","inherit","pipe"]});
child.stdio[3].on("error",error=>{if(error.code!=="EPIPE")stop();});
child.stdio[3].end(shell?input.text:JSON.stringify(input));
child.once("error",()=>{console.error("The exact selected script interpreter could not start; no fallback.");process.exitCode=1;});
child.once("close",(code,signal)=>{process.stdin.pause();process.exit(code??(signal?1:0));});
`;
export async function executeReviewedScript(root: string, execution: ScriptExecution, signal: AbortSignal, started: (pid: number) => void): Promise<DelegatedResult> {
  signal.throwIfAborted();
  const executionRootDigest = execution.native?.guestRootDigest ?? execution.rootDigest;
  if (Buffer.byteLength(execution.text) > SCRIPT_REVIEW_MAX_BYTES || bytesDigest(Buffer.from(execution.text)) !== execution.digest ||
    execution.native && execution.native.rootDigest !== execution.rootDigest ||
    bytesDigest(Buffer.from(JSON.stringify(await sourceRoot(root)))) !== executionRootDigest) {
    throw new MoguriError("script_execution_binding", "The complete script source or exact root digest changed before execution. No script was started.", 409);
  }
  const filename = resolve(root, execution.path), inputFd3 = JSON.stringify({ ...execution, filename, parentPid: process.pid, executionRootDigest });
  let dispatched = false;
  try {
    const result = await boundedProgram(root, process.execPath, ["--input-type=module", "-e", sentinelRunner], signal, { inputFd3, keepInputOpen: true, home: root, nativeProxy: Boolean(execution.native), rejectBackground: true,
      timeoutMs: 60_000, maxBytes: MAX_TEXT, started: (pid) => { dispatched = true; started(pid); } });
    const rawText = `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`;
    const partial = result.clipped || result.timedOut;
    return { text: JSON.stringify({ ...("reviewId" in execution ? { reviewId: execution.reviewId } : { repositoryTrust: execution.trust }), sourceDigest: execution.digest, interpreter: execution.interpreter,
      stdout: result.stdout.slice(0, 8000), stderr: result.stderr.slice(0, 3000), complete: !partial && result.stdout.length <= 8000 && result.stderr.length <= 3000,
      exitCode: result.exitCode, signal: result.signal, elapsedMs: result.elapsedMs, cleanup: "known-group-stopped",
      boundary: `${execution.native ? "Owned native guest process under the exact SendBox configuration; not the Local source checkout." : "Non-interactive Local user process; not OS isolation."} Exact source-bound bytes use a private pipe, never argv, a temporary script or a second download. Entrypoint authority is not a transitive-code audit.` }),
      rawText, rawComplete: !partial, ...(partial ? { cleanupConfirmed: true as const } : {}), isError: partial || result.exitCode !== 0 || result.signal !== null,
      outcome: partial ? "partial" : result.exitCode === 0 && result.signal === null ? "completed" : "failed" };
  } catch (error) {
    if (!dispatched) throw error;
    const code = signal.aborted ? "cancelled" : error instanceof MoguriError ? error.code : error instanceof Error && "code" in error ? String(error.code) : "script_result";
    console.error("Reviewed script dispatch is unconfirmed:", code);
    return { text: `Reviewed script execution is partial or unconfirmed (${code}). Inspect its original effects and owned process result before retrying. No rollback or complete cancellation was inferred.`,
      isError: true, outcome: "partial" };
  }
}
