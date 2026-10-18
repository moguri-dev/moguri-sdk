import { Type, type Tool } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { MAX_TEXT, MoguriError, type ToolCall } from "../../../packages/protocol/src/index.ts";
import { listProjectFiles, readProjectFile, writeProjectFile } from "./files.ts";
import { runCommand } from "./supervisor.ts";

const path = Type.String({ minLength: 1, maxLength: 4096 });
export const tools: Tool[] = [
  { name: "list_files", description: "List one project directory. Protected paths and symlinks are excluded. Requires human approval.", parameters: Type.Object({ path }, { additionalProperties: false }) },
  { name: "read_file", description: "Read an approved project UTF-8 file up to 128 KiB. Returns its digest for conflict-safe writes. Requires human approval.", parameters: Type.Object({ path }, { additionalProperties: false }) },
  { name: "write_file", description: "Write a complete project text file. expectedDigest must be the digest returned by read_file, or 'absent' for a new file. Requires human approval.", parameters: Type.Object({ path, text: Type.String({ maxLength: MAX_TEXT }), expectedDigest: Type.String({ pattern: "^(absent|[a-f0-9]{64})$" }) }, { additionalProperties: false }) },
  { name: "run_command", description: "Run an exact shell command in the approved project on the Local host, without sandbox isolation. Always requires human approval, including Git writes. No automatic backgrounding. Output is bounded; timeout cancels the owned process group.", parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 16_384 }), timeoutMs: Type.Integer({ minimum: 1000, maximum: 600_000 }) }, { additionalProperties: false }) },
];
export function validateTool(call: ToolCall): void {
  const tool = tools.find((tool) => tool.name === call.name);
  if (!tool || !Value.Check(tool.parameters, call.arguments)) throw new MoguriError("invalid_tool", "Unknown tool or invalid arguments. No operation was executed.");
}
export async function executeTool(root: string, call: ToolCall, signal: AbortSignal, output: (text: string) => void, started: (pid: number) => void): Promise<{ text: string; isError: boolean; outcome: string }> {
  signal.throwIfAborted();
  validateTool(call);
  const args = call.arguments;
  switch (call.name) {
    case "list_files": return { text: JSON.stringify(await listProjectFiles(root, String(args.path))), isError: false, outcome: "completed" };
    case "read_file": return { text: JSON.stringify(await readProjectFile(root, String(args.path))), isError: false, outcome: "completed" };
    case "write_file": {
      signal.throwIfAborted();
      const hash = await writeProjectFile(root, String(args.path), String(args.text), String(args.expectedDigest));
      return { text: `File written. sha256=${hash}`, isError: false, outcome: "completed" };
    }
    case "run_command": return runCommand(root, String(args.command), Number(args.timeoutMs), signal, output, started);
    default: throw new MoguriError("invalid_tool", "Unsupported tool. No operation was executed.");
  }
}
