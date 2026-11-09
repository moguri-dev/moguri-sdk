import { ClientError } from "../../client/src/index.ts";
import { CheckpointCommandSchema, CheckpointQuerySchema, parse, type SlashResult } from "../../protocol/src/index.ts";
import type { MoguriSdk } from "./index.ts";

const json = (value: unknown): SlashResult => ({ kind: "text", text: JSON.stringify(value, null, 2) });
export async function checkpointSlash(sdk: MoguriSdk, sessionId: string, argument: string): Promise<SlashResult> {
  const [action = "list", id, value, extra] = argument.split(/\s+/).filter(Boolean);
  if (action === "list" && !value) return json(await sdk.query(parse(CheckpointQuerySchema, { type: "checkpoints.list", sessionId, offset: id === undefined ? 0 : Number(id), limit: 20 })));
  if (action === "read" && id && !value) return json(await sdk.checkpoints.read(sessionId, id));
  if (action === "preview" && id && (value === "conversation" || value === "workspace") && !extra) return json(await sdk.checkpoints.preview(sessionId, id, value));
  if (action === "settle" && id === "confirm-stop" && !value) return json(await sdk.checkpoints.settle(sessionId));
  if (action === "inspect" && id && !value) return json(await sdk.checkpoints.inspect(sessionId, id));
  if (action === "stop" && id && value === "confirm-stop" && !extra) return json(await sdk.checkpoints.stop(sessionId, id));
  const applied = argument.match(/^apply (\S+) (conversation|workspace) ([a-f0-9]{64}) confirm-rewind(?: ([\s\S]+))?$/);
  if (applied) return json(await sdk.command(parse(CheckpointCommandSchema, { type: "rewind.apply", sessionId, checkpointId: applied[1],
    mode: applied[2], expectedDigest: applied[3], decisions: JSON.parse(applied[4] ?? "[]"), confirm: true })));
  const acknowledged = argument.match(/^acknowledge (\S+) (\d+) ([a-f0-9]{64}) confirm-inspected$/);
  if (acknowledged) return json(await sdk.checkpoints.acknowledge(sessionId, acknowledged[1]!, Number(acknowledged[2]), acknowledged[3]!));
  const pruned = argument.match(/^prune (\S+) (\d+) confirm-delete$/);
  if (pruned) return json(await sdk.checkpoints.prune(sessionId, pruned[1]!, Number(pruned[2])));
  const capture = argument.match(/^prune-capture (\S+) (\d+) confirm-delete$/);
  if (capture) return json(await sdk.checkpoints.pruneCapture(sessionId, capture[1]!, Number(capture[2])));
  throw new ClientError("rewind_command", "Use /rewind list [OFFSET], read ID, preview ID conversation|workspace, settle confirm-stop, apply ID MODE PREVIEW_SHA confirm-rewind [FILE_DECISIONS_JSON], inspect ID, stop ID confirm-stop, acknowledge ID REV EFFECT_SHA confirm-inspected, prune ID REV confirm-delete, or prune-capture ID REV confirm-delete. No operation replays tools, replaces current policy or refunds spent/unknown budgets.");
}
