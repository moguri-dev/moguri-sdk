import { Resolver, lookup } from "node:dns/promises";
import { MoguriError, type SandboxConfiguration, type SandboxExecution, type SandboxNetworkScope } from "../../../packages/protocol/src/index.ts";
import { canonicalSandboxDomainRule, sandboxConfiguration, type QualifiedSandboxConfiguration } from "./sandbox-policy.ts";
import { canonicalNetworkHostname, publicAddress } from "./public-network.ts";
import { frameDigest } from "./worker-wire.ts";

export interface SandboxDns {
  addresses(host: string, signal: AbortSignal): Promise<string[]>;
  aliases(host: string, signal: AbortSignal): Promise<string[]>;
}
async function query<T>(host: string, signal: AbortSignal, read: (resolver: Resolver) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const resolver = new Resolver({ timeout: 2500, tries: 2 }), abort = () => resolver.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try { const result = await read(resolver); signal.throwIfAborted(); return result; }
  catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && "code" in error && ["ENOTFOUND", "ESERVFAIL", "ETIMEOUT", "EAI_AGAIN", "ECANCELLED", "EREFUSED"].includes(String(error.code))) {
      throw new MoguriError("sandbox_dns", `The selected provider DNS lookup for ${host} failed (${String(error.code)}). No empty scope, extra host or Local fallback was used.`, 502);
    }
    throw error;
  }
  finally { signal.removeEventListener("abort", abort); }
}
export const sandboxDns: SandboxDns = {
  addresses: async (host, signal) => {
    signal.throwIfAborted();
    let cancel!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => { cancel = () => reject(signal.reason); signal.addEventListener("abort", cancel, { once: true }); });
    try {
      const records = await Promise.race([lookup(host, { all: true, verbatim: true }), stopped]);
      signal.throwIfAborted(); return records.map((record) => record.address);
    } finally { signal.removeEventListener("abort", cancel); }
  },
  aliases: (host, signal) => query(host, signal, async (resolver) => {
    try { return await resolver.resolveCname(host); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENODATA") return []; throw error; }
  }),
};
function providerUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new MoguriError("sandbox_provider_scope", "The prepared provider requires a public HTTPS endpoint without credentials.", 403); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || !canonicalNetworkHostname(url.hostname)) {
    throw new MoguriError("sandbox_provider_scope", "The prepared provider requires a public HTTPS DNS hostname without embedded credentials. Controller loopback is not a guest endpoint.", 403);
  }
  return url;
}
export async function resolveSandboxNetwork(value: SandboxConfiguration, urls: string[], signal: AbortSignal, dns: SandboxDns = sandboxDns):
Promise<{ configuration: QualifiedSandboxConfiguration; scope: SandboxNetworkScope }> {
  signal.throwIfAborted();
  signal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const config = sandboxConfiguration(value);
  if (urls.length && !config.qualification.allowCopilot) throw new MoguriError("sandbox_provider_scope", "Selected-provider access is disabled by the reviewed native configuration. No provider access or fallback.", 403);
  if (urls.length > 16) throw new MoguriError("sandbox_provider_scope", "The selected native workflow exceeds sixteen explicitly admitted provider resources.", 409);
  const origins = [...new Set(urls.map((value) => providerUrl(value).origin))].sort();
  const providerHosts = [...new Set(origins.map((value) => new URL(value).hostname))].sort();
  const allowed = new Set(config.qualification.allowedDomains), aliases: SandboxNetworkScope["aliases"] = [];
  for (const host of providerHosts) {
    let current = host;
    const seen = new Set<string>(), chain: string[] = [];
    for (let depth = 0; ; depth++) {
      signal.throwIfAborted();
      if (seen.has(current)) throw new MoguriError("sandbox_dns", "The selected provider's DNS alias chain contains a cycle. No host was added.", 409);
      if (depth >= 8) throw new MoguriError("sandbox_dns", "The selected provider's DNS alias chain exceeds eight exact hosts. No wildcard or fallback was added.", 409);
      seen.add(current);
      if (!canonicalNetworkHostname(current)) throw new MoguriError("sandbox_dns", "A provider alias is not an exact canonical DNS hostname.", 403);
      const addresses = await dns.addresses(current, signal);
      signal.throwIfAborted();
      if (!addresses.length || addresses.some((address) => !publicAddress(address))) throw new MoguriError("sandbox_dns", "The selected provider or alias resolves to private, metadata or reserved addresses. No native access was authorized.", 403);
      allowed.add(current);
      if (allowed.size > 32) throw new MoguriError("sandbox_dns", "The complete reviewed tool/provider DNS scope exceeds 32 domain rules and exact provider hosts. No destination was silently dropped.", 409);
      const targets = await dns.aliases(current, signal);
      signal.throwIfAborted();
      if (targets.length > 1) throw new MoguriError("sandbox_dns", "The provider DNS response has ambiguous aliases. No arbitrary target was selected.", 409);
      if (!targets.length) break;
      current = targets[0]!.toLowerCase().replace(/\.$/, "");
      chain.push(current);
    }
    aliases.push({ host, targets: chain });
  }
  const allowedDomains = [...allowed].sort();
  return { configuration: { ...config, qualification: { ...config.qualification, allowedDomains } },
    scope: { version: 1, reviewedConfigDigest: frameDigest(config), providerUrls: origins, providerHosts, aliases, allowedDomains, resolvedAt: new Date().toISOString() } };
}
export function assertSandboxNetwork(execution: Pick<SandboxExecution, "config" | "configDigest" | "networkScope">, value: SandboxConfiguration): void {
  const base = sandboxConfiguration(value), scope = execution.networkScope;
  if (!scope) {
    if (execution.configDigest !== frameDigest(base)) throw new MoguriError("sandbox_changed", "The original exact native configuration changed. No new access was sent.", 409);
    return;
  }
  const expected = structuredClone(execution.config);
  if (!expected.qualification) throw new MoguriError("sandbox_changed", "The captured native configuration lost its original qualification.", 409);
  expected.qualification.allowedDomains = [...base.qualification.allowedDomains];
  const hosts = [...new Set([...base.qualification.allowedDomains, ...scope.providerHosts, ...scope.aliases.flatMap((alias) => alias.targets)])].sort();
  if (scope.version !== 1 || scope.reviewedConfigDigest !== frameDigest(base) || frameDigest(expected) !== frameDigest(base) ||
    execution.configDigest !== frameDigest(execution.config) || hosts.length > 32 || hosts.some((host) => !canonicalSandboxDomainRule(host)) ||
    scope.providerHosts.some((host) => !canonicalNetworkHostname(host)) ||
    scope.aliases.some((alias) => !canonicalNetworkHostname(alias.host) || alias.targets.some((host) => !canonicalNetworkHostname(host))) ||
    JSON.stringify(hosts) !== JSON.stringify(scope.allowedDomains) || JSON.stringify(hosts) !== JSON.stringify(execution.config.qualification?.allowedDomains) ||
    scope.providerUrls.some((value) => !scope.providerHosts.includes(providerUrl(value).hostname))) {
    throw new MoguriError("sandbox_changed", "The captured provider/DNS scope differs from its exact reviewed native base. No later grant, credential or fallback was accepted.", 409);
  }
}
