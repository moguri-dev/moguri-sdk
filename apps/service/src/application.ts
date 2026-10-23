import { defaultApplicationPreferences, GLOBAL_PROFILE_ID, MoguriError, type ApplicationCommand, type ApplicationConfiguration, type CommandEnvelope, type CommandResult } from "../../../packages/protocol/src/index.ts";
import { digest, EventStore } from "./store.ts";
import { StorageRelocation, type StorageOptions, type MaintenanceFacts } from "./storage-relocation.ts";

export class ApplicationRuntime {
  private readonly global: EventStore;
  private state: ApplicationConfiguration;
  private closed = false;
  readonly storage: StorageRelocation;
  constructor(store: EventStore, private readonly changed: () => void, native: { resourceBase: string; storage?: StorageOptions; facts: () => MaintenanceFacts; quiesce: () => void }) {
    this.global = store.view(GLOBAL_PROFILE_ID);
    const event = this.global.events().findLast((event) => event.event_type === "application.configured");
    this.state = event?.event_type === "application.configured" ? structuredClone(event.payload) : { revision: 0, values: defaultApplicationPreferences() };
    this.storage = new StorageRelocation(this.global, native.resourceBase, native.storage, native.facts, changed, native.quiesce);
  }
  configuration(): ApplicationConfiguration {
    return structuredClone(this.state);
  }
  dispatch(envelope: CommandEnvelope, command: ApplicationCommand): CommandResult {
    if (this.closed) throw new MoguriError("shutting_down", "Application maintenance is closing. No global preference was changed.", 503);
    const hash = digest(JSON.stringify({ profileId: envelope.profileId, command }));
    const receipt = this.global.receipt(envelope.id, hash); if (receipt) return receipt;
    const current = this.configuration();
    if (current.revision !== command.expectedRevision) throw new MoguriError("application_configuration_changed", "Application preferences changed. Reload the actual root revision before saving.", 409);
    const next = { revision: current.revision + 1, values: { ...current.values, ...command.changes } }, result = { revision: next.revision };
    this.global.commit([{ event_type: "application.configured", profile_id: GLOBAL_PROFILE_ID, payload: next }], { id: envelope.id, digest: hash, result });
    this.state = next;
    this.changed(); return result;
  }
  close(): void { if (!this.closed) { this.closed = true; this.global.close(); } }
}
