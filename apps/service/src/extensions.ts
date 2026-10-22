import { valid } from "semver";
import {
  ExtensionManifestSchema, HookDefinitionSchema, MarketplaceCatalogSchema, MAX_TEXT, MoguriError, PROTOCOL_VERSION, parse,
  type CapabilityEntry, type EventInput, type ExtensionCommand, type ExtensionManifest, type ExtensionQuery, type ExtensionResponse,
  type HookBinding, type MarketplaceInput, type MarketplaceOrigin, type MarketplacePreview, type MarketplaceSource,
  type Project, type Session, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import { runProgram } from "./program.ts";
import { digest, type EventStore } from "./store.ts";
import { sourceRootSync } from "./repository-source.ts";
import { assertFolderName, folderPolicy, validateProjectPath } from "./project-policy.ts";
import type { ProjectService } from "./project-service.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

interface ExtensionHost {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  project(id: string): Project;
  projects(): ProjectService;
  skill(content: string): { name: string; description: string };
  entry(projectId: string | null, kind: CapabilityEntry["kind"], name: string, description: string, content: string, source: CapabilityEntry["source"], enabled?: boolean): CapabilityEntry;
}
export class Extensions {
  constructor(private readonly store: EventStore, private readonly host: ExtensionHost) {}
  private current(id: string) {
    const entry = this.host.snapshot().registry.find((entry) => entry.id === id);
    if (!entry) throw new MoguriError("capability_scope", "Capability is outside this profile or no longer retained.", 404);
    return entry;
  }
  private saved(entry: CapabilityEntry): EventInput {
    return { event_type: "capability.saved", profile_id: this.host.snapshot().profileId, project_id: entry.projectId, payload: { entry } };
  }
  private version(id: string, hash: string) {
    this.current(id);
    const event = this.host.events().findLast((event) => event.event_type === "capability.saved" && event.payload.entry.id === id && event.payload.entry.contentDigest === hash);
    if (event?.event_type !== "capability.saved") throw new MoguriError("capability_history", "Choose a real retained version of this exact capability. A digest cannot import another capability.", 409);
    return event.payload.entry;
  }
  assertIdle(projectId: string | null) {
    if (this.host.snapshot().sessions.some((session) => session.projectId === projectId && session.turnId)) throw new MoguriError("extension_busy", "Finish or stop this project's active turns before replacing, rolling back or disabling their hooks. No live hook was silently changed.", 409);
  }
  assertCompatible(entry: CapabilityEntry) {
    const plugin = entry.kind === "plugin" ? entry : entry.ownerPluginId ? this.current(entry.ownerPluginId) : undefined;
    if (plugin?.marketplace) this.manifest(JSON.parse(this.store.blob(plugin.contentDigest)));
  }
  private manifest(value: unknown) {
    const manifest = parse(ExtensionManifestSchema, value);
    if (!valid(manifest.version) || manifest.minimumProtocol > PROTOCOL_VERSION || manifest.maximumProtocol < PROTOCOL_VERSION || manifest.minimumProtocol > manifest.maximumProtocol) throw new MoguriError("plugin_incompatible", "The exact bundle version is invalid or incompatible with this Moguri protocol. No content was installed.", 409);
    const names = [
      ...manifest.skills.map((content) => `skill/${this.host.skill(content).name}`),
      ...manifest.scripts.map((script) => `script/${script.name}`),
      ...manifest.hooks.map((hook) => `hook/${hook.name}`),
    ];
    if (manifest.hooks.some((hook) => !hook.command.trim())) throw new MoguriError("hook_command", "Every declared hook needs an exact non-empty command. No blank lifecycle check was accepted.");
    if (!names.length || new Set(names).size !== names.length) throw new MoguriError("plugin_format", "A bundle needs at least one capability and unique kind/name entries.");
    if (!JSON.stringify(manifest).isWellFormed() || Buffer.byteLength(JSON.stringify(manifest)) > 64 * 1024) throw new MoguriError("plugin_limit", "The complete reviewed bundle must fit losslessly in 64 KiB. Nothing was truncated.");
    return manifest;
  }
  private owned(input: Pick<MarketplaceInput, "projectId" | "sourceProjectId" | "path" | "packageName">) {
    const plugin = this.host.snapshot().registry.find((entry) => entry.projectId === input.projectId && entry.kind === "plugin" &&
      entry.marketplace?.sourceProjectId === input.sourceProjectId && entry.marketplace.path === input.path && entry.marketplace.packageName === input.packageName);
    return plugin ? [plugin, ...this.host.snapshot().registry.filter((entry) => entry.ownerPluginId === plugin.id)] : [];
  }
  private async catalog(input: MarketplaceSource) {
    const snapshot = this.host.snapshot(), destination = this.host.project(input.projectId), source = this.host.project(input.sourceProjectId);
    validateProjectPath(input.path);
    assertFolderName(input.path, false, folderPolicy(this.host.projects().configuration(source.id).values));
    const binding = sourceRootSync(source.path), target = sourceRootSync(destination.path);
    const policyDigest = digest(JSON.stringify([snapshot.profileId, snapshot.policy, snapshot.settings.permissionRevision,
      this.host.projects().configuration(source.id), this.host.projects().configuration(destination.id)]));
    const signal = AbortSignal.timeout(15000);
    const git = (args: string[]) => runProgram("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--literal-pathspecs", ...args], {
      cwd: source.path, signal, label: "Read exact committed marketplace catalog", maxBytes: 256 * 1024, timeoutMs: 15000,
      env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    if ((await git(["rev-parse", "--path-format=absolute", "--show-toplevel"])).trim() !== source.path) throw new MoguriError("marketplace_root", "The catalog must belong to this exact registered repository root. No parent checkout was used.", 409);
    const tree = await git(["ls-tree", "-z", input.commit, "--", input.path]);
    if (!tree.startsWith("100644 blob ") && !tree.startsWith("100755 blob ") || tree.split("\0").filter(Boolean).length !== 1) throw new MoguriError("marketplace_source", "Select one exact committed regular catalog file, never a symlink or working-tree substitute.", 409);
    const content = await git(["show", `${input.commit}:${input.path}`]);
    let decoded: unknown;
    try { decoded = JSON.parse(content); } catch { throw new MoguriError("marketplace_format", "The committed catalog is not valid JSON. No script or installer was run."); }
    const catalog = parse(MarketplaceCatalogSchema, decoded);
    const fresh = this.host.snapshot();
    if (JSON.stringify(sourceRootSync(this.host.project(source.id).path)) !== JSON.stringify(binding) || JSON.stringify(sourceRootSync(this.host.project(destination.id).path)) !== JSON.stringify(target) ||
      policyDigest !== digest(JSON.stringify([fresh.profileId, fresh.policy, fresh.settings.permissionRevision, this.host.projects().configuration(source.id), this.host.projects().configuration(destination.id)]))) throw new MoguriError("marketplace_stale", "The catalog/destination root or policy changed while reading. Review the exact source again.", 409);
    const catalogDigest = digest(content);
    return { catalog, binding, target, policyDigest, catalogDigest };
  }
  async preview(input: MarketplaceInput): Promise<MarketplacePreview> {
    const { catalog, binding, target, policyDigest, catalogDigest } = await this.catalog(input);
    const found = catalog.packages.filter((manifest) => manifest.name === input.packageName && manifest.version === input.version);
    if (found.length !== 1) throw new MoguriError("marketplace_package", "Choose one exact unambiguous package/version from this committed catalog.", 404);
    const manifest = this.manifest(found[0]), installed = this.owned(input).map(({ id, revision, contentDigest, enabled }) => ({ id, revision, contentDigest, enabled }));
    return { input: structuredClone(input), manifest, source: binding, catalogDigest, installed,
      digest: digest(JSON.stringify(["moguri-marketplace-v1", input, binding, target, policyDigest, catalogDigest, manifest, installed])),
      warning: "Repository-backed catalog, not a hosted marketplace or trust certification. Declared license is informational. Review every inline command/script and exact commit. Installation/update/rollback disables the whole bundle; enabling and each execution remain separate and policy-controlled. No network, dependency installer, hook or repository checkout runs on install." };
  }
  private bundle(projectId: string, manifest: ExtensionManifest, origin: MarketplaceOrigin | undefined, existing?: CapabilityEntry): CapabilityEntry[] {
    const plugin = { ...this.host.entry(projectId, "plugin", `${manifest.name}@${manifest.version}`, manifest.description, JSON.stringify(manifest), "user"),
      ...(existing ? { id: existing.id, revision: existing.revision + 1, createdAt: existing.createdAt } : {}), ...(origin ? { marketplace: origin } : {}) };
    const old = existing ? this.host.snapshot().registry.filter((entry) => entry.ownerPluginId === existing.id) : [];
    const contents: { kind: "skill" | "script" | "hook"; name: string; description: string; content: string }[] = [
      ...manifest.skills.map((content) => ({ kind: "skill" as const, ...this.host.skill(content), content })),
      ...manifest.scripts.map((script) => ({ ...script, kind: "script" as const })),
      ...manifest.hooks.map((hook) => ({ kind: "hook" as const, name: hook.name, description: hook.description, content: JSON.stringify(hook) })),
    ];
    const children = contents.map((value) => {
      const name = `${manifest.name}/${value.name}`, previous = old.find((entry) => entry.kind === value.kind && entry.name === name);
      return { ...this.host.entry(projectId, value.kind, name, value.description, value.content, "user"),
        ...(previous ? { id: previous.id, revision: previous.revision + 1, createdAt: previous.createdAt } : {}), ownerPluginId: plugin.id, retired: false };
    });
    const removed = old.filter((entry) => !children.some((child) => child.id === entry.id)).map((entry) => ({ ...entry, enabled: false, retired: true, revision: entry.revision + 1 }));
    const added = [plugin, ...children].filter((entry) => !this.host.snapshot().registry.some((previous) => previous.id === entry.id)).length;
    if (this.host.snapshot().registry.length + added > 500) throw new MoguriError("capability_limit", "This profile's 500-capability bound would be exceeded. No partial bundle was installed.", 409);
    return [plugin, ...children, ...removed];
  }
  async query(query: ExtensionQuery): Promise<ExtensionResponse> {
    if (query.type === "marketplace.catalog") {
      const { catalog, binding, catalogDigest } = await this.catalog(query.input);
      return { type: query.type, catalog: { packages: catalog.packages.map(({ name, version, description, license, minimumProtocol, maximumProtocol }) =>
        ({ name, version, description, license, minimumProtocol, maximumProtocol })), source: binding, commit: query.input.commit, path: query.input.path, digest: catalogDigest } };
    }
    if (query.type === "marketplace.preview") return { type: query.type, preview: await this.preview(query.input) };
    if (query.type === "capability.version") {
      const entry = this.version(query.capabilityId, query.contentDigest);
      return { type: query.type, entry, content: this.store.blob(entry.contentDigest) };
    }
    this.current(query.capabilityId);
    const history = this.host.events().flatMap((event) => event.event_type === "capability.saved" && event.payload.entry.id === query.capabilityId ? [event.payload.entry] : []).reverse();
    return { type: query.type, entries: history.slice(query.offset, query.offset + 20), nextOffset: query.offset + 20 < history.length ? query.offset + 20 : null };
  }
  async execute(command: ExtensionCommand, finish: WorkspaceFinish) {
    if (command.type === "marketplace.install") {
      const preview = await this.preview(command.input);
      if (preview.digest !== command.expectedDigest) throw new MoguriError("marketplace_stale", "The exact source, installed version or policy changed. Review a fresh catalog preview before installing.", 409);
      const existing = this.owned(command.input).find((entry) => entry.kind === "plugin");
      if (existing) this.assertIdle(existing.projectId);
      const origin: MarketplaceOrigin = { sourceProjectId: command.input.sourceProjectId, commit: command.input.commit, path: command.input.path,
        catalogDigest: preview.catalogDigest, packageName: command.input.packageName, version: command.input.version };
      const entries = this.bundle(command.input.projectId, preview.manifest, origin, existing);
      return finish(entries.map((entry) => this.saved(entry)), { id: entries[0]!.id, revision: entries[0]!.revision });
    }
    if (command.type === "hook.import") {
      this.host.project(command.projectId);
      if (this.host.snapshot().registry.some((entry) => entry.projectId === command.projectId && entry.kind === "hook" && entry.name === command.definition.name)) throw new MoguriError("capability_exists", "This project already has a hook with that name. Review its history or import a distinctly named hook.", 409);
      const definition = parse(HookDefinitionSchema, command.definition);
      if (!definition.command.trim()) throw new MoguriError("hook_command", "A hook needs an exact non-empty command. No interpolation or generated command was added.");
      const entry = this.host.entry(command.projectId, "hook", definition.name, definition.description, JSON.stringify(definition), "user");
      return finish([this.saved(entry)], { id: entry.id, revision: entry.revision });
    }
    const entry = this.current(command.capabilityId);
    if (command.type === "skill.use") {
      const session = this.host.snapshot().sessions.find((session) => session.id === command.sessionId);
      if (!session || entry.projectId !== session.projectId || entry.kind !== "skill" || !entry.enabled || entry.retired || entry.contentDigest !== command.expectedDigest ||
        entry.ownerPluginId && !this.current(entry.ownerPluginId).enabled) throw new MoguriError("skill_scope", "Choose an enabled current skill in this exact session/project. No task, grant or model call was inferred.", 403);
      if (session.draft.revision !== command.expectedDraftRevision) throw new MoguriError("revision_conflict", "The draft changed. Your current draft and selected skill were preserved.", 409);
      const text = `${session.draft.text}${session.draft.text ? "\n\n" : ""}<user-selected-skill name=${JSON.stringify(entry.name)}>\n${this.store.blob(entry.contentDigest)}\n</user-selected-skill>`;
      if (Buffer.byteLength(text) > MAX_TEXT) throw new MoguriError("draft_limit", "The complete selected skill does not fit this draft. No content was truncated or sent.", 409);
      return finish([{ event_type: "draft.saved", profile_id: this.host.snapshot().profileId, project_id: session.projectId, session_id: session.id, payload: { text, attachments: session.draft.attachments } }], { revision: session.draft.revision + 1 });
    }
    if (entry.revision !== command.expectedRevision) throw new MoguriError("capability_conflict", "Another client changed this capability. Review its current version before rollback.", 409);
    this.assertIdle(entry.projectId);
    const previous = this.version(entry.id, command.contentDigest);
    if (previous.kind !== entry.kind || previous.ownerPluginId !== entry.ownerPluginId || previous.projectId !== entry.projectId) throw new MoguriError("capability_history", "Rollback cannot change the original capability's kind, plugin or project.", 409);
    if (entry.kind === "plugin" && entry.marketplace) {
      const manifest = this.manifest(JSON.parse(this.store.blob(previous.contentDigest)));
      const entries = this.bundle(entry.projectId!, manifest, previous.marketplace, entry);
      return finish(entries.map((entry) => this.saved(entry)), { id: entry.id, revision: entry.revision + 1 });
    }
    if (entry.kind === "plugin") throw new MoguriError("plugin_legacy", "This legacy skill-only bundle has no complete versioned child manifest. Reimport its reviewed version disabled instead of guessing a partial rollback.", 409);
    if (entry.kind === "hook") parse(HookDefinitionSchema, JSON.parse(this.store.blob(previous.contentDigest)));
    if (entry.kind === "skill") this.host.skill(this.store.blob(previous.contentDigest));
    const restored = { ...previous, id: entry.id, createdAt: entry.createdAt, source: "user" as const, enabled: false, retired: false, revision: entry.revision + 1 };
    return finish([this.saved(restored)], { id: restored.id, revision: restored.revision });
  }
  hooks(session: Session): HookBinding[] {
    if (session.kind !== "agent" || session.mode !== "agent" || !session.projectId) return [];
    const snapshot = this.host.snapshot(), entries = snapshot.registry.filter((entry) => entry.kind === "hook" && entry.projectId === session.projectId &&
      entry.enabled && !entry.retired && (!entry.ownerPluginId || snapshot.registry.some((plugin) => plugin.id === entry.ownerPluginId && plugin.enabled && !plugin.retired)));
    if (entries.length > 16) throw new MoguriError("hook_limit", "At most 16 enabled lifecycle hooks may belong to one turn. Disable excess hooks before running.", 409);
    return entries.map((entry) => {
      this.assertCompatible(entry);
      return { id: entry.id, revision: entry.revision, contentDigest: entry.contentDigest, definition: parse(HookDefinitionSchema, JSON.parse(this.store.blob(entry.contentDigest))) };
    });
  }
  assertHook(session: Session, binding: HookBinding) {
    const current = this.hooks(session).find((hook) => hook.id === binding.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(binding)) throw new MoguriError("hook_stale", "The exact enabled hook or owning bundle changed. No stale command was authorized.", 409);
  }
}
