import { isAbsolute } from "node:path";
import { MoguriError, parse, SandboxConfigurationSchema, type SandboxConfiguration, type SandboxQualification } from "../../../packages/protocol/src/index.ts";
import { canonicalNetworkHostname } from "./public-network.ts";

export type QualifiedSandboxConfiguration = SandboxConfiguration & {
  image: string; bundlePath: string; trustRootPath: string; qualification: SandboxQualification;
};
export function canonicalSandboxDomainRule(value: string): boolean {
  return value.length <= 253 && canonicalNetworkHostname(value.startsWith("*.") ? value.slice(2) : value);
}
export function sandboxConfiguration(value: SandboxConfiguration): QualifiedSandboxConfiguration {
  const config = structuredClone(parse(SandboxConfigurationSchema, value));
  if (!config.qualification || !config.image || !config.bundlePath || !config.trustRootPath) throw new MoguriError("sandbox_setup", "Explicitly configure and review exact SendBox release/image qualification before native execution. No Local fallback.", 409);
  if (config.configPath !== null) throw new MoguriError("sandbox_policy", "Legacy external policies are not silently reused or replaced. Select the managed deny-by-default native policy explicitly, with configPath null and reviewed domain rules.", 409);
  for (const path of [config.executable, config.bundlePath, config.trustRootPath]) {
    if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new MoguriError("sandbox_path", "Select canonical absolute installed release artifacts explicitly; no PATH or previous-installation fallback.", 409);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]*@sha256:[a-f0-9]{64}$/.test(config.image)) throw new MoguriError("sandbox_image", "Native execution requires one exact digest-pinned workload image, not a mutable tag.", 409);
  if (config.qualification.allowedDomains.some((host) => !canonicalSandboxDomainRule(host))) throw new MoguriError("sandbox_domains", "Review canonical DNS hosts or explicit *.domain.com tool rules. Bare wildcards, IP/private-address grants, ports and URLs are not allowed.", 409);
  return { ...config, image: config.image, bundlePath: config.bundlePath, trustRootPath: config.trustRootPath, qualification: config.qualification };
}
export function sandboxProviderDestination(value: SandboxConfiguration, baseUrl: string): URL {
  const config = sandboxConfiguration(value);
  if (!config.qualification.allowCopilot) throw new MoguriError("sandbox_provider_scope", "Explicitly approve scoped Copilot request access in the reviewed native policy. No credential or provider was substituted.", 403);
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new MoguriError("sandbox_provider_scope", "The exact prepared provider resource is not a valid HTTPS URL.", 409); }
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || url.search || url.hash ||
    !config.qualification.allowedDomains.includes(url.hostname)) throw new MoguriError("sandbox_provider_scope", "The exact prepared provider HTTPS resource is outside the approved native host scope or contains credentials. No fallback or policy broadening.", 403);
  return url;
}
export function sandboxRunConfiguration(value: SandboxConfiguration, name: string, workspace: string, command: string[]) {
  const config = sandboxConfiguration(value), policy = config.qualification;
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name) || !isAbsolute(workspace) || /[\0\r\n]/.test(workspace) ||
    command.length < 3 || command.length > 8 || command[0] !== "/usr/local/bin/node" ||
    command.at(-2) !== "/opt/moguri/dist/remote-bridge.mjs" || command.at(-1) !== "--foreground" ||
    command.some((part) => !part || part.length > 4096 || /[\s\0]/.test(part))) throw new MoguriError("sandbox_command", "Native execution needs its exact owned workspace/name and pinned foreground worker argv. No arbitrary program or alternate root was selected.", 409);
  return {
    name, project_path: workspace, runtime: { provider: "apple" },
    resources: { cpus: policy.resources.cpus, memory_mb: policy.resources.memoryMb, disk_size_mb: policy.resources.diskMb },
    policy: {
      commands: { default_action: "deny", log_blocked: true, allowlist: [command.join(" ")], denylist: [] },
      boundaries: { enabled: true, tool_calls: { servers: {} }, syscalls: { additional_denylist: [], log_blocked: true } },
      network: { default_action: "deny", allow_dns: policy.allowedDomains.length > 0, max_connections: 8, allowed_domains: [...policy.allowedDomains], blocked_domains: [] },
      packages: { enabled: false },
    },
    secrets: [],
    github: { forward_auth: false, forward_copilot_auth: false, allow_private_repository_access: false, branch_protection: { enabled: false, protected_branches: [], allowed_branch_patterns: [] } },
    devcontainer: { auto_generate: false, extensions: [] }, observability: { mcp_inspection: { enabled: false } },
  };
}
