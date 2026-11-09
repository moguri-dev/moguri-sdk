import { defaultApplicationPreferences, normalizeApplicationPreferences, GLOBAL_PROFILE_ID, MoguriError, type ApplicationCommand, type ApplicationConfiguration, type CommandEnvelope, type CommandResult, type EventInput, type UpdateQuery, type UpdateResponse } from "../../../packages/protocol/src/index.ts";
import { digest, EventStore } from "./store.ts";
import { StorageRelocation, type StorageOptions, type MaintenanceFacts } from "./storage-relocation.ts";
import { ApplicationUpdates, type UpdateOptions } from "./updates.ts";

export class ApplicationRuntime {
  private readonly global: EventStore;
  private state: ApplicationConfiguration;
  private closed = false;
  private closing?: Promise<void>;
  readonly storage: StorageRelocation;
  readonly updates: ApplicationUpdates;
  constructor(store: EventStore, private readonly changed: () => void, native: { resourceBase: string; storage?: StorageOptions; updates?: UpdateOptions; facts: () => MaintenanceFacts; quiesce: () => void }) {
    this.global = store.view(GLOBAL_PROFILE_ID);
    const event = this.global.events().findLast((event) => event.event_type === "application.configured");
    if (event?.event_type === "application.configured" && (!Number.isSafeInteger(event.payload.revision) || event.payload.revision < 0)) {
      throw new MoguriError("application_configuration_corrupt", "The retained application preference revision is invalid. Original state was preserved.", 409);
    }
    this.state = event?.event_type === "application.configured" ?
      { revision: event.payload.revision, values: normalizeApplicationPreferences(event.payload.values) } :
      { revision: 0, values: defaultApplicationPreferences() };
    this.updates = new ApplicationUpdates(this.global, native.resourceBase, native.updates, () => this.state.values.automaticUpdates, changed);
    this.storage = new StorageRelocation(this.global, native.resourceBase, native.storage, () => {
      if (this.updates.hasPendingInstallation()) throw new MoguriError("update_install_pending", "Inspect the original installation before whole-store relocation. Its independent helper/backup cannot be moved or replayed.", 409);
      return native.facts();
    }, changed, native.quiesce);
  }
  configuration(): ApplicationConfiguration {
    return structuredClone(this.state);
  }
  receipt(envelope: CommandEnvelope): CommandResult | undefined {
    return this.global.receipt(envelope.id, digest(JSON.stringify({ profileId: envelope.profileId, command: envelope.command })));
  }
  dispatch(envelope: CommandEnvelope, command: ApplicationCommand): CommandResult {
    if (this.closed) throw new MoguriError("shutting_down", "Application maintenance is closing. No global preference was changed.", 503);
    const hash = digest(JSON.stringify({ profileId: envelope.profileId, command }));
    const receipt = this.global.receipt(envelope.id, hash); if (receipt) return receipt;
    if (command.type !== "application.configure") {
      const finish = Object.assign((events: EventInput[], result: CommandResult = {}) => {
        this.global.commit(events, { id: envelope.id, digest: hash, result }); this.changed(); return result;
      }, { intent: { id: envelope.id, digest: hash } });
      return this.updates.execute(command, finish);
    }
    const current = this.configuration();
    if (current.revision !== command.expectedRevision) throw new MoguriError("application_configuration_changed", "Application preferences changed. Reload the actual root revision before saving.", 409);
    const next = { revision: current.revision + 1, values: { ...current.values, ...command.changes } }, result = { revision: next.revision };
    this.global.commit([{ event_type: "application.configured", profile_id: GLOBAL_PROFILE_ID, payload: next }], { id: envelope.id, digest: hash, result });
    this.state = next;
    this.changed(); return result;
  }
  async updateQuery(query: UpdateQuery): Promise<UpdateResponse> {
    switch (query.type) {
      case "application.update.status": return { type: query.type, update: this.updates.status() };
      case "application.update.credential": return { type: query.type, update: await this.updates.credentialStatus() };
      case "application.update.history": return { type: query.type, updates: this.updates.history() };
      case "application.update.read": return { type: query.type, update: this.updates.read(query.id) };
      case "application.update.install_preview": return { type: query.type, review: await this.updates.installPreview(query.id) };
    }
  }
  close(preserveInstaller = false): Promise<void> {
    this.closed = true;
    this.closing ??= this.updates.close(preserveInstaller).then(() => { if (this.global.db.isOpen) this.global.close(); })
      .catch((error: unknown) => { this.closing = undefined; throw error; });
    return this.closing;
  }
}
