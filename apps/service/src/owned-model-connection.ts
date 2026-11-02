import { EventEmitter } from "node:events";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import type { ParentMessage, OwnedModelRequest, WorkerRequest } from "./worker-protocol.ts";
import type { WorkerConnection, WorkerConnectionEvents } from "./worker-connection.ts";

export class OwnedModelConnection implements WorkerConnection {
  readonly events = new EventEmitter<WorkerConnectionEvents>();
  private active = true;
  private started = false;
  private released = false;
  constructor(readonly ownerId: string, private readonly parentRequestId: string, private readonly parent: WorkerConnection,
    private readonly reply: (message: ParentMessage, callback?: (error: Error | null) => void) => void,
    private readonly request: (request: WorkerRequest) => Promise<void>, private readonly unsafe: () => void,
    private readonly release: () => void) {
    parent.events.on("exit", this.parentExit);
    parent.events.on("error", this.parentError);
  }
  get connected(): boolean { return this.active && this.parent.connected; }
  get roleReleased(): boolean { return this.released; }
  send(message: ParentMessage, callback?: (error: Error | null) => void): void {
    if (!this.connected) { callback?.(new Error("The original owned role transport ended.")); return; }
    if (message.kind === "start") {
      if (this.started || message.root !== null || !message.readOnly || message.context.length) {
        throw new MoguriError("owned_model_source", "Only one exact tool-less subcall may use this original transport. No source or model was replayed.", 409);
      }
      this.started = true;
      this.reply({ kind: "owned-model.start", ownerId: this.ownerId, parentRequestId: this.parentRequestId }, callback);
    } else if (message.kind === "reply") this.reply(message, callback);
    else if (message.kind === "stop" || message.kind === "control-lost") this.reply({ kind: "owned-model.stop", ownerId: this.ownerId }, callback);
    else throw new MoguriError("owned_model_source", "A private connection cannot send another parent, role or tool command.", 403);
  }
  kill(): void {
    if (!this.active) return;
    this.reply({ kind: "owned-model.stop", ownerId: this.ownerId });
    this.unsafe();
  }
  async receive(message: OwnedModelRequest): Promise<void> {
    if (!this.active || !this.started || message.ownerId !== this.ownerId) throw new MoguriError("owned_model_owner", "The exact private report/transport owner ended or changed. No result or work was adopted.", 409);
    if (message.kind === "owned-model.released") {
      this.released = true;
      this.close();
      this.events.emit("exit", message.outcome === "completed" ? 0 : 1, null);
      return;
    }
    if (message.kind === "owned-model.ack") return this.request({ kind: "ack" });
    if (message.kind === "owned-model.boundary") {
      return this.request({ kind: "boundary", requestId: message.requestId, stepId: message.stepId });
    }
    if (message.kind === "owned-model.complete") {
      const { ownerId: _, ...value } = message;
      return this.request({ ...value, kind: "model.complete" });
    }
    const { ownerId: _, ...value } = message;
    return this.request({ ...value, kind: "finished" });
  }
  private parentExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (!this.active) return;
    this.close(); this.events.emit("exit", code, signal);
  };
  private parentError = (error: Error) => { if (this.active) this.events.emit("error", error); };
  close(): void {
    if (!this.active) return;
    this.active = false;
    this.parent.events.off("exit", this.parentExit); this.parent.events.off("error", this.parentError);
    this.release();
  }
}
