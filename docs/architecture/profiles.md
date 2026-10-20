# Profile isolation contract

Status: Phase-5 implementation/qualification in progress. The published
protocol-13 alpha exposes only Default; this document does not enable profiles.

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
