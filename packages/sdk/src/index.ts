import { MoguriClient as TransportClient, ClientError } from "../../client/src/index.ts";
import { isRecord, QuerySchema, parse, type PlatformQuery, type PlatformResponse, type SettingsSection, type UserSettings, type CapabilityJob } from "../../protocol/src/index.ts";

export * from "../../protocol/src/index.ts";
export * from "./brand.ts";
export { ClientError };
export { DraftEditor } from "../../client/src/draft.ts";
export type { ClientState } from "../../client/src/index.ts";

export class MoguriSdk extends TransportClient {
  async query<Q extends PlatformQuery>(query: Q): Promise<Extract<PlatformResponse, { type: Q["type"] }>> {
    parse(QuerySchema, query);
    const result = await this.request("/v1/query", query);
    if (!isRecord(result) || result.type !== query.type) throw new ClientError("invalid_response", "The service returned an incompatible capability response.");
    return result as Extract<PlatformResponse, { type: Q["type"] }>;
  }
  readonly settings = {
    get: () => this.getState().snapshot?.settings ?? null,
    update: (settings: UserSettings, expectedRevision: number, acknowledgePromptRisk = false) =>
      this.command({ type: "settings.update", settings, expectedRevision, acknowledgePromptRisk }),
    reset: (section: SettingsSection | "all", expectedRevision: number) =>
      this.command({ type: "settings.reset", section, expectedRevision }),
  };
  readonly prompt = {
    preview: (sessionId?: string) => this.query({ type: "prompt.preview", ...(sessionId ? { sessionId } : {}) }),
    set: (text: string, expectedRevision: number, acknowledgeRisk: boolean) => {
      const values = this.getState().snapshot?.settings.values;
      if (!values) throw new ClientError("disconnected", "Connect before editing the system prompt.");
      return this.settings.update({ ...values, systemPrompt: text }, expectedRevision, acknowledgeRisk);
    },
    reset: (expectedRevision: number) => this.settings.reset("systemPrompt", expectedRevision),
  };
  readonly memory = {
    index: (projectId: string) => this.command({ type: "memory.index", projectId }),
    search: (projectId: string, text: string, limit = 6) => this.query({ type: "memory.search", projectId, text, limit }),
    graph: (projectId: string, path = "") => this.query({ type: "memory.graph", projectId, path }),
    remember: (projectId: string, text: string) => this.command({ type: "memory.remember", projectId, text }),
  };
  readonly capabilities = {
    content: (capabilityId: string) => this.query({ type: "capability.content", capabilityId }),
    toggle: (capabilityId: string, enabled: boolean, expectedRevision: number) => this.command({ type: "capability.toggle", capabilityId, enabled, expectedRevision }),
    importSkill: (projectId: string, path: string) => this.command({ type: "skill.import", projectId, path }),
    importPlugin: (projectId: string, path: string) => this.command({ type: "plugin.import", projectId, path }),
    propose: (projectId: string, kind: "skill" | "script" | "memory", name: string, content: string) => this.command({ type: "proposal.create", projectId, kind, name, content }),
    proposal: (proposalId: string) => this.query({ type: "proposal.content", proposalId }),
    decide: (proposalId: string, approve: boolean, expectedDigest: string) => this.command({ type: "proposal.decide", proposalId, approve, expectedDigest }),
  };
  readonly mcp = {
    tools: (serverId = "builtin", query = "", offset = 0, sessionId?: string) => this.query({ type: "mcp.tools", serverId, query, offset, ...(sessionId ? { sessionId } : {}) }),
    auth: (serverId: string) => this.query({ type: "mcp.auth", serverId }),
    setToken: (serverId: string, token: string) => this.command({ type: "mcp.token.set", serverId, token }),
    clearToken: (serverId: string) => this.command({ type: "mcp.token.clear", serverId }),
    call: (sessionId: string, serverId: string, tool: string, args: Record<string, unknown>, schemaDigest: string) => this.command({ type: "mcp.call", sessionId, serverId, tool, arguments: args, schemaDigest }),
    readResult: (resultId: string, offset = 0, limit = 12000) => this.query({ type: "result.read", resultId, offset, limit }),
  };
  readonly voice = {
    status: () => this.query({ type: "voice.status" }),
    download: (acceptLicense: true) => this.command({ type: "voice.download", acceptLicense }),
    record: (sessionId: string) => this.command({ type: "voice.record", sessionId }),
    transcribe: (sessionId: string, path: string) => this.command({ type: "voice.transcribe", sessionId, path }),
    stop: (jobId: string) => this.command({ type: "voice.stop", jobId }),
    insert: (sessionId: string, jobId: string, expectedRevision: number) => this.command({ type: "voice.insert", sessionId, jobId, expectedRevision }),
  };
  readonly subagents = { run: (sessionId: string, prompt: string) => this.command({ type: "subagent.run", sessionId, prompt }) };
  readonly sandbox = { status: () => this.query({ type: "sandbox.status" }) };
  readonly jobs = {
    cancel: (jobId: string) => this.command({ type: "job.cancel", jobId }),
    wait: async (jobId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CapabilityJob> => {
      const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const job = this.getState().snapshot?.jobs.find((job) => job.id === jobId);
        if (job && !["running", "waiting_input"].includes(job.status)) return job;
        if (this.getState().status !== "connected") throw new ClientError("disconnected", "The capability is retained by the service. Reconnect before waiting again; it was not retried.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new ClientError("job_wait_timeout", "The wait timed out. The service still owns this job; inspect it or explicitly cancel it.");
    },
  };
  async ready(timeoutMs = 10_000): Promise<this> {
    await this.connect();
    const deadline = Date.now() + timeoutMs;
    while (this.getState().status !== "connected" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.getState().status !== "connected") { this.disconnect(); throw new ClientError("connection_timeout", "Moguri protocol negotiation did not complete."); }
    return this;
  }
}
export { MoguriSdk as MoguriClient };
