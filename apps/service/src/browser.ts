import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  MoguriError, browserUrl, validateBrowserArguments, type BrowserCommand, type BrowserQuery, type BrowserResponse,
  type BrowserRequest, type BrowserResult, type BrowserState, type Snapshot,
} from "../../../packages/protocol/src/index.ts";
import { assertWebAccess, type WebAccess } from "../../../packages/protocol/src/web-policy.ts";

interface Host {
  sessionId: string; hostId: string; lease: string; projectId: string | null; workspaceId: string | null;
  sequence: number; controlId: string | null; seen: number; url: string; title: string;
  permissionRevision: number;
  autonomy: string; automaticApprovals: boolean;
  pending?: { request: BrowserRequest; dispatched: boolean; settle(result: BrowserResult): void };
}
const failed = (text: string): BrowserResult => ({ text, outcome: "failed" });
export class BrowserBroker {
  private hosts = new Map<string, Host>();
  private closing = false;
  constructor(private snapshot: () => Snapshot, private readonly timeoutMs = 30_000, private readonly staleMs = 8_000) {}
  private session(id: string) {
    const snapshot = this.snapshot(), session = snapshot.sessions.find((session) => session.id === id && session.status !== "archived");
    if (!session) throw new MoguriError("browser_scope", "This browser session is outside the current profile.", 403);
    return { snapshot, session };
  }
  private usable(host: Host): boolean {
    const { snapshot, session } = this.session(host.sessionId);
    return !this.closing && session.controls.env === "Local" && snapshot.policy.allowedEnvs.includes("Local") &&
      session.projectId === host.projectId && session.workspaceId === host.workspaceId && Date.now() - host.seen <= this.staleMs;
  }
  private revoke(host: Host, reason: string): void {
    host.controlId = null;
    host.pending?.settle({ text: `${reason} No action was replayed. Inspect the page before retrying; website effects cannot be undone.`,
      outcome: host.pending.dispatched && !["browser_snapshot", "browser_status", "browser_wait", "browser_screenshot"].includes(host.pending.request.tool) ? "partial" : "cancelled" });
  }
  synchronize(): void {
    for (const host of this.hosts.values()) {
      const session = this.snapshot().sessions.find((session) => session.id === host.sessionId);
      if (!session || session.status === "archived" || session.controls.env !== "Local" ||
        !this.snapshot().policy.allowedEnvs.includes("Local") || session.projectId !== host.projectId || session.workspaceId !== host.workspaceId ||
        session.mode !== "agent" || session.pendingMode === "read-only" || session.kind !== "agent" || Date.now() - host.seen > this.staleMs ||
        host.permissionRevision !== this.snapshot().settings.permissionRevision || host.autonomy !== session.controls.autonomy ||
        host.automaticApprovals !== (session.controls.automaticApprovals === true)) {
        this.revoke(host, "Browser control was revoked by its current owner or policy.");
      }
    }
  }
  private owner(command: { sessionId: string; hostId: string; lease: string }): Host {
    const host = this.hosts.get(command.sessionId);
    if (!host || host.hostId !== command.hostId || host.lease.length !== command.lease.length ||
      !timingSafeEqual(Buffer.from(host.lease), Buffer.from(command.lease))) throw new MoguriError("browser_owner", "This native browser lease is missing or stale. No other page was adopted.", 409);
    return host;
  }
  command(command: BrowserCommand): void {
    if (command.type === "browser.host.attach") {
      if (this.closing) throw new MoguriError("browser_closed", "Browser admission is shutting down.", 409);
      const { snapshot, session } = this.session(command.sessionId);
      if (session.controls.env !== "Local" || !snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("browser_env", "Only an explicitly Local session can bind this native browser. No environment fallback.", 403);
      const previous = this.hosts.get(session.id);
      if (previous && Date.now() - previous.seen <= this.staleMs) throw new MoguriError("browser_attached", "This session already has an owned browser. No replacement was inferred.", 409);
      if (previous) this.revoke(previous, "The original browser host expired.");
      this.hosts.set(session.id, { ...command, projectId: session.projectId, workspaceId: session.workspaceId, sequence: 0,
        controlId: null, seen: Date.now(), url: "", title: "", permissionRevision: snapshot.settings.permissionRevision,
        autonomy: session.controls.autonomy, automaticApprovals: session.controls.automaticApprovals === true });
      return;
    }
    const host = this.owner(command);
    if (command.type === "browser.host.detach") {
      this.revoke(host, "The native browser was closed."); this.hosts.delete(host.sessionId); return;
    }
    if (command.type === "browser.host.reply") {
      if (Buffer.byteLength(command.result.text) > 16384) throw new MoguriError("browser_output", "The browser result exceeded 16 KiB.", 409);
      if (!host.pending || host.pending.request.id !== command.requestId) throw new MoguriError("browser_reply_stale", "This browser request already ended. No late result resumed it.", 409);
      if (command.result.deliveries && (host.pending.request.tool !== "browser_screenshot" || command.result.outcome !== "completed" ||
        command.result.deliveries.length !== 1 || command.result.deliveries[0]?.kind !== "image")) throw new MoguriError("browser_delivery", "Only the exact successful screenshot request may deliver image bytes. No forged page output was accepted.", 409);
      this.synchronize();
      if (!host.pending) throw new MoguriError("browser_reply_stale", "Browser authority ended before this result. No late result resumed it.", 409);
      host.pending.settle(command.result); return;
    }
    if (command.sequence <= host.sequence) throw new MoguriError("browser_control_stale", "A newer browser toggle already won. No old enable was restored.", 409);
    host.sequence = command.sequence;
    this.revoke(host, "The user changed browser control.");
    if (command.enabled) {
      const { session } = this.session(host.sessionId);
      if (!this.usable(host) || session.mode !== "agent" || session.pendingMode === "read-only" || session.kind !== "agent") throw new MoguriError("browser_denied", "This browser has no current Local agent authority. Control remains off.", 403);
      host.controlId = randomUUID();
      host.permissionRevision = this.snapshot().settings.permissionRevision;
      host.autonomy = session.controls.autonomy; host.automaticApprovals = session.controls.automaticApprovals === true;
    }
  }
  state(sessionId: string): BrowserState {
    this.session(sessionId); this.synchronize();
    const host = this.hosts.get(sessionId), available = Boolean(host && this.usable(host));
    return { available, controlId: available ? host!.controlId : null, url: available && host!.url ? host!.url : null, title: available ? host!.title : "",
      diagnostic: !available ? "Open this Local session's desktop Browser pane. No substitute browser was launched." :
        host!.controlId ? "Agent control is on. Scoped website policy and exact page ownership apply; page data is untrusted." : "Agent control is off. Enable the switch in the Browser pane to allow agent use." };
  }
  query(query: BrowserQuery): BrowserResponse {
    if (query.type === "browser.state") return { type: query.type, browser: this.state(query.sessionId) };
    const host = this.owner(query);
    if (Date.now() - host.seen > this.staleMs) this.revoke(host, "The native browser heartbeat expired.");
    host.seen = Date.now(); this.synchronize();
    if (query.url && query.url !== "about:blank") browserUrl(query.url);
    host.url = query.url; host.title = query.title;
    if (host.pending) host.pending.dispatched = true;
    return { type: query.type, controlId: host.controlId, request: host.pending?.request ?? null };
  }
  async call(sessionId: string, tool: string, args: Record<string, unknown>, signal: AbortSignal, webAccess?: WebAccess): Promise<BrowserResult> {
    signal.throwIfAborted();
    validateBrowserArguments(tool, args);
    const state = this.state(sessionId);
    if (tool === "browser_status") return { text: JSON.stringify({ ...state, ...(!state.controlId ? { url: null, title: "" } : {}) }), outcome: "completed" };
    if (!state.available || !state.controlId || args.controlId !== state.controlId) return failed("Browser control is off, unavailable or changed. Ask the user to enable Agent control, then use browser_status for its fresh controlId.");
    const host = this.hosts.get(sessionId)!;
    if (host.pending) return failed("Another browser action is still owned. Wait for its actual result; nothing was queued.");
    const target = String(tool === "browser_navigate" ? args.url : args.expectedUrl);
    if (target !== "about:blank") { browserUrl(target); assertWebAccess(webAccess, target); }
    if (!webAccess) return failed("This browser action has no original admitted website scope. Nothing was dispatched.");
    if (tool !== "browser_navigate" && host.url !== target) return failed("The browser page changed since its exact expectedUrl. Inspect the current status before requesting a new action.");
    return new Promise<BrowserResult>((resolve) => {
      const timer = setTimeout(() => this.cancelSession(sessionId, "The browser action timed out."), this.timeoutMs);
      const cancel = () => this.cancelSession(sessionId, "The owning browser action was cancelled.");
      host.pending = { request: { id: randomUUID(), controlId: state.controlId!, tool, arguments: args, webAccess }, dispatched: false,
        settle: (result) => {
          clearTimeout(timer); signal.removeEventListener("abort", cancel); host.pending = undefined; resolve(result);
        } };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  cancelSession(sessionId: string, reason = "The owning session stopped."): void {
    const host = this.hosts.get(sessionId);
    if (!host?.pending) return;
    const controlId = host.controlId;
    this.revoke(host, reason); host.controlId = controlId;
  }
  revokeSession(sessionId: string): void {
    const host = this.hosts.get(sessionId);
    if (host) this.revoke(host, "The owning session is closing.");
  }
  close(): void {
    this.closing = true;
    for (const host of this.hosts.values()) this.revoke(host, "The browser service shut down.");
    this.hosts.clear();
  }
}
