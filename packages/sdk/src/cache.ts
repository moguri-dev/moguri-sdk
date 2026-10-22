import type { DependencyRegistryConfig, PackageManager } from "../../protocol/src/workspace.ts";
import type { MoguriSdk } from "./index.ts";

export function createCacheApi(sdk: Pick<MoguriSdk, "query" | "command">) {
  return {
    inspect: (projectId: string, manager: PackageManager, workspaceId?: string) => sdk.query({ type: "cache.inspect", projectId, manager, ...(workspaceId ? { workspaceId } : {}) }),
    prepare: (projectId: string, manager: PackageManager, expectedDigest: string, acceptMetadataSharing: true, workspaceId?: string) => sdk.command({ type: "cache.prepare", projectId, manager, expectedDigest, acceptMetadataSharing, ...(workspaceId ? { workspaceId } : {}) }),
    install: (projectId: string, manager: PackageManager, expectedDigest: string, acceptMetadataSharing: true, runScripts = false, workspaceId?: string) => sdk.command({ type: "cache.install", projectId, manager, expectedDigest, acceptMetadataSharing, runScripts, ...(workspaceId ? { workspaceId } : {}) }),
    registries: {
      list: () => sdk.query({ type: "cache.registries" }),
      save: (config: DependencyRegistryConfig, expectedRevision = 0, registryId?: string) => sdk.command({ type: "cache.registry.save", config, expectedRevision, ...(registryId ? { registryId } : {}) }),
      remove: (registryId: string, expectedRevision: number) => sdk.command({ type: "cache.registry.remove", registryId, expectedRevision }),
      setToken: (registryId: string, token: string) => sdk.command({ type: "cache.registry.token.set", registryId, token }),
      clearToken: (registryId: string) => sdk.command({ type: "cache.registry.token.clear", registryId }),
    },
  };
}
