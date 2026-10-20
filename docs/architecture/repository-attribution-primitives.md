# Repository attribution prerequisites

The post-0.15 audit found safe Local/SSH Git views and exact GitHub issue/PR
reads, but no durable repository/organization/visibility attribution or usage
filters. `ProjectIntegrations.githubRead` still permits only selected issue/PR
endpoints. The new private prototype is not an application capability and does
not broaden that production whitelist.

## Reused implementation and data

Reuse the existing Node service/SQLite/SDK authority, `readWorkspaceGit`,
profile-bound session/worktree resolution, pinned SSH `session.git` transport,
bounded redirect-denying HTTP reader and strict result validation.
Node/TypeBox are MIT-licensed and SQLite is public domain.

The pinned `spdx-license-list` **6.12.0** dependency is **CC0-1.0**, has no
installation hook or runtime dependencies, and publishes SPDX License List
**3.28.0 (2026-02-20)** metadata with explicit `osiApproved` flags. The npm
registry reported this as the current version, modified 2026-07-24, when
qualified. Import metadata only, not license texts. The installed package is
about 10.5 MB unpacked because it also distributes texts; this prototype does
not load those texts or fetch license data dynamically.

The generated projection's `publicOsiLicensed` means only **observed public
visibility plus a recognized OSI-approved detected SPDX license**. It is not
a legal/compliance review or proof that every file has that license. Missing
or unrecognized detected licenses remain null. Public visibility alone does
not establish this category. Owner organization status comes from the exact
repository response, never from the owner's name.

## Measured result

`node --import tsx --test tests/repository-attribution-primitives.test.ts`
passes **7 checks in 971.74 ms** on the current macOS arm64 host with
Node 26.11.1. Both repository type checks pass; the dependency installation
audit reports zero vulnerabilities.

- Exact repository owner/name/URL/ID and recognized visibility are checked,
  with explicit user/organization and pinned OSI data. Unexpected identity,
  unsafe integers, inconsistent public/private flags and malformed evidence
  are rejected. Description, credential-bearing clone URL and generated
  private markers are excluded from the allowlisted projection.
- A bounded credential-free public lookup passes its abort signal, rejects
  redirects/non-success/malformed/oversized responses and rechecks the
  reviewed root/policy binding after await. Changed bindings and late
  cancellation discard the result without another lookup or persistence.
- Actual safe base/worktree Git reads with hooks/filters disabled complete
  in **51.16 ms** for two bindings in the measured final run. Worktree-only
  effective URL rewriting yields its own repository; credential-bearing
  origins yield no supported identity. No hook/filter marker is created.
- Actual pinned generated SSH Git reads return the remote repository, not
  the different host checkout, with **zero model calls**.
- Sanitized fixture metadata is independent of forgotten session contents
  and foreign-profile data. This tests the existing encrypted root retention
  primitive, not a new production metadata ledger.

The initial test intentionally failed without its prototype and then its
declared dependency. The first generated repository had no hooks directory;
the fixture now creates its own explicitly. A subsequent assertion assumed a
worktree `remote.origin.url` replaces the shared multivalued remote setting:
Git still selected the base fetch URL. The corrected fixture verifies
`git remote get-url` first and uses a worktree-scoped effective URL rewrite.
No production Git behavior was changed to satisfy that mistaken expectation.

No live GitHub request, account authorization, paid inference, real microphone,
model download, Sandbox probe or arbitrary checkout was used.

## Before exposing the feature

The application still needs explicit lookup/review actions, exact project/
workspace/Local-or-Remote scope binding, immutable admission-time model/tool
attribution, typed events/migration and restart tests, private credential
boundary qualification and shared SDK/CLI/native TUI/desktop projections.
Never retroactively rewrite old call attribution using today's Git config or
repository visibility. Legacy/failed/missing provenance stays unknown;
repository filters must not alter cumulative charges.

GitHub CLI access and permission to send a private repository identity are
not established by the public fake lookup. Copilot credentials cannot be
reused for another resource. The production interface must make the actual
lookup location/account explicit and must not silently run Local Git/CLI for
a Remote root or use another checkout when a binding changes.
This prerequisite does not complete the repository dashboard or the broader
GitHub workflow integration.
