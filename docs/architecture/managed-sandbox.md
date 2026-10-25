# App-managed Sandbox

This checkpoint replaces developer-facing setup and mandatory per-turn source
previews with a reviewed, app-managed native configuration. It does not weaken
the user-only Env policy, tool approvals, budgets or original guest ownership.
The local service remains the authority for desktop, TUI, CLI and SDK clients.

## Prerequisite measurements

The historical generated distribution spike uses the exact public SendBox 0.2.3 arm64
archive, freshly verified against SHA-256
`ab9508dffa9f3299621248d6cff8efb8fd84b44556f630b6e343329ab1eafb3e`
and its GitHub attestation. No personal model credential, inference, admin
dialog, real profile change or unrelated guest is involved.

| Primitive | Actual result before feature integration |
| --- | --- |
| Bundled user-owned CLI identity/version | PASS, exact release binary/manifest/key hashes |
| User-owned guest bundle | FAIL as required: released signed guest artifacts require UID/GID 0; no owner-check relaxation |
| OCI image export/import | PASS, 420,864,000-byte archive, 838.02 ms; exact original digest retained without removing any shared image |
| Bundled CLI with already reviewed root-owned guest | PASS, Linux Node 26.12.0, actual Node-PTY, non-root/NNP/seccomp/capability controls, signed after-state and exact VM absence, 1,138 ms |
| Versioned macOS component package | PASS, 16,381,455 bytes, root-owned BOM, no installation scripts; package creation/inspection only, not a privileged-install claim |
| Existing manual source capture with 201 files | FAIL as expected: the 200-file/2-MiB text-preview boundary cannot implement automatic project snapshots |
| Prepared Copilot endpoint under canonical API-only scope | FAIL before inference; `api.individual.githubcopilot.com` currently aliases `api.githubcopilot.com`, whose next alias is separately resolved |

The combined positive/expected-negative spike completes in **3,315.87 ms**.
Its earlier failures remain retained, including root-ownership refusal and an
ambiguous empty after-state; a unique generated witness makes signed after-state
binding verifiable rather than treating ambiguity as success.

`npm run spike` also ran the existing foundation: generated provider transport,
SQLite/event and UI/process/filesystem baselines pass. Its unavailable live
Copilot/ds4, Rust/Linux, notarization, configured decision/multi-model/SSH and
historical first-checkpoint gates remain failed, not relabeled as this native
qualification. No live login or unrelated roadmap capability is inferred.

```sh
node --import tsx scripts/managed-sandbox-spike.mjs \
  --workload /absolute/path/to/current/qualification.json \
  --archive /absolute/path/to/pinned/sendbox-0.2.3-macos-arm64.tar.gz \
  --installation /absolute/path/to/reviewed/root-owned/installation.json
```

## Distribution and installation

The macOS app carries a compatible immutable OCI worker archive, including
Moguri's compiled worker/bridge, Linux Node and locked native dependencies.
It also carries the pinned public SendBox 0.2.4 release and a no-script component
installer. A bounded distribution descriptor binds protocol, actual worker
bytes, OCI index/archive hashes, vendor archive, CLI/key/manifest and installer
hashes. Source/embedded runtimes can explicitly supply this same descriptor;
missing bundled artifacts are an explicit setup limitation, not a mutable pull.

### Default SendBox 0.2.4

Factory management and the packaged producer now select the requested stable
[0.2.4 release](https://github.com/mbianchidev/sendbox/releases/tag/v0.2.4).
The 16,582,697-byte macOS arm64 archive matches its adjacent checksum and verified
GitHub artifact attestation, whose source is tag `v0.2.4` at
`5e83a179ed83ef2b3b184b60b7fef82105aa504c`.
SendBox remains Apache-2.0; no Node dependency or durable schema changes.

| Exact release identity | SHA-256 / value |
| --- | --- |
| Public host archive | `94168cd57db14740a49fbdae88e63d7d5aa99f61da4ff47b1863d2058e774b31` |
| Host executable | `cfa71d5db3ec747ab785c86c6d79dce174893955066ff80ecf6eab827afd2e73` |
| Existing trusted guest key | `998a6a606edb6afa7f8db6ea64949e39acfec30f70bbfdfc37c47391e5b85a88` |
| Signed guest manifest | `afdf6182b6935322454ccc4d0f8426fafadcc1dbe27a35c88963646e1b34b91d` |
| Trust root / minimum release sequence | `external-release-root` / `8` |

Actual artifact inspection verifies the unchanged Ed25519 root, host/guest
0.2.4 binding, every signed guest byte/mode and the real CLI version/help before
any executable admission. This does not claim privileged installation or a
live 0.2.4 guest. Earlier 0.2.3 VM/network measurements remain historical.

The producer cache binds the exact vendor pins, current Moguri protocol and
worker/dependency payload. Old cache pointers are misses, not authority to reuse
0.2.3 as 0.2.4; matching entries still reverify actual package/image bytes and
vendor identity. Old distribution artifacts and explicitly retained 0.2.3
settings are not deleted, rewritten, implicitly installed or switched.
Fresh use of the new bundle retains the original setup review, side-by-side
administrator approval and readiness gates. The owner explicitly chose to keep
the 0.2.4 default `github.com` grant with clear Meta disclosure: it delegates
GitHub Meta domains and IPv4/IPv6 CIDRs, including shared-cloud ranges, refreshed
before readiness and hourly. This is broader than exact-host-only egress and
must not be described as strict GitHub-only access.

The service places that warning into the version/network-bound review
diagnostic, hence its canonical digest; desktop shows it before Enable Sandbox
and its user/network-policy acknowledgement. CLI/TUI/SDK use the same review.
Existing 0.2.3 reviews retain their earlier exact-host semantics. The decision
does not grant tool permission, a new wildcard, provider credentials or Local
fallback. Artifact/package verification does not claim an actual 0.2.4 guest
or dynamic effective-scope qualification.

#### Default-update qualification

Source `10f7708` passes the release-specific SDK, state, review, archive-safety
and generated network gates, including explicit old-version preservation and
the version-bound Meta warning. The source and compiled inputs remain unchanged
during its complete desktop and package checks.

| Check | Observed result |
| --- | --- |
| Generated native setup/default/cache/recovery gate | 24 passed, 7 physical-native skips; zero failures |
| Shared settings/reopen/regression gate | 32 passed; zero failures |
| Meta-review/default/scope follow-up | 29 passed; zero failures |
| Complete hidden Electron suite | 121 passed, 2 physical-native skips; zero failures / 4.4 min |
| Actual rebuilt packaged Meta review and consent | 1 hidden case passed / 2.4 s |
| Packed external SDK and installed workers | All entrypoints/client paths and all 12 worker probes pass |
| Old packaged 0.2.3 under the new exact-pin gate | Correctly refused before execution |
| Actual 0.2.4 producer cache hit and retained old 0.2.3 | PASS / 565.39 ms; same exact new directory reused, old artifacts preserved |
| No-cache Linux arm64 worker payload/synthetic PTY | PASS / 42.09 s |
| Actual package/native-distribution/update ZIP/DMG | PASS; exact 0.2.4 vendor/default/BOM checked; 740,556,177-byte ZIP verified in 102.15 s |
| Type checks, production build and dependency audits | PASS; zero vulnerabilities |

The final image is
`docker.io/library/moguri-worker@sha256:98168acab62b1b3891671add0c224cdccf4a8dae843b0acc35c64fe19cf55377`.
The GitHub attestation check binds the hosted
`mbianchidev/sendbox/.github/workflows/release.yaml` workflow, exact tag and
source commit, rejecting self-hosted runners. The actual packaged Node/service
discovers bundled 0.2.4 without credentials, keychain use, an administrator
dialog or model request. Artifact/package verification is not physical 0.2.4
guest/network qualification or Linux release readiness; those gates remain
explicit. The app is ad-hoc signed, not notarized. Previously documented
non-blocking chunk/icon and external-host npm override notices remain unchanged.

The primary Settings flow shows these actual defaults and requires review and
approval, not JSON authoring, a developer build or a SHA command. A matching
explicitly configured root-owned installation can be reused after verification.
Fresh installation uses `/opt/moguri/sendbox/<version>` side by side and requests
the user's administrator approval. Existing Homebrew/other SendBox installations
are not overwritten. The service never types a password or approves OS dialogs.

Only a reviewed no-script package may reach the privileged installer. Copy it
to a new root-private exact operation directory, verify its reviewed digest there,
then invoke the system installer. Do not execute a user-writable Node/helper as
root. Reverify the actual installed CLI, signed guest manifest/artifact ownership,
key and exact version before activation. Missing or changed bytes, cancelled
authorization, lost completion and interrupted image import stay explicit;
original intent is retained and no installation is replayed on restart.

Public-release checks use only the fixed public SendBox repository, no Copilot,
CLI or private updater token. Automatic checks run at startup and every four
hours when enabled; manual checks use the same API. The selected runtime version
is never silently changed. New archive/asset hashes, signed guest release,
root/sequence and compatible current worker are reviewed before installation.
Keep previous version directories and active executions intact. A new version
or trust root is not authorized merely by its presence in a release feed.

## Automatic workspaces

One explicit managed-setup approval enables automatic private workspaces.
Existing manually pinned settings retain their original narrow semantics until
the user opts into managed operation. Advanced exact-path preparation remains
available but is not a prerequisite in the managed chat flow.

Before an owned turn's worker can launch, the service prepares or verifies its
Moguri-owned private stage. Project-free chats get an empty root-less stage.
Project sessions snapshot their actual bound Local project/worktree, never a
base-checkout fallback. Respect protected paths, nested ignore rules, symlinks
and folder policy. Use bounded regular-file metadata/copies rather than expanding
the reviewed text/context API or silently truncating a project. Large/binary
files do not become model context merely by being present in a private workspace.

Never mount the live source: SendBox rollback can replace the mounted directory.
Preserve original file digests/modes, private stage identity and independently
retained actual results. Reuse a valid private workspace across successful turns.
After rollback, preserve retained work and rebind only from verified original
snapshot evidence; unknown or incomplete work must stop rather than disappear.
Source publication remains a separate exact byte/base/policy-checked action.

Preparation belongs to the actual turn, not a fabricated user file-review.
Stop, profile/session removal and shutdown must abort it before worker admission.
Session/project deletion waits for the original admission and workspace-preparation
owners to settle. Unacknowledged cancellation refuses deletion within the bounded
cleanup window and preserves the source state; an abort request is not completion.
Changing root, policy, settings, mode or ownership while copying cannot admit a
stale stage. Restart retains partial intent and holds queued prompts without
replaying copying, model calls or effects. No model budget is consumed by setup.

## Provider and tool networking

The screenshots' website prompts failed at provider admission, before either
website was contacted. Managed engine qualification is local and does not contact
Copilot or any unselected provider. Legacy manual cold-provider qualification
keeps its explicit prior semantics. Resolve the actual prepared provider HTTPS resource
before launching a managed guest. Do not assume every Copilot account uses
`api.githubcopilot.com`; configured hosted provider endpoints use their own
actual transport. Controller loopback endpoints are not guest endpoints.

Managed setup explicitly authorizes automatic selected-provider endpoints and
their bounded public DNS CNAME chains. Resolve only actual admitted provider
resources, never names supplied by model text. Reject malformed credentials,
wildcards in provider URLs/aliases, IP/private/metadata destinations, cycles and
excessive chains; do not override a deny policy. Capture the effective exact scope
with its original execution and recheck the provider before handing over any credential. A changed
endpoint/alias during a turn cannot launch another guest, replay a paid role or
silently broaden its already installed policy.

Default tool grants include `github.com` and `api.github.com`. The earlier
0.2.3 qualification rejected unrelated `google.com`; 0.2.4's disclosed GitHub
Meta delegation is broader and those old exact-host guarantees are not carried
forward. Provider aliases are not a general wildcard or approval
for web/MCP/browser features without a qualified native transport. Show effective
provider hosts separately from manually configured tool destinations.

The approved native `fetch_page` reader uses the actual enforced proxy and normal
tool authorization, works in project-free chats, follows only bounded safe HTTPS
redirects and returns untrusted text. It does not enable interactive browser or
general MCP transports. The final generated native network probe reads GitHub,
observes Google's policy-denied SOCKS reply and checks the actual prepared Copilot
resource without credentials or a model call.

## Shared schema, ownership and verification

Use an additive protocol/database migration, versioned setup-operation records,
managed settings and captured network/preparation provenance. Preserve existing
events, encrypted grants, command receipts and manual configurations. Old
executions retain their original exact policy; settings changes never rewrite
their charges, destinations or signed guest. New blob references must receive
their owning encrypted retention grants in the same event transaction.

Reuse Node, maintained pi-ai, Node-PTY and TypeBox (MIT), existing ignore rules
(MIT), SendBox (Apache-2.0), system package tools and maintained node-tar
(BlueOak-1.0.0). Do not add another worker loop, VT renderer or custom TAR parser.
Cross-client tests cover migration/reopen, pre-admission cancellation/races,
stale/changed source and binary bounds, refused aliases/private addresses,
actual allowed GitHub/denied Google egress, wrong artifact/package identity,
cancelled/lost install, no replay, root-owned guest checks and packaged cold
setup with generated fixtures. Actual administrator interaction stays manual.

## Explicit wildcard prerequisite

Before changing Moguri's exact-host adapter, the actual pinned SendBox 0.2.3
guest/proxy was qualified with only `*.github.com` and `*.githubcopilot.com`
tool rules. In **4,586.82 ms**, the anonymous GitHub API returned HTTP 200,
the nested `api.individual.githubcopilot.com` resource returned HTTP 400, and
`github.com`, `githubcopilot.com`, `notgithub.com` and `google.com` each returned
policy-denied SOCKS reply 2. Signed completion, native process controls and
original owned VM absence passed on the same immutable worker image below.
No credential, inference, administrator prompt or personal-profile change was used.

The first attempt used the page reader's Accept header and failed its
application response check after **3,405.03 ms**; its original signed owner and guest absence were
verified separately. The successful probe uses the API's documented media type,
not a wider network rule. Run the prerequisite with `--wildcards` on
`scripts/managed-sandbox-spike.mjs`; this qualifies the released wildcard
primitive, not the separately developing GitHub Meta expansion.

Moguri forwards an explicitly reviewed tool rule such as `*.domain.com` without
expanding it into an apex, a host list or another wildcard. Exact entries remain
exact. The native runtime enforces DNS-label boundaries and private-address
protections. Actual provider URLs and CNAME hosts stay exact, including when a
matching tool wildcard is present; they cannot be relabeled as wildcard provenance
or inherit credential approval. Captured settings/rules and their review digest
remain unchanged through reopen, and revocation still invalidates admission.
The existing typed string fields/events are sufficient: no new durable shape,
migration, dependency, worker loop or release pin is introduced.

The adapter at `9670646` passes type checks/build and **28/28** focused
policy/network/setup/client/migration/reopen/cancellation checks in
**14,539.68 ms**, with no skips. Its **9/9** actual native SDK setup, wildcard-bearing
multi-turn editing, root-less execution, rollback/restoration, cancellation and
SIGKILL recovery checks pass in **38,951.23 ms**, with no skips.
The packed external SDK and approved/audited installed consumer pass again.
The actual packaged review/autosave and wildcard-bearing no-preview chat pass
**2/2** hidden desktop checks in **20.0 seconds**.

The same unchanged worker/image and root-owned no-script installer pass packaged
Node/service/resource discovery in **4,673.06 ms**. The updated
**744,768,834-byte** ZIP passes the bounded production updater in
**102,215.62 ms**, and its read-only DMG passes the real Applications layout
check. These are focused follow-up measurements, not a claim that the earlier
complete suites below were rerun. Those 0.2.3 measurements did not enable or
qualify GitHub Meta. The later 0.2.4 default and explicit review disclosure are
documented separately above.

## Earlier managed-setup qualification

The complete checkpoint at `fd8c1ee` passed **1,211 unit/native tests**, with no
failures or skips, in **1,179,127.55 ms**. Its complete hidden desktop suite passed
**107 tests**, with no skips, in **4.3 minutes**. These are baseline measurements
before the final deletion-ownership correction, not a claim that the complete
suites were repeated after that change.

The final executable at `51c505c` adds the original native-admission/preparation
owners to session/project deletion settlement. Its generated regression fails
without the guard: deletion succeeds while its original provider preparation is
still held. With the guard, deletion waits for acknowledgement; ignoring
cancellation instead produces `cleanup_unconfirmed` and preserves the session.

| Final qualification after the correction | Result |
| --- | --- |
| Type checks and production build | PASS |
| Focused automatic setup, migration, session and deletion checks | 30/30, no skips; 13,982.65 ms |
| Genuine native setup, project/root-less turns, private edits, cancellation, rollback/restoration and controller SIGKILL recovery | 9/9, no skips; 46,452.27 ms |
| Packed external SDK entrypoints/types/runtime and approved, audited consumer installation | PASS |
| Actual packaged managed-review/autosave and no-preview native chat | 2/2 hidden desktop checks, no skips; 17.7 seconds |
| Bundled Node/service path-free discovery, exact worker bytes and root-owned no-script installer BOM | PASS; 4,684.98 ms |
| Final 744,768,529-byte ZIP through the bounded production updater | PASS; 97,663.03 ms |
| Actual read-only DMG and drag-to-Applications layout | PASS |

The unchanged immutable worker image is
`docker.io/library/moguri-worker@sha256:7fe078f11ffdf21f99fd569dabfa8d65e9adb7469702e57f607d5050ec133e3e`.
Its bundled OCI archive is **421,990,400 bytes**; the SendBox 0.2.3 installer is
**16,381,472 bytes**. The independent genuine network probe on this image
completed in **4,937.18 ms**: GitHub content was readable, Google returned
policy-denied SOCKS reply 2, and the actual individual Copilot HTTPS resource
responded anonymously with HTTP 400. The original signed owned VM was absent.
This proves the admitted transport/egress boundary, not live paid inference.

Managed fixtures use generated state, intercepted provider responses and generated
credentials; the network probe uses anonymous public endpoints. No personal
profile, login, administrator authorization or paid inference was used. Packaged
service discovery also forbids network and keychain access. Real native execution
reuses the previously reviewed root-owned release;
the fresh administrator installation path was package/BOM/command-inspected,
not interactively installed. The macOS app remains an ad-hoc-signed development
build, not notarized. General native browser/MCP/console, multi-model and Max
transports remain outside this qualification.
