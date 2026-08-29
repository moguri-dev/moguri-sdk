# Repository State

- This repository is currently a documentation-only pre-alpha: it has no application source, manifests, lockfiles, tests, CI, or verified build/lint/test commands. Do not describe roadmap features as implemented or invent commands.
- `0-implementation-draft-unslopped.md` is the newest build brief. Use `0-implementation-draft.md` for expanded detail and `README.md` as the earlier feature inventory; reconcile conflicts in favor of executable code/config once those exist.
- Moguri is intended to begin from the OpenCode codebase, but that upstream baseline is not present in this checkout. Before adding Moguri features, follow Phase 0: import/inventory the baseline, reuse working upstream behavior, and create `docs/architecture/upstream-capability-map.md`.

# Implementation Constraints

- Work in the documented phase order and implement the smallest complete vertical slice across the local service, TUI, and desktop; do not pull items from "Later work"/"Deferred work" ahead of first-release acceptance checks.
- The local control plane is authoritative. TUI, desktop, and optional VSX clients must share one typed API, domain model, and event stream rather than owning client-only state or provider payloads.
- Durable state is a typed, append-only, versioned event stream. Durable schema changes require migrations and restart-recovery coverage; never make users delete local state to upgrade.
- Keep artifacts independent of session retention, profiles isolated, secrets in an explicit secret backend, and estimated, provider-reported, and billed costs in distinct fields.
- Cancellation must propagate through owned work and preserve requested, acknowledged, completed, failed, and partial outcomes. Never record stopped or partially cancelled work as successful.
- Push, merge, rebase, branch deletion, scheduled work, and self-modification require explicit user action or policy.

# Change Contract

- Before a feature change, identify reused upstream components, new invariants/events, schema and migration impact, cross-client behavior, failure/cancellation behavior, and the tests that prove it.
- Test concurrency, cancellation failure, migrations, and restart recovery where relevant, not only happy paths; use generated fixtures without personal or customer data.
- Put durable architecture documentation under `docs/`. Update the relevant setup, configuration, architecture, or protocol document in the same change.
- Once an executable toolchain lands, update this file with exact setup and focused/full verification commands; none are currently verifiable.
