import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  ACP_AGENT_SPECS, acpAgentModelInfo, defaultAcpAgentSettings, MoguriError, PROTOCOL_VERSION,
  type AcpAgentModel, type AcpAgentSettings, type AcpHarness, type ModelOffering, type ModelProvider, type ToolCall,
} from "../../../packages/protocol/src/index.ts";
import { harnessEnvironment, resolveHarnessExecutable } from "./claude-agent.ts";
import { CodexAppServer, CodexRpcError, isJson } from "./codex-app-server.ts";

/** The stable Agent Client Protocol version Moguri speaks. */
export const ACP_PROTOCOL_VERSION = 1;
export const ACP_CLIENT_VERSION = `protocol-${PROTOCOL_VERSION}`;
export interface AcpAgentOptions {
  /** Absolute executable used instead of discovery. Generated fixtures use this; product users set it in Settings. */
  executable?: string;
  installLocations?: string[];
  workerPath?: string;
  environment?: NodeJS.ProcessEnv;
  probeTimeoutMs?: number;
}
export interface AcpAgentReadiness { executable: string; version: string; loadSession: boolean; models: AcpAgentModel[] }
/**
 * Proxy and certificate settings only. Ambient Google credentials (GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APPLICATION_CREDENTIALS,
 * GOOGLE_CLOUD_PROJECT, ...) never reach the agent, so it uses the account the user signed in to with the CLI itself.
 */
const passthrough = /^(?:NODE_EXTRA_CA_CERTS$|SSL_CERT_FILE$|HTTPS?_PROXY$|NO_PROXY$|https?_proxy$|no_proxy$)/;
export function acpAgentEnvironment(base: NodeJS.ProcessEnv, executable: string): Record<string, string> {
  // A Moguri-run agent prints sign-in links instead of opening a browser; Moguri never starts a sign-in.
  return { ...harnessEnvironment(base, executable, passthrough), NO_BROWSER: "true" };
}
export const defaultAcpInstallLocations = (harness: AcpHarness, home = homedir()) => {
  const command = ACP_AGENT_SPECS[harness].command;
  return [join(home, ".local", "bin", command), `/opt/homebrew/bin/${command}`, `/usr/local/bin/${command}`];
};
/** ACP's `auth_required` error, or an agent that says it needs a sign-in it cannot open here. */
export const acpAuthRequired = (error: unknown) => error instanceof CodexRpcError &&
  (error.code === -32000 || /auth|sign[ -]?in|log[ -]?in|credential|no browser is available/i.test(error.message));
const newer = (version: string, minimum: string) => {
  const parse = (value: string) => value.split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(version), parse(minimum)];
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! > b[index]!;
  return true;
};

export async function acpInitialize(server: CodexAppServer, clientVersion: string): Promise<{ version: string | null; loadSession: boolean }> {
  const result = await server.request("initialize", { protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "moguri", title: "Moguri", version: clientVersion } });
  if (!isJson(result)) throw new Error("The agent did not answer initialize.");
  if (typeof result.protocolVersion === "number" && result.protocolVersion !== ACP_PROTOCOL_VERSION) throw new Error(`The agent speaks ACP version ${result.protocolVersion}, not ${ACP_PROTOCOL_VERSION}.`);
  const info = isJson(result.agentInfo) ? result.agentInfo : null, capabilities = isJson(result.agentCapabilities) ? result.agentCapabilities : {};
  const version = info && typeof info.version === "string" && /^\d+\.\d+/.test(info.version) ? info.version.slice(0, 64) : null;
  return { version, loadSession: capabilities.loadSession === true };
}
/** Models an agent offers in its session setup: the `model` config option, or the legacy `models` block. */
export function acpModels(session: unknown): { models: AcpAgentModel[]; current: string | null } {
  if (!isJson(session)) return { models: [], current: null };
  const models: AcpAgentModel[] = [], seen = new Set<string>();
  const add = (id: unknown, name: unknown) => {
    if (typeof id !== "string" || !id || id.length > 256 || seen.has(id) || models.length >= 64) return;
    seen.add(id); models.push({ model: id, displayName: typeof name === "string" && name ? name.slice(0, 120) : id });
  };
  const option = (Array.isArray(session.configOptions) ? session.configOptions : []).find((entry) => isJson(entry) && (entry.category === "model" || entry.id === "model"));
  if (isJson(option) && Array.isArray(option.options)) {
    for (const entry of option.options) {
      if (isJson(entry) && Array.isArray(entry.options)) { for (const nested of entry.options) if (isJson(nested)) add(nested.value, nested.name); }
      else if (isJson(entry)) add(entry.value, entry.name);
    }
    return { models, current: typeof option.currentValue === "string" ? option.currentValue : null };
  }
  const legacy = isJson(session.models) ? session.models : null;
  for (const entry of legacy && Array.isArray(legacy.availableModels) ? legacy.availableModels : []) if (isJson(entry)) add(entry.modelId, entry.name);
  return { models, current: legacy && typeof legacy.currentModelId === "string" ? legacy.currentModelId : null };
}
export function stopServer(server: CodexAppServer, label: string): Promise<void> {
  const pid = server.child.pid;
  const kill = (signal: NodeJS.Signals) => {
    if (!pid) return;
    try { if (process.platform === "win32") server.child.kill(signal); else process.kill(-pid, signal); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) console.error(`${label} probe cleanup unconfirmed.`); }
  };
  server.close();
  if (server.child.exitCode !== null || server.child.signalCode !== null) { kill("SIGTERM"); return Promise.resolve(); }
  return new Promise((done) => {
    const term = setTimeout(() => kill("SIGTERM"), 1000), hard = setTimeout(() => { kill("SIGKILL"); done(); }, 2500);
    void server.exit.then(() => { clearTimeout(term); clearTimeout(hard); kill("SIGTERM"); done(); });
  });
}
/**
 * One bounded ACP session in an empty temporary directory: initialize, then session/new to learn the sign-in state and offered models.
 * It sends no prompt, calls no `authenticate` and starts no sign-in.
 */
export async function probeAcp(harness: AcpHarness, executable: string, environment: Record<string, string>, signal: AbortSignal, timeoutMs = 30_000):
  Promise<{ version: string | null; loadSession: boolean; signedIn: boolean; models: AcpAgentModel[] }> {
  signal.throwIfAborted();
  const spec = ACP_AGENT_SPECS[harness], cwd = await mkdtemp(join(tmpdir(), "moguri-acp-probe-"));
  const server = new CodexAppServer(CodexAppServer.spawnWith(executable, [...spec.args], cwd, environment), { label: spec.product, jsonrpc: true });
  server.onRequest = (request) => server.error(request.id, -32601, `Moguri does not serve ${request.method} during a status probe.`);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void stopServer(server, spec.product); }, timeoutMs);
  const abort = () => { void stopServer(server, spec.product); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const initialized = await acpInitialize(server, ACP_CLIENT_VERSION);
    let session: unknown;
    try { session = await server.request("session/new", { cwd, mcpServers: [] }); }
    catch (error) {
      if (acpAuthRequired(error)) return { ...initialized, signedIn: false, models: [] };
      throw error;
    }
    const offered = acpModels(session);
    return { ...initialized, signedIn: true, models: offered.models.length ? offered.models : [{ model: "", displayName: "Default model" }] };
  } catch (error) {
    if (timedOut || signal.aborted) throw new MoguriError(signal.aborted ? "acp_agent_cancelled" : "acp_agent_timeout", `The ${spec.product} status probe was stopped before it answered. No prompt was sent.`, 409);
    throw new MoguriError("acp_agent_probe", `\`${spec.command} ${spec.args.join(" ")}\` did not complete its status probe${error instanceof Error ? `: ${error.message.slice(0, 300)}` : ""}. Run \`${spec.command}\` in a terminal to check it.`, 503);
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort);
    await stopServer(server, spec.product);
    await rm(cwd, { recursive: true, force: true }).catch(() => console.error(`${spec.product} probe directory cleanup failed.`));
  }
}

export class AcpAgentProvider {
  onChange = () => {};
  readiness: AcpAgentReadiness | null = null;
  private status: ModelProvider["status"] = "disconnected";
  private diagnostic: string | null = null;
  private task?: Promise<void>;
  private abort = new AbortController();
  private signature: string;
  private closed = false;
  constructor(readonly id: AcpHarness, private readonly settings: () => AcpAgentSettings | undefined, private readonly options: AcpAgentOptions = {}) {
    this.signature = this.configurationSignature();
  }
  private get spec() { return ACP_AGENT_SPECS[this.id]; }
  get current(): AcpAgentSettings { return this.settings() ?? defaultAcpAgentSettings(); }
  get enabled(): boolean { return this.current.enabled; }
  get discovering(): boolean { return Boolean(this.task); }
  private configurationSignature() { return JSON.stringify(this.current); }
  provider(enabled: boolean): ModelProvider {
    return { id: this.id, name: this.spec.name, source: this.id, scope: "agent", endpointId: null, enabled: enabled && this.enabled, status: this.status, diagnostic: this.diagnostic };
  }
  offerings(enabled: boolean): ModelOffering[] {
    const available = enabled && this.enabled && this.status === "connected" && Boolean(this.readiness);
    return (this.readiness?.models ?? []).map((model) => ({ model: acpAgentModelInfo(this.id, model), available }));
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
    this.status = "connecting"; this.diagnostic = `Checking the installed ${this.spec.product}, its sign-in and models. No prompt or model call is running.`; this.readiness = null; this.onChange();
    const task = this.probe(combined).then((result) => {
      if (owned.aborted || this.closed) return;
      this.readiness = result.readiness; this.status = result.status; this.diagnostic = result.diagnostic;
    }, (error: unknown) => {
      if (owned.aborted || this.closed) return;
      this.readiness = null; this.status = "error";
      this.diagnostic = error instanceof MoguriError ? error.message : `${this.spec.product} status could not be read. Check the installation, then refresh. No prompt was sent.`;
      console.error(`${this.spec.name} probe failed:`, error instanceof MoguriError ? error.code : "acp_agent_probe");
    }).finally(() => { if (this.task === task) this.task = undefined; if (!this.closed) this.onChange(); });
    this.task = task;
    await task;
  }
  private async probe(signal: AbortSignal): Promise<{ readiness: AcpAgentReadiness | null; status: ModelProvider["status"]; diagnostic: string | null }> {
    const base = this.options.environment ?? process.env, spec = this.spec;
    const executable = await resolveHarnessExecutable(spec.command, this.options.executable ?? this.current.executablePath,
      this.options.installLocations ?? defaultAcpInstallLocations(this.id, base.HOME ?? homedir()), base);
    if (!executable) return { readiness: null, status: "disconnected", diagnostic: this.current.executablePath ?
      `The configured ${spec.product} executable is missing or not executable. Fix the path in Settings, then refresh.` :
      `${spec.product} was not found on PATH or its usual install locations. Install it from ${spec.install} or set its absolute path in Settings, then refresh.` };
    const result = await probeAcp(this.id, executable, acpAgentEnvironment(base, executable), signal, this.options.probeTimeoutMs);
    const version = result.version ?? "unknown";
    if (spec.minimumVersion && (!result.version || !newer(result.version, spec.minimumVersion))) {
      return { readiness: null, status: "error", diagnostic: `${spec.product} ${version} is older than ${spec.minimumVersion}, the first version Moguri supports over ACP. Update it, then refresh.` };
    }
    if (!result.signedIn) return { readiness: null, status: "disconnected",
      diagnostic: `${spec.product} ${version} is installed but not signed in. Run \`${spec.signIn}\` in your own terminal and sign in with Google's flow, then refresh. Moguri never collects or reads its credentials.` };
    return { readiness: { executable, version, loadSession: result.loadSession, models: result.models }, status: "connected", diagnostic: null };
  }
  ready(): AcpAgentReadiness & { environment: Record<string, string> } {
    if (!this.enabled) throw new MoguriError("acp_agent_disabled", `${this.spec.name} is off. Enable it in Settings; no other model was substituted.`, 409);
    if (!this.readiness || this.status !== "connected" || this.signature !== this.configurationSignature()) {
      throw new MoguriError("acp_agent_unavailable", this.diagnostic ?? `Refresh ${this.spec.name} before starting a turn. No other model was substituted.`, 409);
    }
    return { ...this.readiness, environment: acpAgentEnvironment(this.options.environment ?? process.env, this.readiness.executable) };
  }
  async close(): Promise<void> { this.closed = true; this.abort.abort(); await this.task?.catch(() => {}); }
}

/** ACP tool kinds as Moguri records them (the `kind` the agent reports, or `other`). */
const READ_KINDS = new Set(["read", "search", "think"]);
const EDIT_KINDS = new Set(["edit", "delete", "move"]);
const scope = (root: string, path: string) => relative(root, resolve(root, path)) || ".";
const locations = (call: ToolCall) => (Array.isArray(call.arguments.locations) ? call.arguments.locations : [])
  .flatMap((location) => isJson(location) && typeof location.path === "string" ? [location.path] : []);
const commandOf = (input: unknown): string | null => {
  if (!isJson(input)) return null;
  const command = input.command ?? input.cmd;
  if (typeof command === "string" && command) return command;
  return Array.isArray(command) && command.every((part) => typeof part === "string") && command.length ? command.join(" ") : null;
};
/** Policy subjects for one ACP tool call; an empty list means Moguri cannot evaluate it and must ask. */
export function acpPolicyCalls(call: ToolCall, root: string): ToolCall[] {
  const paths = locations(call), input = call.arguments.rawInput;
  switch (call.name) {
    case "read": return paths.map((path) => ({ id: call.id, name: "read_file", arguments: { path: scope(root, path) } }));
    case "search": return (paths.length ? paths : [root]).map((path) => ({ id: call.id, name: "find_files", arguments: { path: scope(root, path) } }));
    case "edit": case "delete": case "move": return paths.map((path) => ({ id: call.id, name: "write_file", arguments: { path: scope(root, path) } }));
    case "execute": { const command = commandOf(input); return command ? [{ id: call.id, name: "run_command", arguments: { command } }] : []; }
    case "fetch": return [{ id: call.id, name: "web_fetch", arguments: isJson(input) && typeof input.url === "string" ? { url: input.url } : {} }];
    default: return [{ id: call.id, name: `acp:${call.name}`, arguments: call.arguments }];
  }
}
/** Read policy subjects for a tool the agent ran without asking; null unless it is a read or search with disclosed paths. */
export function acpAutonomousReads(call: ToolCall, root: string): ToolCall[] | null {
  if (call.name === "think") return [];
  if (call.name !== "read" && call.name !== "search") return null;
  const subjects = acpPolicyCalls(call, root);
  return call.name === "read" && !subjects.length ? null : subjects;
}
export const acpEditTool = (name: string) => EDIT_KINDS.has(name);
export const acpReadOnlyTool = (name: string) => READ_KINDS.has(name);
export const acpCommand = (call: ToolCall) => call.name === "execute" ? commandOf(call.arguments.rawInput) : null;
