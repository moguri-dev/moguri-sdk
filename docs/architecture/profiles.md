# Profile isolation contract

Status: qualified 0.8.0-alpha.1 / protocol-14 development checkpoint. Isolated
profiles share one local authority across SDK, CLI, native TUI and desktop.
This is not the completed first milestone or a native SendBox qualification.

Reuse Node/SQLite/AES-GCM, TypeBox, maintained pi-ai and the explicit OS-keychain
backend already qualified by this repository. No new dependency, forked agent
loop, per-client domain database or implicit provider login is needed.

## Authority and migration

One local service owns one append-only database, with profile-scoped store and
controller views. Global registry/policy events have a separate internal scope.
Protocol/migration 14 must preserve the existing Default event identities,
receipts, directories, wrapped keys and keychain service names. Add explicit
profile identity to API/WS routing and receipt keys; default omission means the
actual Default profile, never a previous selected profile.

Public profile IDs are immutable and validated independently of display names.
Root registry creation/rename/default/policy actions are explicit user APIs,
not model tools. Creation intent precedes owned directory/runtime effects;
interrupted creation is partial and never silently retried or adopted.
Deletion/merging profiles is not implied by creation/switching.

Each client connection has immutable profile scope. Opening another profile
uses another scoped SDK client; pending commands/draft editors cannot change
their destination when a user navigates. Snapshot, replay, queries, terminal
I/O, blobs, receipts and exports must reject cross-profile identities without
fallback. Default data is not copied into a new profile.
The public client property is non-writable/non-configurable at runtime, not
only TypeScript-readonly. Unknown profile startup reports the actual scope
error instead of retrying until a generic handshake timeout.

## Secrets and resources

Copilot, local/remote model endpoints, MCP OAuth/bearer and integration secrets
use actual profile-ID namespaces. Existing Default credentials retain their
names; a new profile begins disconnected. Shared root retention authority
unwraps independent profile/project/session/artifact keys, never exposes them
to clients, and must not return another profile's blob grant.

Projects, sessions, artifacts, style/index data, registry/evolution, budgets,
settings and voice preferences are isolated. Public immutable package archives
and verified speech weights may share user-owned caches; mutable workspaces,
capture data and credentials may not. A shared filesystem root is not a
sandbox: cross-profile writers still need the common root authority.

## Global policy and defaults

Global user-only allowed-env policy cannot be bypassed by profile switching or
factory reset. Commit its root event and profile projections atomically; only
the actual running Local turns recorded at that change may finish. A new
profile gets the current policy before admission, never a permissive factory
window. Pending approvals are invalidated consistently.

Global control preferences are shared intentionally, with explicit provenance.
Profile/project/session overrides stay scoped and never widen hard policy.
Changing a preference does not rewrite saved session controls. A default model
unavailable in a disconnected/new profile is not silently substituted.

Hard profile budgets remain profile-owned; global caps, when configured, must
check all profile reservations before dispatch without disclosing foreign
profile content. Source deletion, restart, switching defaults or selecting a
new profile cannot refund global accounting. Unknown telemetry/prices remain
unknown.
Live global capacity changes invalidate scoped snapshots using a content-free
accounting sequence. Other profiles' model events, ledger rows, prompts and
account credentials are never broadcast to the current client. Revision checks
run after asynchronous authority initialization and immediately before commit,
so concurrent global preference/cap edits cannot both claim the same revision.

## Client and API surfaces

`X-Moguri-Profile` and WebSocket authentication select immutable scope.
`connectMoguri({profileId})` and `sdk.profiles.open(id)` return scoped clients;
omission still means actual Default. CLI/TUI `--profile ID` overrides the
explicit `MOGURI_PROFILE_ID` launch environment without persisting a global
active-profile selection. Desktop launch accepts that environment through the
CLI. New profile creation never chooses it automatically.

The SDK provides list/create/update/wait/open/retry/stop, revisioned shared
startup preferences and revisioned global hard budget policy. The CLI exposes
`profile list|create|update|defaults|retry|stop`, `budget global`, and
`--profile ID`. TUI F8 works without a session, edits name/color as validated
JSON and inspects or explicitly retries/stops partial setup. Shared
`/profiles` and `/profile` return typed navigation actions, not a mutable
connection or model-controlled profile change.

Desktop switching flushes the old draft editors before opening the next
client. Dirty settings, artifact and profile forms, dialogs and owned dictation
block switching. Input is inert during the handoff; old work continues under
its original controller. Native notifications bind profile and session IDs;
preview partitions bind both IDs and reject foreign sessions. A delayed
old-profile preview close cannot destroy the new profile's view.

Profile/global budget forms have independent dirty ownership. Saving one must
not enable navigation while another still contains uncommitted edits.
Profile settings reset preserves shared global startup values and all hard
policies; restoring shared global preferences is a separate revision-bound
user action.

## Required generated evidence

Qualify two scoped views/controllers and real SDK clients before enabling UI:
foreign IDs/digests/receipts, same-content independent grants, account/vault
separation, concurrent/default-policy updates, already-running Local
completion, root writer ownership, interrupted creation, old-state/key recovery
and source retention. Then wire CLI, actual TUI and hidden desktop switching
and packed external SDK tests. Use generated names/accounts only; no personal
authorization or real microphone. No wider routing/containment claim follows.

The initial generated persistence/controller prototype passes in **648.40 ms**:
two immutable scoped views share one SQLite authority but cannot read foreign
events/blobs/receipts or erase same-ID grants; actual generated worker turns,
drafts, artifacts, derived attention and budget ownership remain separate.
The root-authority gate subsequently passes seven SDK/policy/resource cases
in **3,376.12 ms**, including real cross-profile reservations, Local finishing,
no new-profile policy window, physical writer/quarantine ownership, setup
recovery and injected global-transaction rollback. These are prerequisites,
not yet complete client/profile qualification.

The expanded pre-UI gate passes **12** generated checks in **4,713.89 ms**.
It additionally covers initialization during a global policy update, one
verified public dependency archive across profile caches, one generated shared
speech-weight download with isolated preferences, and actual scoped SDK/WebSocket
behavior. Default's published runtime is still the separately qualified 0.7
alpha; profile UI/CLI, legacy migration and packed scope tests remain required.

The expanded authority/migration gate now passes **19** generated checks in
**5,364.74 ms**, including real schema-13 upgrade with byte-identical Default
ciphertexts/keys/receipts, injected migration rollback/reopen, memory/style
isolation on a shared physical repository, expired cross-profile approvals,
actual opaque global-capacity refresh and concurrent revision races. The real
TUI creates/renames/switches clients while preserving the old draft, and the
CLI covers explicit/inherited scope without changing another client.

Full Default/profile regression passes **229** local checks in **158,227.87
ms**. Hidden desktop verifies old-work continuation, input-inert handoff,
independent dirty budget forms, native startup/profile-bound notification
navigation, preview partition identity and stale-close/foreign-session
rejection. A fresh packed external consumer installs/audits with no findings
and proves immutable JS scope, actual installed CLI selection, compiled model
workers in both profiles, isolated ledgers/MCP/runtime resources and global
capacity/defaults. The initial asynchronous global-budget acknowledgement
clear and an obsolete Default-only UI test label were corrected explicitly;
neither failed run was counted as a pass. Versioned macOS package and exact
delivered-archive qualification remain separate below.

The actual **0.8.0-alpha.1** macOS arm64 app passes all **19** hidden Electron
workflows in **44.0 s**, including its compiled workers, inert handoff and
profile-bound native preview/notification paths. Strict ad-hoc signature,
bundled runtime/assets and actual DMG integrity checks pass. A fresh
approved/audited installation of the exact delivered SDK archive separately
passes the two-profile worker/accounting/MCP-credential checks and a new
profile's inherited global environment restriction, with zero audit findings.
Only generated providers, credentials, roots and data were used. No real
authorization, microphone, speech weights, native VM or production trust
change was involved. [Setup](../setup.md#verification-and-packaging) records the exact artifact
hashes; qualified 0.7 artifacts remain unchanged.
