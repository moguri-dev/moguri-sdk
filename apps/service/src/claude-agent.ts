import { spawn } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import {
  CLAUDE_AGENT_MODELS, CLAUDE_AGENT_PROVIDER_ID, claudeAgentModelInfo, defaultClaudeAgentSettings, isRecord, MoguriError,
  type AgentAuthMethod, type ClaudeAgentSettings, type ModelOffering, type ModelProvider, type ToolCall,
} from "../../../packages/protocol/src/index.ts";

export interface ClaudeAgentOptions {
  /** Absolute executable used instead of discovery. Generated fixtures use this; product users set it in Settings. */
  executable?: string;
  /** Absolute paths searched after PATH. Defaults to the documented Claude Code install locations. */
  installLocations?: string[];
  workerPath?: string;
  environment?: NodeJS.ProcessEnv;
  probeTimeoutMs?: number;
}
export interface ClaudeAgentReadiness { executable: string; version: string; authMethod: AgentAuthMethod }
export const MINIMUM_CLAUDE_CODE_VERSION = [2, 1, 0] as const;
const authMethods = new Set<AgentAuthMethod>(["none", "claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"]);
const passthrough = /^(?:ANTHROPIC_|CLAUDE_|AWS_|CLOUD_ML_|GOOGLE_|VERTEX_|AZURE_|BEDROCK_|DISABLE_|MAX_THINKING_TOKENS$|NODE_EXTRA_CA_CERTS$|SSL_CERT_FILE$|HTTPS?_PROXY$|NO_PROXY$|https?_proxy$|no_proxy$)/;
const basics = ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"];

export function defaultInstallLocations(home = homedir()): string[] {
  return [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
}
/** Only the user's own shell variables and the harness's documented auth/config variables reach it; Moguri's control-plane secrets never do. */
export function harnessEnvironment(base: NodeJS.ProcessEnv, executable: string, allowed: RegExp): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && (basics.includes(key) || allowed.test(key))) environment[key] = value;
  const directories = [resolve(executable, ".."), "/opt/homebrew/bin", "/usr/local/bin", join(base.HOME ?? homedir(), ".local", "bin"), ...(base.PATH ?? "/usr/bin:/bin").split(delimiter)];
  environment.PATH = [...new Set(directories.filter(Boolean))].join(delimiter);
  environment.HOME ??= homedir();
  delete environment.MOGURI_TOKEN;
  return environment;
}
export const claudeAgentEnvironment = (base: NodeJS.ProcessEnv, executable: string) => harnessEnvironment(base, executable, passthrough);
export async function executableFile(path: string): Promise<string | null> {
  try {
    await access(path, constants.X_OK);
    const canonical = await realpath(path);
    return (await stat(canonical)).isFile() ? canonical : null;
  } catch { return null; }
}
export async function resolveClaudeExecutable(settings: ClaudeAgentSettings, options: ClaudeAgentOptions = {}, environment: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  return resolveHarnessExecutable("claude", options.executable ?? settings.executablePath, options.installLocations ?? defaultInstallLocations(environment.HOME ?? homedir()), environment);
}
/** An explicit absolute path wins; otherwise PATH, then the harness's documented install locations. Never a shell lookup. */
export async function resolveHarnessExecutable(name: string, explicit: string | null | undefined, installLocations: string[], environment: NodeJS.ProcessEnv): Promise<string | null> {
  if (explicit) {
    if (!isAbsolute(explicit)) throw new MoguriError("agent_harness_path", "Set an absolute executable path. No relative or shell lookup was attempted.", 400);
    return executableFile(explicit);
  }
  const candidates = [...(environment.PATH ?? "").split(delimiter).filter((entry) => isAbsolute(entry)).map((entry) => join(entry, name)), ...installLocations];
  for (const candidate of candidates) {
    const found = await executableFile(candidate);
    if (found) return found;
  }
  return null;
}
export async function runClaudeProbe(executable: string, args: string[], environment: Record<string, string>, signal: AbortSignal, timeoutMs = 10_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  signal.throwIfAborted();
  const child = spawn(executable, args, { cwd: environment.HOME, env: environment, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", stopped = false;
  const kill = (name: NodeJS.Signals) => {
    if (!child.pid) return;
    try { if (process.platform === "win32") child.kill(name); else process.kill(-child.pid, name); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) console.error("Claude Code probe cleanup unconfirmed."); }
  };
  const stop = () => { if (stopped) return; stopped = true; kill("SIGTERM"); setTimeout(() => kill("SIGKILL"), 1500).unref(); };
  const timer = setTimeout(stop, timeoutMs);
  signal.addEventListener("abort", stop, { once: true });
  child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 64 * 1024) stdout += chunk.toString("utf8"); else stop(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
  try {
    const code = await new Promise<number | null>((resolveCode, reject) => {
      child.once("error", (error) => reject(new MoguriError("claude_agent_unavailable", `Claude Code could not start: ${error.message}.`, 503)));
      child.once("close", resolveCode);
    });
    if (stopped) throw new MoguriError(signal.aborted ? "claude_agent_cancelled" : "claude_agent_timeout", "The Claude Code status probe was stopped before it answered. No session was started.", 409);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
}
export function parseClaudeVersion(output: string): string | null {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}
export function supportedClaudeVersion(version: string): boolean {
  const parts = version.split(".").map(Number);
  for (const [index, minimum] of MINIMUM_CLAUDE_CODE_VERSION.entries()) {
    if ((parts[index] ?? 0) > minimum) return true;
    if ((parts[index] ?? 0) < minimum) return false;
  }
  return true;
}
/** Reads only the documented authMethod; account email, organization and tokens are never retained. */
export function parseAuthStatus(code: number | null, stdout: string): AgentAuthMethod {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { return code === 0 ? "unknown" : "none"; }
  const method = isRecord(value) && typeof value.authMethod === "string" && authMethods.has(value.authMethod as AgentAuthMethod) ? value.authMethod as AgentAuthMethod : code === 0 ? "unknown" : "none";
  return code === 0 ? method : "none";
}

export class ClaudeAgentProvider {
  readonly id = CLAUDE_AGENT_PROVIDER_ID;
  onChange = () => {};
  readiness: ClaudeAgentReadiness | null = null;
  private status: ModelProvider["status"] = "disconnected";
  private diagnostic: string | null = null;
  private task?: Promise<void>;
  private abort = new AbortController();
  private signature: string;
  private closed = false;
  constructor(private readonly settings: () => ClaudeAgentSettings | undefined, private readonly options: ClaudeAgentOptions = {}) {
    this.signature = this.configurationSignature();
  }
  get current(): ClaudeAgentSettings { return this.settings() ?? defaultClaudeAgentSettings(); }
  get enabled(): boolean { return this.current.enabled; }
  get discovering(): boolean { return Boolean(this.task); }
  private configurationSignature() { return JSON.stringify(this.current); }
  provider(enabled: boolean): ModelProvider {
    return { id: CLAUDE_AGENT_PROVIDER_ID, name: "Claude Agent", source: "claude-agent", scope: "agent", endpointId: null, enabled: enabled && this.enabled,
      status: this.status, diagnostic: this.diagnostic };
  }
  offerings(enabled: boolean): ModelOffering[] {
    const available = enabled && this.enabled && this.status === "connected" && Boolean(this.readiness);
    return CLAUDE_AGENT_MODELS.map((model) => ({ model: claudeAgentModelInfo(model.alias), available }));
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
    this.status = "connecting"; this.diagnostic = "Checking the installed Claude Code version and sign-in status. No session or model call is running."; this.readiness = null; this.onChange();
    const task = this.probe(combined).then((result) => {
      if (owned.aborted || this.closed) return;
      this.readiness = result.readiness; this.status = result.status; this.diagnostic = result.diagnostic;
    }, (error: unknown) => {
      if (owned.aborted || this.closed) return;
      this.readiness = null; this.status = "error";
      this.diagnostic = error instanceof MoguriError ? error.message : "Claude Code status could not be read. Check the installation, then refresh. No session was started.";
      console.error("Claude Agent probe failed:", error instanceof MoguriError ? error.code : "claude_agent_probe");
    }).finally(() => { if (this.task === task) this.task = undefined; if (!this.closed) this.onChange(); });
    this.task = task;
    await task;
  }
  private async probe(signal: AbortSignal): Promise<{ readiness: ClaudeAgentReadiness | null; status: ModelProvider["status"]; diagnostic: string | null }> {
    const base = this.options.environment ?? process.env, executable = await resolveClaudeExecutable(this.current, this.options, base);
    if (!executable) return { readiness: null, status: "disconnected", diagnostic: this.current.executablePath ?
      "The configured Claude Code executable is missing or not executable. Fix the path in Settings, then refresh." :
      "Claude Code was not found on PATH or its documented install locations. Install it from https://code.claude.com/docs/en/setup or set its absolute path in Settings, then refresh." };
    const environment = claudeAgentEnvironment(base, executable), timeout = this.options.probeTimeoutMs;
    const versionResult = await runClaudeProbe(executable, ["--version"], environment, signal, timeout);
    const version = versionResult.code === 0 ? parseClaudeVersion(versionResult.stdout) : null;
    if (!version) return { readiness: null, status: "error", diagnostic: "The executable did not report a Claude Code version. Point Settings at the official, unmodified Claude Code." };
    if (!supportedClaudeVersion(version)) return { readiness: null, status: "error", diagnostic: `Claude Code ${version} is older than the supported ${MINIMUM_CLAUDE_CODE_VERSION.join(".")}. Update it with its own installer, then refresh.` };
    const status = await runClaudeProbe(executable, ["auth", "status"], environment, signal, timeout);
    const authMethod = parseAuthStatus(status.code, status.stdout);
    if (authMethod === "none") return { readiness: null, status: "disconnected",
      diagnostic: `Claude Code ${version} is installed but not signed in. Run \`claude auth login\` in your own terminal (Anthropic's sign-in flow), then refresh. Moguri never collects Claude credentials.` };
    return { readiness: { executable, version, authMethod }, status: "connected", diagnostic: null };
  }
  /** The exact readiness captured for a launch; refresh must have completed against current settings. */
  ready(): ClaudeAgentReadiness & { environment: Record<string, string>; settings: ClaudeAgentSettings } {
    if (!this.enabled) throw new MoguriError("claude_agent_disabled", "Claude Agent is off. Enable it in Settings; no other model was substituted.", 409);
    if (!this.readiness || this.status !== "connected" || this.signature !== this.configurationSignature()) {
      throw new MoguriError("claude_agent_unavailable", this.diagnostic ?? "Refresh Claude Agent before starting a turn. No other model was substituted.", 409);
    }
    return { ...this.readiness, environment: claudeAgentEnvironment(this.options.environment ?? process.env, this.readiness.executable), settings: this.current };
  }
  async close(): Promise<void> { this.closed = true; this.abort.abort(); await this.task?.catch(() => {}); }
}

const readOnlyTools = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "TodoRead", "TaskOutput", "BashOutput", "ListMcpResourcesTool", "ReadMcpResourceTool"]);
const editTools = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
export const claudeReadOnlyTool = (name: string) => readOnlyTools.has(name);
const pathArgument = (input: Record<string, unknown>) => typeof input.file_path === "string" ? input.file_path :
  typeof input.notebook_path === "string" ? input.notebook_path : typeof input.path === "string" ? input.path : undefined;
/** Maps a Claude Code tool to the closest Moguri policy subject so existing hard denials, path scope and explicit delegations apply. */
export function claudePolicyCall(call: ToolCall, root: string): ToolCall {
  const input = call.arguments, path = pathArgument(input), scoped = path === undefined ? undefined : relative(root, resolve(root, path)) || ".";
  if (call.name === "Bash" && typeof input.command === "string") return { id: call.id, name: "run_command", arguments: { command: input.command } };
  if (editTools.has(call.name) && scoped !== undefined) return { id: call.id, name: "write_file", arguments: { path: scoped } };
  if (["Read", "NotebookRead"].includes(call.name) && scoped !== undefined) return { id: call.id, name: "read_file", arguments: { path: scoped } };
  if (["Glob", "Grep", "LS"].includes(call.name)) return { id: call.id, name: "find_files", arguments: scoped === undefined ? {} : { path: scoped } };
  if (["TodoWrite", "TodoRead"].includes(call.name)) return { id: call.id, name: "task_progress", arguments: {} };
  if (call.name === "WebFetch" && typeof input.url === "string") return { id: call.id, name: "web_fetch", arguments: { url: input.url } };
  if (call.name === "WebSearch") return { id: call.id, name: "web_search", arguments: {} };
  return { id: call.id, name: `claude:${call.name}`, arguments: input };
}
export const claudeEditTool = (name: string) => editTools.has(name);
