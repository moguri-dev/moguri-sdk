# Reviewed dependency cache scopes

This extends the original cache slice in
[`workspace-platform.md`](workspace-platform.md). Its initial public-only,
single-project exclusions are superseded for the npm/pnpm formats qualified
below, not for arbitrary package managers or executable builds.

## Phase 0, 2026-10-22

Before implementing these adapters, generated native-manager qualification on
macOS arm64 used Node 26.11.1, Python 3.15.0 / pip 26.2.1, Cargo/rustc 1.99.1,
and Go 1.27.3. `node --import tsx scripts/dependency-cache-spikes.ts` passed in
338 ms: pip hash-locked binary-wheel download 170 ms, Cargo locked archive
fetch plus offline reuse 93 ms, and Go module download / h1 / offline reuse
18 ms. Fixtures are synthetic, with an isolated home and loopback registry.
Neither the hostile crate build script nor dependency Python/Go code ran.

Two initial fixture failures were corrected before relying on the primitives:
macOS tar metadata outside a crate root was rejected by Cargo, and Go's
read-only extracted module directory prevented ordinary cleanup. The fixture
now emits ustar without resource forks and uses native `go clean -modcache`
for its owned generated cache. These are fixture qualification results, not
permission to unpack unverified archives or run project builds.

The existing generated npm/pnpm cache spike passed before this change.
Native SendBox executable presence is not workload qualification. These
adapters never treat process groups as containment and do not execute package
lifecycle hooks, Python source builds, Cargo build scripts/proc macros, or Go
builds on the host.

## Change contract

Reuse cacache 21.0.1 (ISC), semver 7.8.5 (ISC), YAML 2.9.1 (ISC), Node's crypto,
HTTP and filesystem primitives, the existing SecretVault/keychain abstraction,
and maintained native npm, pinned pnpm (MIT), pip (MIT), Cargo (MIT/Apache-2.0)
and Go tooling (BSD-3-Clause). No new library or installer dependency is added.

Registry authorization is profile-owned and resource-bound. Tokens live only
in the explicit secret backend, not configuration, plans, receipts, URLs or
logs. Custom-registry archives never enter the public CAS: the namespace binds
the actual profile, registry identity/revision, credential generation and
reviewed package resources. Private-name advisory sharing requires a separately
reviewed destination and opt-in. Redirects never forward authorization.

Plans bind exact root/member manifest and lock bytes, resolved sources, registry
authorization and implementation policy. The canonical root path, device and
inode are bound even when replacement files have identical bytes. Native plans
also bind the actual configured tool and its reported version. Approved
workspace links are the only local dependency references admitted. Mutable
installs remain root-local.
The SDK/control plane owns all state; desktop and terminal clients use the same
typed queries, commands and jobs. Registry saved/removed events extend the
append-only projection under protocol/schema 41 without changing existing
derived cache SQL rows. Existing events/receipts migrate without being rewritten,
and interrupted jobs retain their restart-recovery behavior.

Cancellation may retain already verified immutable archives, never a successful
receipt or an automatic retry. Preparation checks advisories on every reuse.
Installs recheck the exact plan before publication; failures preserve the old
tree or a protected, explicitly reported backup. Interrupted installs remain
partial through the existing job recovery path. Native-cache-only ecosystems
never report an installed environment or a successful build.

## Typed configuration and clients

`PackageManager` is `npm | pnpm | python | cargo | go`. Existing
`cache.inspect`, `cache.prepare` and script-free `cache.install` argument shapes
are unchanged. `DependencyPlan.mode` distinguishes script-free installs from
cache-only preparation. Its optional manifest list exposes every exact input,
`registryScopes` exposes the reviewed source/disclosure boundary, and native
readiness includes an offline cache recipe rather than a fabricated build
capability.

The browser-safe SDK factory is `createCacheApi(sdk)`:

- `cache.registries.list()` returns masked credential readiness.
- `save(config, expectedRevision = 0, registryId?)` reviews a name, exact HTTPS
  registry resource, exact npm package names or `@scope/*`, advisory batch URL,
  and `sharePrivateMetadata` choice. Ambiguous overlapping resources are denied.
- `setToken(registryId, token)` and `clearToken(registryId)` operate only on that
  profile's explicit secret backend. Neither returns the token.
- `remove(registryId, expectedRevision)` revokes authorization. It does not
  silently delete retained archives or mutate projects.

These map to `cache.registry.save/remove/token.set/token.clear`, with
`cache.registries` as the query. `cache.registry.saved` stores
`{ registry: DependencyRegistry }`; `cache.registry.removed` stores
`{ registryId }`. Configuration is profile-level, not a project's retained
artifact. Registry identities cannot be adopted from another profile.

Every configuration edit and token change creates an opaque credential
generation and invalidates old plans. Configuration edits require entering a
token again. A token generation is **not** a token hash or account guess:
private cache access binds the exact profile-owned reviewed registry/resource
and the exact keychain record admitted for that generation. Credential changes
abort active generation-bound requests before any late result is admitted.
Missing/revoked credentials cannot reuse an old private namespace.

Desktop renders the same typed plan, manifest tree, private disclosure review,
masked token controls, cache-only readiness and native recipe. Terminal/CLI and
packed consumers use those same service commands, not ambient package-manager
configuration. C# is explicitly deferred. Yarn was not requested and is not
added.

## Qualified formats and actual native consumption

| Manager | Reviewed inputs and source | What preparation/install actually does |
| --- | --- | --- |
| npm | `package.json`, npm lock 2/3, exact root/member manifests; public npm or explicit private HTTPS registry | Verify lock SHA-512, audit exact versions, populate the appropriate public/private native npm cache, then optionally run offline `npm ci --ignore-scripts` in clean staging. |
| pnpm | Lock 9, complete exact importers/snapshots, root/member manifests and optional packages-only `pnpm-workspace.yaml` | Verify SHA-512 archives and install via pinned native pnpm. Only the validated staged lock's artifact URLs are rewritten to a bounded, verified loopback mirror. Package identities, versions, membership and integrity stay bound to the original reviewed lock. |
| Python | `requirements.lock` when present, otherwise `requirements.txt`; exact `name==version --hash=sha256:…` lines; optional root requirements/`pyproject.toml` also bind the plan | Resolve only matching public PyPI binary wheels, preserve original SHA-256 pins, verify SHA-512 CAS on reuse, then make native pip consume those wheels with `--no-index --require-hashes --only-binary=:all:`. Publish a wheel cache, **not** a virtualenv or installation. |
| Rust/Cargo | Single-package `Cargo.toml`, `Cargo.lock` 3/4 with original crates.io source and SHA-256 checksums | Native Python 3.11+ `tomllib` parses the manifests without evaluation. Fresh exact crates.io index records must match the lock checksum. Native `cargo fetch --locked` consumes only a generated verified mirror, followed by native offline reuse. Publish a native `CARGO_HOME`, never a `target` tree or build. |
| Go | `go.mod`, exact `go.sum` module and `/go.mod` h1 pins; fixed public Go proxy | Fetch pinned module resources without redirects or credentials. Native Go verifies original h1 checksums and must leave both input files byte-identical. `GOTOOLCHAIN=local`, `GOENV=off`, `GOWORK=off`, `GOVCS=*:off` and no proxy fallback prevent implicit toolchain/VCS access. Publish a native module cache, never a build cache or executable. |

Python recursive requirement includes, markers, editable/URL dependencies and
sdists are rejected, not silently skipped. Pip must resolve the complete
hash-pinned dependency closure from the verified wheel set; unsupported host
wheels fail rather than trigger a source build. Optional project metadata binds
the plan but is not copied into pip's working directory or interpreted as
installer/build configuration.

Cargo workspace/path/Git/alternate-registry/patch/replace inputs are currently
rejected explicitly. npm/pnpm workspace support does not imply Cargo workspace
qualification. Cargo runs with an explicit private `CARGO_HOME` and a
filesystem-root working directory plus explicit manifest path, avoiding
hierarchical project/personal `.cargo` configuration. A root-level Cargo config
blocks readiness. The retained cache config defaults to offline; its exact
generated mirror identity remains useful for native offline consumption after
the mirror stops. It is not a live external registry or credential grant.

Go `replace`/`exclude` directives and workspace escapes are rejected. `GOSUMDB`
is off in managed preparation: the **reviewed original `go.sum`** is the native
checksum authority, and no additional dependency-name disclosure to a sum
database is inferred. Missing/changed pins fail rather than extending the
lock. Native `go list -m` checks the original `/go.mod` h1 for every exact
entry, including non-selected historical metadata; explicit native downloads
check every zip-pinned version before closure/offline validation. Nothing is
cached merely because an unused sum entry exists. Metadata/artifact/source
identity is part of CAS keys; the same name and version under a different
source or checksum never substitutes.

All native managers receive isolated homes/config/cache locations and an
allowlisted environment. Missing tools produce actionable readiness, not a
different ecosystem, source format, runtime, or unchecked success. Existing
protected-env policy still applies. These cache APIs do not expose source
builds even when a `sendbox` executable happens to exist.

## Workspace publication and recovery

Workspace discovery is bounded and binds complete membership. Only explicit
in-root members or bounded `*` / `**` directory patterns are admitted. Symlink
members/ancestors, traversal, undeclared lock importers and arbitrary local
resolutions fail before networking. Local links must identify an exact reviewed
member by package name and path. Member version/specifier/lock disagreement
also fails. Repository scripts, `.npmrc`, `.pnpmfile`, patches, source files and
unreviewed workspace settings are never copied into native staging.

Managed installs own the canonical workspace root. Root and member
`node_modules` trees use same-filesystem atomic renames under that exclusive
lease; the multi-root operation records a flushed publication journal and keeps
all previous trees until completion. A later failure rolls earlier roots back.
An unconfirmed rollback retains protected backups/journal and reports partial,
never success. A restart/interrupt does not replay the transaction. An old
`.moguri-dependencies-*` staging/publication blocks a new install until its
retained evidence is explicitly reviewed and cleaned.

Native cache generations similarly publish complete verified manager-consumable
trees, with serialized publication for concurrent identical plans and retained
previous paths if restoration is unconfirmed. SHA-512 verification is performed
on every CAS reuse; original npm/Python/Cargo hashes and Go's native h1 check
remain independent gates. Mutable virtualenv, node_modules, target and Go build
trees are never shared as dependency caches.

## Local acceptance

The focused generated suite passes original cache behavior plus real multi-member
npm/pnpm installs, private authenticated npm/pnpm reuse, cross-profile and
credential-generation isolation, exact resource denial, redirect/header denial,
private-name disclosure opt-in, advisory revocation, changed member manifests,
workspace symlink/traversal rejection, later-member rollback, protected
interrupted journals, masked registry commands and restart retention.

Python/Cargo/Go native tests consume the **published** caches using the actual
native managers after preparation. They verify archive reuse, advisory
revocation, poisoned SHA-512 cache reads, native Go h1 mismatch even when an
attacker supplies a fresh matching CAS hash, missing-runtime readiness, and
denied Go replace/source inputs. No personal project, authorization, registry
credential or microphone is used. These results are generated qualification,
not a throughput benchmark or proof of sandbox containment.

Final verification on this generated worktree passes **21 cache-specific tests**
and **36 tests** when combined with managed-workspace and platform migration/
restart coverage (approximately 6.7 seconds). It includes concurrent native
publication, actual cancellation, binary-only denial without a source-build
fallback, unchanged-byte physical-root replacement, and secret-backend error
redaction. Root and TUI `npm run typecheck` pass.

Fresh qualification repeats pass: the npm/pnpm spike under the pinned Node
26.12.0 takes approximately 456 ms for a 557-byte generated archive; the native
pip/Cargo/Go spike takes 367 ms (196 / 95 / 18 ms). The legacy spike now uses
project-local scratch, isolated homes and explicit empty npm configuration. Its
first in-repository attempt exposed pnpm's ancestor-project path inference;
giving the generated scratch its own package identity and ignoring ancestor
workspace configuration corrected that fixture before accepting the pass.
