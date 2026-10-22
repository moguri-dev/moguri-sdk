import { randomUUID } from "node:crypto";
import { MoguriError, type DependencyPackage } from "../../../packages/protocol/src/index.ts";
import type { DependencyRegistry, DependencyRegistryConfig, DependencyRegistryPreview } from "../../../packages/protocol/src/workspace.ts";
import { type SecretVault } from "./gateway.ts";
import { digest } from "./store.ts";

export const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export function cacheUrl(value: string, allowLoopback = false, directory = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new MoguriError("cache_registry", "Use an explicit HTTPS registry/advisory URL without credentials, query or fragment."); }
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)) ||
    /%(?:2f|5c|2e|00)/i.test(url.pathname) || url.pathname.includes("//") || url.pathname.includes("\\")) {
    throw new MoguriError("cache_registry", "Registry/advisory endpoints require HTTPS, an exact resource path, and no URL credentials, query or fragment. HTTP is reserved for generated loopback fixtures.");
  }
  if (directory && !url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
export function inRegistry(url: string, base: string): boolean {
  const requested = new URL(url), registry = new URL(base);
  return requested.origin === registry.origin && requested.pathname.startsWith(registry.pathname);
}
export class DependencyRegistries {
  private readonly changing = new Set<string>();
  private readonly active = new Map<string, Set<AbortController>>();
  constructor(readonly profileId: string, readonly vault: SecretVault, private readonly configuration: () => DependencyRegistry[], readonly allowLoopback = false) {}
  list(): DependencyRegistry[] { return this.configuration().filter((entry) => entry.profileId === this.profileId); }
  get(id: string): DependencyRegistry {
    const registry = this.list().find((entry) => entry.id === id);
    if (!registry) throw new MoguriError("cache_registry_scope", "This registry authorization is outside the active profile or was removed.", 404);
    if (this.changing.has(id)) throw new MoguriError("cache_registry_changed", "Registry credentials are changing. Inspect a new plan after the change settles.", 409);
    return registry;
  }
  validate(config: DependencyRegistryConfig, previous?: DependencyRegistry): DependencyRegistry {
    const packages = [...new Set(config.packages)].sort();
    if (!config.name.trim() || packages.some((name) => !npmPackageName.test(name) && !/^@[a-z0-9][a-z0-9._-]*\/\*$/.test(name))) {
      throw new MoguriError("cache_registry", "Name exact npm packages or explicit @scope/* resources. An unrestricted registry or ambient npm configuration is not authorization.");
    }
    for (const other of this.list()) {
      if (other.id === previous?.id) continue;
      if (packages.some((resource) => other.packages.some((candidate) => resource === candidate || resource.endsWith("/*") && candidate.startsWith(resource.slice(0, -1)) || candidate.endsWith("/*") && resource.startsWith(candidate.slice(0, -1))))) {
        throw new MoguriError("cache_registry_scope", "These package resources overlap another registry authorization. Remove the ambiguity before saving.");
      }
    }
    const url = cacheUrl(config.url, this.allowLoopback, true);
    if (new URL(url).hostname === "registry.npmjs.org") throw new MoguriError("cache_registry", "The public npm registry is already configured without credentials. Do not attach a private bearer token to it.");
    return { ...config, name: config.name.trim(), url, advisoryUrl: cacheUrl(config.advisoryUrl, this.allowLoopback), packages,
      id: previous?.id ?? randomUUID(), profileId: this.profileId, revision: (previous?.revision ?? -1) + 1, credentialRevision: randomUUID() };
  }
  resolve(name: string): DependencyRegistry | undefined {
    const matches = this.list().filter((entry) => entry.packages.some((resource) => resource === name || resource.endsWith("/*") && name.startsWith(resource.slice(0, -1))));
    if (matches.length > 1) throw new MoguriError("cache_registry_scope", "Multiple registry authorizations match one package; no default account was chosen.");
    return matches[0];
  }
  scope(registry: DependencyRegistry): string {
    return digest(JSON.stringify([this.profileId, registry.id, registry.revision, registry.credentialRevision, registry.url, registry.packages]));
  }
  private key(registry: DependencyRegistry): string { return `cache-${digest(JSON.stringify([this.profileId, registry.id, registry.credentialRevision]))}`; }
  private async credential<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new MoguriError("cache_registry_secret", "The explicit registry secret backend could not confirm this operation. Review masked credential state and any inactive-generation cleanup; no secret value or backend error was exposed.", 409); }
  }
  private invalidate(id: string): void { for (const controller of this.active.get(id) ?? []) controller.abort(new MoguriError("cache_registry_changed", "The registry authorization changed; no in-flight result can be admitted.", 409)); }
  async changeToken(registry: DependencyRegistry, token: string | undefined, persist: (next: DependencyRegistry) => void): Promise<DependencyRegistry> {
    if (token !== undefined && !/^[\x21-\x7e]{1,4096}$/.test(token)) throw new MoguriError("cache_registry_token", "Enter the registry bearer token without whitespace/control characters.");
    this.get(registry.id); this.changing.add(registry.id); this.invalidate(registry.id);
    const next = { ...registry, revision: registry.revision + 1, credentialRevision: randomUUID() };
    try {
      if (token !== undefined) await this.credential(() => this.vault.write(this.key(next), token, AbortSignal.timeout(15_000)));
      persist(next);
      await this.credential(() => this.vault.remove(this.key(registry), AbortSignal.timeout(15_000)));
      return next;
    } finally { this.invalidate(registry.id); this.changing.delete(registry.id); }
  }
  async revoke(registry: DependencyRegistry): Promise<void> {
    this.invalidate(registry.id);
    await this.credential(() => this.vault.remove(this.key(registry), AbortSignal.timeout(15_000)));
  }
  close(): void { for (const id of this.active.keys()) this.invalidate(id); }
  async previews(): Promise<DependencyRegistryPreview[]> {
    return Promise.all(this.list().map(async (registry) => ({ ...registry, credential: await this.credential(() => this.vault.read(this.key(registry), AbortSignal.timeout(15_000))) ? "configured" as const : "required" as const,
      diagnostic: "Bearer credentials are masked and bound to this profile, registry and exact reviewed package resources. Changing configuration requires a new token and dependency plan." })));
  }
  async authorized<T>(entry: DependencyPackage, signal: AbortSignal, operation: (headers: Record<string, string>, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!entry.registryId) return operation({}, signal);
    const registry = this.get(entry.registryId);
    if (entry.scope !== this.scope(registry) || !inRegistry(entry.url, registry.url) || this.resolve(entry.name)?.id !== registry.id) throw new MoguriError("cache_registry_changed", "The exact profile/registry/resource authorization changed. Inspect a new plan.", 409);
    const controller = new AbortController();
    const controllers = this.active.get(registry.id) ?? new Set<AbortController>(); controllers.add(controller); this.active.set(registry.id, controllers);
    try {
      const token = await this.credential(() => this.vault.read(this.key(registry), AbortSignal.any([signal, controller.signal, AbortSignal.timeout(15_000)])));
      signal.throwIfAborted(); controller.signal.throwIfAborted();
      if (!token || !/^[\x21-\x7e]{1,4096}$/.test(token)) throw new MoguriError("cache_registry_credential", "Configure this exact registry's masked bearer credential before fetching private artifacts. Ambient npm credentials are never used.", 409);
      const result = await operation({ Authorization: `Bearer ${token}` }, AbortSignal.any([signal, controller.signal]));
      signal.throwIfAborted(); controller.signal.throwIfAborted();
      if (entry.scope !== this.scope(this.get(registry.id))) throw new MoguriError("cache_registry_changed", "The registry authorization changed during the request.", 409);
      return result;
    } finally { controllers.delete(controller); if (!controllers.size) this.active.delete(registry.id); }
  }
}
