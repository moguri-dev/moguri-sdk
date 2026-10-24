import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import type { TerminalInput, TerminalState } from "../../../packages/protocol/src/index.ts";
import { stopGroup } from "./supervisor.ts";

export interface TerminalLaunchOptions { executable?: string; args?: string[] }
interface OwnedTerminal { state: TerminalState; pty: pty.IPty; output: string; baseOffset: number; stopping?: Promise<TerminalState>; done: Promise<void>; ended: () => void }
export class TerminalEngine {
  private owned = new Map<string, OwnedTerminal>();
  constructor(private readonly changed: (terminal: TerminalState) => void, private readonly options: TerminalLaunchOptions = {}) {}
  open(scope: { id?: string; sessionId: string | null; projectId: string | null; workspaceId?: string | null; root: string }, cols: number, rows: number, script?: { name: string; command: string }, options = this.options): TerminalState {
    if (scope.id && this.owned.has(scope.id)) throw new MoguriError("terminal_duplicate", "This terminal identity already owns a process. No replacement shell was started.", 409);
    if ([...this.owned.values()].filter((entry) => entry.state.status === "running").length >= 16 ||
      [...this.owned.values()].filter((entry) => entry.state.sessionId === scope.sessionId && entry.state.status === "running").length >= 4) throw new MoguriError("terminal_limit", "Close a running terminal first. At most four per session and sixteen overall are supported.");
    const shell = options.executable ?? process.env.SHELL ?? "/bin/sh";
    const args = script ? ["-lc", script.command] : options.args ?? ["-l"];
    const processPty = pty.spawn(shell, args, {
      cwd: scope.root, cols, rows, name: "xterm-256color",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? scope.root, TERM: "xterm-256color", LANG: "en_US.UTF-8" },
    });
    let ended!: () => void;
    const done = new Promise<void>((resolve) => { ended = resolve; });
    const state: TerminalState = { id: scope.id ?? randomUUID(), sessionId: scope.sessionId, projectId: scope.projectId, workspaceId: scope.workspaceId ?? null,
      title: script?.name ?? "Terminal", pid: processPty.pid, cols, rows, status: "running", diagnostic: null };
    const entry: OwnedTerminal = { state, pty: processPty, output: "", baseOffset: 0, done, ended };
    this.owned.set(state.id, entry);
    processPty.onData((data) => {
      if (!this.owned.has(state.id)) return;
      entry.output += data;
      const bytes = Buffer.from(entry.output);
      if (bytes.length > 128 * 1024) {
        let start = bytes.length - 128 * 1024;
        while ((bytes[start]! & 0xc0) === 0x80) start++;
        const tail = bytes.subarray(start).toString("utf8");
        entry.baseOffset += entry.output.length - tail.length; entry.output = tail;
      }
    });
    processPty.onExit(() => {
      entry.ended();
      if (this.owned.has(state.id) && !entry.stopping) void this.close(state.id).catch((error: unknown) => console.error("Terminal cleanup failed:", error instanceof Error ? error.message : "Unknown PTY error"));
    });
    this.changed(state);
    for (const old of [...this.owned.values()].filter((entry) => !["running", "stopping"].includes(entry.state.status)).slice(0, -32)) {
      old.baseOffset += old.output.length; old.output = ""; old.state.diagnostic = "The bounded output buffer expired. Terminal output is not durably stored.";
    }
    return { ...state };
  }
  input(request: TerminalInput): void {
    const terminal = this.get(request.terminalId);
    if (terminal.state.status !== "running") throw new MoguriError("terminal_closed", "This terminal is not running. No input was replayed.", 409);
    if (request.action === "input") terminal.pty.write(request.data);
    else { terminal.pty.resize(request.cols, request.rows); terminal.state.cols = request.cols; terminal.state.rows = request.rows; }
  }
  private get(id: string): OwnedTerminal {
    const terminal = this.owned.get(id);
    if (!terminal) throw new MoguriError("terminal_missing", "This terminal no longer exists or was not reattached after restart.", 404);
    return terminal;
  }
  info(id: string): TerminalState { return { ...this.get(id).state }; }
  forget(id: string): void {
    const terminal = this.get(id);
    if (["running", "starting", "reattaching", "stopping", "unconfirmed"].includes(terminal.state.status)) throw new MoguriError("terminal_unconfirmed", "Stop and confirm this terminal before forgetting its volatile buffer.", 409);
    terminal.output = ""; this.owned.delete(id);
  }
  read(id: string, offset: number, limit: number) {
    const terminal = this.get(id);
    const start = Math.max(0, offset - terminal.baseOffset);
    let end = Math.min(terminal.output.length, start + limit);
    const code = terminal.output.charCodeAt(end - 1);
    if (end < terminal.output.length && code >= 0xd800 && code <= 0xdbff) end += end - start === 1 ? 1 : -1;
    return { terminal: { ...terminal.state }, data: terminal.output.slice(start, end), baseOffset: terminal.baseOffset, nextOffset: terminal.baseOffset + end };
  }
  close(id: string): Promise<TerminalState> {
    const terminal = this.get(id);
    if (terminal.stopping) return terminal.stopping;
    terminal.state.status = "stopping"; this.changed({ ...terminal.state });
    terminal.stopping = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const clean = await stopGroup(terminal.pty.pid);
        await Promise.race([terminal.done, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); })]);
        terminal.state.status = clean ? "closed" : "unconfirmed";
        terminal.state.diagnostic = clean ? "Owned process group stopped. Detached or reparented descendants are not proven contained." : "Owned PTY cleanup is unconfirmed. Inspect its processes before removing the session.";
      } catch (error) {
        terminal.state.status = "unconfirmed";
        terminal.state.diagnostic = error instanceof Error ? error.message : "PTY cleanup failed.";
        console.error("Terminal cleanup unconfirmed:", terminal.state.diagnostic);
      } finally { clearTimeout(timer); }
      if (this.owned.has(id)) this.changed({ ...terminal.state });
      return { ...terminal.state };
    })();
    return terminal.stopping;
  }
  async closeAll(): Promise<void> {
    await Promise.all([...this.owned.keys()].map((id) => this.close(id)));
    this.owned.clear();
  }
}
