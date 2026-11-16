import { relative, resolve, join } from "node:path";
import { homedir } from "node:os";
import {
  CODEX_AGENT_PROVIDER_ID, codexAgentModelInfo, defaultCodexAgentSettings, MoguriError, PROTOCOL_VERSION,
  type AgentAuthMethod, type CodexAgentModel, type CodexAgentSettings, type ModelOffering, type ModelProvider, type ToolCall,
} from "../../../packages/protocol/src/index.ts";
import { harnessEnvironment, resolveHarnessExecutable } from "./claude-agent.ts";
import { CodexAppServer, isJson, parseCodexVersion } from "./codex-app-server.ts";

export interface CodexAgentOptions {
  /** Absolute executable used instead of discovery. Generated fixtures use this; product users set it in Settings. */
  executable?: string;
  installLocations?: string[];
  workerPath?: string;
  environment?: NodeJS.ProcessEnv;
  probeTimeoutMs?: number;
}
export interface CodexAgentReadiness { executable: string; version: string; authMethod: AgentAuthMethod; models: CodexAgentModel[] }
export const CODEX_CLIENT_VERSION = `protocol-${PROTOCOL_VERSION}`;
const passthrough = /^(?:CODEX_|OPENAI_|AZURE_OPENAI_|NODE_EXTRA_CA_CERTS$|SSL_CERT_FILE$|HTTPS?_PROXY$|NO_PROXY$|https?_proxy$|no_proxy$|RUST_LOG$)/;
export const codexAgentEnvironment = (base: NodeJS.ProcessEnv, executable: string) => harnessEnvironment(base, executable, passthrough);
export const defaultCodexInstallLocations = (home = homedir()) => [join(home, ".local", "bin", "codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];

function stopGroup(server: CodexAppServer): Promise<void> {
  const pid = server.child.pid;
  const kill = (signal: NodeJS.Signals) => {
    if (!pid) return;
    try { if (process.platform === "win32") server.child.kill(signal); else process.kill(-pid, signal); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) console.error("Codex probe cleanup unconfirmed."); }
  };
  server.close();
  const exited = server.child.exitCode !== null || server.child.signalCode !== null;
  if (exited) { kill("SIGTERM"); return Promise.resolve(); }
  return new Promise((done) => {
    const term = setTimeout(() => kill("SIGTERM"), 1000), hard = setTimeout(() => { kill("SIGKILL"); done(); }, 2500);
    void server.exit.then(() => { clearTimeout(term); clearTimeout(hard); kill("SIGTERM"); done(); });
  });
}
/** Maps `account/read`; Moguri keeps only the login kind, never the account email, plan or tokens. */
export function codexAuthMethod(result: unknown): AgentAuthMethod {
  if (!isJson(result)) return "none";
  const account = isJson(result.account) ? result.account : null;
  if (!account) return result.requiresOpenaiAuth === false ? "third_party" : "none";
  return account.type === "chatgpt" ? "chatgpt" : account.type === "apiKey" ? "api_key" : "third_party";
}
export function codexModels(pages: unknown[]): CodexAgentModel[] {
  const models: CodexAgentModel[] = [], seen = new Set<string>();
  for (const page of pages) for (const entry of isJson(page) && Array.isArray(page.data) ? page.data : []) {
    if (!isJson(entry) || entry.hidden === true || typeof entry.model !== "string" || !entry.model || entry.model.length > 256 || seen.has(entry.model)) continue;
    seen.add(entry.model);
    models.push({ model: entry.model, displayName: typeof entry.displayName === "string" && entry.displayName ? entry.displayName.slice(0, 120) : entry.model,
      imageInput: Array.isArray(entry.inputModalities) && entry.inputModalities.includes("image"), isDefault: entry.isDefault === true });
  }
  return models.slice(0, 64);
}
/** One bounded app-server session: initialize, account/read and paginated model/list. No thread or model call is made. */
export async function probeCodex(executable: string, environment: Record<string, string>, signal: AbortSignal, timeoutMs = 15_000):
  Promise<{ version: string | null; authMethod: AgentAuthMethod; models: CodexAgentModel[] }> {
  signal.throwIfAborted();
  const server = CodexAppServer.spawn(executable, environment.HOME ?? homedir(), environment);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void stopGroup(server); }, timeoutMs);
  const abort = () => { void stopGroup(server); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const version = parseCodexVersion(await server.initialize(CODEX_CLIENT_VERSION));
    const authMethod = codexAuthMethod(await server.request("account/read", {}));
    if (authMethod === "none") return { version, authMethod, models: [] };
    const pages: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page = await server.request("model/list", cursor ? { cursor } : {});
      pages.push(page);
      cursor = isJson(page) && typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
    } while (cursor && pages.length < 10);
    return { version, authMethod, models: codexModels(pages) };
  } catch (error) {
    if (timedOut || signal.aborted) throw new MoguriError(signal.aborted ? "codex_agent_cancelled" : "codex_agent_timeout", "The Codex status probe was stopped before it answered. No thread was started.", 409);
    throw new MoguriError("codex_agent_probe", `Codex app-server did not complete its status probe${error instanceof Error ? `: ${error.message.slice(0, 300)}` : ""}. Run \`codex\` in a terminal to check it.`, 503);
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort);
    await stopGroup(server);
  }
}

export class CodexAgentProvider {
  readonly id = CODEX_AGENT_PROVIDER_ID;
  onChange = () => {};
  readiness: CodexAgentReadiness | null = null;
  private status: ModelProvider["status"] = "disconnected";
  private diagnostic: string | null = null;
  private task?: Promise<void>;
  private abort = new AbortController();
  private signature: string;
  private closed = false;
  constructor(private readonly settings: () => CodexAgentSettings | undefined, private readonly options: CodexAgentOptions = {}) {
    this.signature = this.configurationSignature();
  }
  get current(): CodexAgentSettings { return this.settings() ?? defaultCodexAgentSettings(); }
  get enabled(): boolean { return this.current.enabled; }
  get discovering(): boolean { return Boolean(this.task); }
  private configurationSignature() { return JSON.stringify(this.current); }
  provider(enabled: boolean): ModelProvider {
    return { id: CODEX_AGENT_PROVIDER_ID, name: "Codex Agent", source: "codex-agent", scope: "agent", endpointId: null, enabled: enabled && this.enabled,
      status: this.status, diagnostic: this.diagnostic };
  }
  offerings(enabled: boolean): ModelOffering[] {
    const available = enabled && this.enabled && this.status === "connected" && Boolean(this.readiness);
    return (this.readiness?.models ?? []).map((model) => ({ model: codexAgentModelInfo(model), available }));
  }
  synchronize(): void {
    const signature = this.configurationSignature();
    if (signature === this.signature || this.closed) return;
    this.signature = signature;
    void this.refresh().catch(() => {});
  }
  async refresh(signal?: AbortSignal): Promise<void> {
    if (this.closed) return;
    this.abort.abort(); this.abort = new AbortController();
    const owned = this.abort.signal, combined = signal ? AbortSignal.any([signal, owned]) : owned;
    if (!this.enabled) { this.readiness = null; this.status = "disconnected"; this.diagnostic = null; this.onChange(); return; }
    this.status = "connecting"; this.diagnostic = "Checking the installed Codex version, sign-in and models. No thread or model call is running."; this.readiness = null; this.onChange();
    const task = this.probe(combined).then((result) => {
      if (owned.aborted || this.closed) return;
      this.readiness = result.readiness; this.status = result.status; this.diagnostic = result.diagnostic;
    }, (error: unknown) => {
      if (owned.aborted || this.closed) return;
      this.readiness = null; this.status = "error";
      this.diagnostic = error instanceof MoguriError ? error.message : "Codex status could not be read. Check the installation, then refresh. No thread was started.";
      console.error("Codex Agent probe failed:", error instanceof MoguriError ? error.code : "codex_agent_probe");
    }).finally(() => { if (this.task === task) this.task = undefined; if (!this.closed) this.onChange(); });
    this.task = task;
    await task;
  }
  private async probe(signal: AbortSignal): Promise<{ readiness: CodexAgentReadiness | null; status: ModelProvider["status"]; diagnostic: string | null }> {
    const base = this.options.environment ?? process.env;
    const executable = await resolveHarnessExecutable("codex", this.options.executable ?? this.current.executablePath,
      this.options.installLocations ?? defaultCodexInstallLocations(base.HOME ?? homedir()), base);
    if (!executable) return { readiness: null, status: "disconnected", diagnostic: this.current.executablePath ?
      "The configured Codex executable is missing or not executable. Fix the path in Settings, then refresh." :
      "Codex was not found on PATH or its usual install locations. Install it from https://developers.openai.com/codex/cli or set its absolute path in Settings, then refresh." };
    const result = await probeCodex(executable, codexAgentEnvironment(base, executable), signal, this.options.probeTimeoutMs);
    if (!result.version) return { readiness: null, status: "error", diagnostic: "The executable did not report a Codex version from `codex app-server`. Point Settings at the official Codex CLI." };
    if (result.authMethod === "none") return { readiness: null, status: "disconnected",
      diagnostic: `Codex ${result.version} is installed but not signed in. Run \`codex login\` in your own terminal (OpenAI's sign-in flow), then refresh. Moguri never collects Codex credentials.` };
    if (!result.models.length) return { readiness: null, status: "error", diagnostic: `Codex ${result.version} listed no available models for this login. Check \`codex\` in a terminal, then refresh.` };
    return { readiness: { executable, version: result.version, authMethod: result.authMethod, models: result.models }, status: "connected", diagnostic: null };
  }
  ready(): CodexAgentReadiness & { environment: Record<string, string> } {
    if (!this.enabled) throw new MoguriError("codex_agent_disabled", "Codex Agent is off. Enable it in Settings; no other model was substituted.", 409);
    if (!this.readiness || this.status !== "connected" || this.signature !== this.configurationSignature()) {
      throw new MoguriError("codex_agent_unavailable", this.diagnostic ?? "Refresh Codex Agent before starting a turn. No other model was substituted.", 409);
    }
    return { ...this.readiness, environment: codexAgentEnvironment(this.options.environment ?? process.env, this.readiness.executable) };
  }
  async close(): Promise<void> { this.closed = true; this.abort.abort(); await this.task?.catch(() => {}); }
}

/** Codex tool names as Moguri records them. */
export const CODEX_TOOLS = { command: "command", fileChange: "file_change", webSearch: "web_search" } as const;
const scope = (root: string, path: string) => relative(root, resolve(root, path)) || ".";
/** Policy subjects for one Codex tool; an empty list means Moguri cannot evaluate it and must ask. */
export function codexPolicyCalls(call: ToolCall, root: string): ToolCall[] {
  const input = call.arguments;
  if (call.name === CODEX_TOOLS.command && typeof input.command === "string") return [{ id: call.id, name: "run_command", arguments: { command: input.command } }];
  if (call.name === CODEX_TOOLS.fileChange) {
    const changes = Array.isArray(input.changes) ? input.changes : [];
    if (input.truncated === true || changes.some((change) => !isJson(change) || typeof change.path !== "string")) return [];
    // A rename writes both its source and its destination.
    return changes.flatMap((change) => isJson(change) ? [change.path, change.movePath].filter((path): path is string => typeof path === "string")
      .map((path) => ({ id: call.id, name: "write_file", arguments: { path: scope(root, path) } })) : []);
  }
  if (call.name === CODEX_TOOLS.webSearch) return [{ id: call.id, name: "web_search", arguments: {} }];
  return [{ id: call.id, name: `codex:${call.name}`, arguments: input }];
}
/** Read policy subjects for a command Codex ran without asking; null when any part is not a recognized read. */
export function codexAutonomousReads(call: ToolCall, root: string): ToolCall[] | null {
  const actions = Array.isArray(call.arguments.actions) ? call.arguments.actions : [];
  const cwd = typeof call.arguments.cwd === "string" ? call.arguments.cwd : root;
  if (call.name !== CODEX_TOOLS.command || !actions.length || call.arguments.truncated === true) return null;
  const reads: ToolCall[] = [];
  for (const action of actions) {
    if (!isJson(action) || !["read", "listFiles", "search"].includes(String(action.type))) return null;
    const path = scope(root, resolve(cwd, typeof action.path === "string" && action.path ? action.path : "."));
    reads.push({ id: call.id, name: action.type === "read" ? "read_file" : action.type === "listFiles" ? "list_files" : "find_files", arguments: { path } });
  }
  return reads;
}
export const codexEditTool = (name: string) => name === CODEX_TOOLS.fileChange;
/** In read-only sessions every Codex approval is denied; reads it ran without asking are reconciled after the fact. */
export const codexReadOnlyTool = (_name: string) => false;
