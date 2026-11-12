# App-managed Sandbox

This checkpoint replaces developer-facing setup and mandatory per-turn source
previews with a reviewed, app-managed native configuration. It does not weaken
the user-only Env policy, tool approvals, budgets or original guest ownership.
The local service remains the authority for desktop, TUI, CLI and SDK clients.

## Reviewed 0.2.6 distribution, 2026-11-11

The user directed this checkpoint to use published
[SendBox v0.2.6](https://github.com/mbianchidev/sendbox/releases/tag/v0.2.6).
Its source is `12b39ba5b360a68eba5141651b5659f910b1f94a`, directly after
the merged compatibility/security repair in
[mbianchidev/sendbox#85](https://github.com/mbianchidev/sendbox/pull/85).
The exact release lock resolves cap/cap-primitives 4.0.3, hickory-proto 0.26.3
and rustix 1.1.6. The older 0.2.5 advisory findings below remain historical
failures, not a clean audit of those old signed bytes.

The macOS arm64 archive is **16,635,273 bytes**, SHA-256
`37786684e6fb1678b222354e969f173de88fedf2ce3f078f4f003126be0d54a9`.
GitHub artifact provenance verifies the hosted `release.yaml`, exact
`refs/tags/v0.2.6` and source digest, with self-hosted producers denied. The
Git tag itself is unsigned; the separate authenticated artifact provenance
and Ed25519 guest signature are the checks used here, not a SLSA-level claim.
All signed guest artifacts were verified against the unchanged trust-root
SHA-256 `998a6a606edb6afa7f8db6ea64949e39acfec30f70bbfdfc37c47391e5b85a88`.
Host SHA-256 is
`944c590f18744392fdd9cfe2f5b84dbafde6ae45e85c0a32166bb1aadc093f33`;
manifest SHA-256 is
`8654ecc97ea4fa3cfb5dc583a16db273b6df77995c559dc4b57fa6026d3de6b2`,
with release-sequence floor **11**.

The factory, producer, package verifier and current physical qualifier now
select 0.2.6. Explicit saved 0.2.3/0.2.4/0.2.5 selections and their encrypted
history remain unchanged until separate actual-user review. The user personally
installed the reviewed no-script side-by-side package at
`/opt/moguri/sendbox/0.2.6`; exact installed hashes, signature, canonical paths,
root ownership and non-writability were independently verified. No agent
installed software, restarted a service or changed network configuration.

The fresh no-cache worker producer passes in **37,608.90425 ms**. Its immutable
image is
`docker.io/library/moguri-worker@sha256:b6e8ae1de6b78408f852abf9e4d32c297fdb33ad77156ec60059c903379600f2`;
the distribution is `.native/sandbox-distribution/build-j9YeKo`, digest
`48ff73c67086797c6aaf1a51c1b24ba4da66bcbaf343d761f19f36abce818e3e`.
This is exact artifact/producer evidence, not native execution or acceptance
of any nominal cell. The [current qualification record](milestone-combination-matrix.md#current-build-qualification-2026-11-11)
retains all outstanding physical gates.

Reuse remains SendBox Apache-2.0 and the existing MIT Node/SDK/signature/archive
and installer lifecycle. There is no new capability, permission, event,
schema or migration. Sixteen generated setup/update/retention cases and fresh
type/build checks pass; installation is never inferred from an admitted job.

## Selected Apple Container 1.7.1 boundary

During the 2026-11-11 run, the selected Apple CLI/server changed from 0.10.0 to
**1.7.1**. The user explicitly chose the new target and authorized a separate
SendBox compatibility session. Moguri now reads both known immutable image
descriptor layouts and both known container-status layouts. Unknown, mixed,
conflicting or incomplete inventory cannot prove guest absence or readiness;
variant digests and mutable tags cannot stand in for the selected OCI index.
The producer and physical qualification driver reuse those same checks.
This parsing support is **not** physical qualification of SendBox on 1.7.1.

Released 0.2.5 explicitly supports CLI 0.10.0. Its root-owned
`/usr/local/bin/container` was still 0.10.0 while the running server and PATH
CLI were 1.7.1; the misleading startup failure was “builtin network is not
present” even though the actual default network was present. No network
workaround or automatic runtime downgrade was used.

The user personally replaced only `/usr/local/bin/container` with the CLI from
Apple's signed/notarized 1.7.1 package, preserving
`/usr/local/bin/container.moguri-before-471dc42c`. The official package SHA-256
is `b6739caf3d47ca53a78f1a7edf32521420a75c7941838c3cefa75f30b80f5a97`;
the canonical root-owned CLI SHA-256 is
`2e4fdec2272867e2627d4c851a7457e86bf1b8db2d06d8a670f1419f2e85f1df`,
commit `a15b460`, Apple Team ID `UPBK2H6LZM`. No agent-driven service,
plugin, networking or OS installation change was made.

Merged [mbianchidev/sendbox#85](https://github.com/mbianchidev/sendbox/pull/85)
supplies the matched-backend compatibility and audited dependency repairs in
the separately reviewed 0.2.6 release above. The exact released 0.2.5 lockfile has cap-primitives 4.0.2,
hickory-proto 0.26.1 and rustix 1.1.4, the affected versions reported by that
audit. An old archive signature does not establish a current clean advisory
result. The new release and installed artifacts do not replace the remaining
current-payload physical gates. A source change or merged PR cannot accept
Moguri's native matrix. Optional Apple syscall tracing remains unqualified on
the inspected 6.18.5 guest without tracefs/BTF; the opt-in guest-only tracing
capability grant is not enabled for ordinary capability-free workloads.

## Reviewed 0.2.5 distribution, 2026-11-11

The user explicitly approved reviewing and preparing SendBox **0.2.5** after
the current 0.2.4 managed GitHub-scope startup stopped reaching bootstrap.
The unchanged stock adapter reproduced that failure, while provider-only
deny-by-default scope still reached readiness. The earlier ten-gate protocol101
pass remains its original receipt, not proof that subsequent starts succeeded.
No domain grant, timeout, Apple service or Local fallback was changed.

The public macOS arm64 archive is 16,602,384 bytes, SHA-256
`f0eb88069fad1b4d1864750281adebfa63a8d3a454031cea659af32153008666`.
GitHub artifact attestation binds the release workflow and `refs/tags/v0.2.5`
to source `cd7407e66abee3239285e8e75ab85cd21f4304d2`, denying self-hosted
producers. All guest files and their Ed25519 manifest signature were checked
before preparing an installer. The existing public trust root is unchanged:
`998a6a606edb6afa7f8db6ea64949e39acfec30f70bbfdfc37c47391e5b85a88`.
Host SHA-256 is
`726b622306b91c229facfbc24f488b33226a6b467641117dcd8eeb6e876fb495`;
manifest SHA-256 is
`ab3b2ea665809fabb4e87d0fd363aef0cbc9b9d004f95231b6eb93fd083aa39b`,
with release-sequence floor **10**.

At that cut, unconfigured factory defaults and the producer selected 0.2.5. Explicit
0.2.3/0.2.4 selections, signed histories, encrypted events and existing
installations remain unchanged. The shared SDK setup review must still bind
the new runtime/package/worker and the actual user must approve installation
at `/opt/moguri/sendbox/0.2.5`. Preparing the side-by-side no-script package is
not installation, runtime readiness, native matrix acceptance or blanket
reviewed-script qualification.

This reuses SendBox's Apache-2.0 distribution and the existing MIT Node/SDK,
signature, archive, installer and setup lifecycle. There is no new capability,
event, schema or migration; normalization keeps saved release selections ahead
of factory defaults. Generated checks cover exact artifact/cache identity,
retained older versions, stale review, cancellation and restart without
installer/import replay. Current physical results belong in the
[native combination record](milestone-combination-matrix.md#current-build-qualification-2026-11-11),
separate from all historical receipts below.

## Historical qualification reading, 2026-11-10

The first-use/startup failures below are preserved protocol90 investigation
records, not the current universal native status. Merged #60's
[protocol99 exact receipt](session-inbox.md#final-qualification-2026-11-10-utc)
records ten selected gates passing, including real provider/network checks,
retry/checkpoints, three rewind scopes, hidden packaged restoration and
verified owned-guest teardown. It does not qualify every required native
control/input/candidate/loss/client combination, reviewed-script Sandbox
execution or changed app/worker bytes.

The DNS repair mbianchidev/sendbox#80 is merged and included in released
[v0.2.5](https://github.com/mbianchidev/sendbox/releases/tag/v0.2.5)
(2026-11-08). Moguri still pins its reviewed 0.2.4 distribution; this audit
does not install, upgrade, restart or reconfigure a runtime. The
[remaining native matrix](milestone-combination-matrix.md#current-disposition-2026-11-10)
and [acceptance owner #39](../remaining-milestone-gaps.md#remaining-first-milestone-acceptance)
retain genuinely missing qualification without relabeling historical failures.

## First-use readiness follow-up

The user selected first-use approval: choosing an unready Sandbox reviews
the bundled defaults and requests the one-time OS/network consent without
opening configuration settings. After actual qualification, ordinary project-free
chats use the existing empty private stage and projects use their captured
private copies automatically. Customization remains in Settings. This does
not authorize a live installation, administrator dialog, service restart or
personal model request during implementation.

Reuse Node/React/TypeBox under MIT and the existing Apache-2.0 SendBox
distribution. No new dependency, public capability, event, schema or protocol
is added: the flow uses the existing typed setup review/apply/wait and
model-refresh APIs. A review is not installation permission until the actual user accepts
its exact current digest; queue admission is not readiness. Policy, source
ownership, custom versions, interrupted setup and unknown guest cleanup
retain their original guards. No automatic replay or Local substitution.

The prerequisite generated foundation rerun passed before implementation:
six intercepted provider requests with 31.01-ms cancellation; 1,000 SQLite
events with 0.0593-ms append p95 and 0.5051-ms rebuild; owned PTY cancellation
in 151.86 ms with zero survivors; 60 OpenTUI updates averaging 17.28 ms;
hidden Electron opening in 209.20 ms at 446.06 MiB with 8.11-ms scroll frames;
and 2,000-file search/Git in 1.28/7.46 ms. The runtime/provider spike also
passed its generated configured-endpoint primitives. Its executable-presence
observations and generic unavailable live/SSH/Linux/Rust/signing/quality/native
gates remain unqualified, not replacements for the separately retained exact
physical native receipts.

### Complete bundled runtime, not a first-VM dependency download

The first actual first-use project/root-less UI runs passed. Later probes
failed before guest bootstrap. A separately approved normal Apple runtime
stop/start preserved its root, images and configuration; it did not repair the
missing prerequisite by itself. Fresh no-mount/no-model probes narrowed the
failure below Moguri: worker-image fetch/unpack and kernel took 17 ms, then
Apple's CLI waited at **Fetching init image** until its existing 30-second
runtime-operation deadline. The configured public
`ghcr.io/apple/containerization/vminit:0.26.3` was absent from the local cache.

The exact layer is 60,231,680 bytes. Anonymous HTTPS measurements reached HTTP
200 in 435 ms but transferred only 2,931,418 bytes in 30.05 seconds. This is a
large first-use runtime dependency inside a guest-start deadline, not proof
that a longer VM timeout or another user configuration would fix the product.
A complete 2-MiB byte range transferred in 21.77 seconds with HTTP 206.

The producer now includes the already-required Apple init image in the same
OCI archive as the unchanged Moguri worker. Existing distribution archive
bytes/SHA-512 and the exact setup review bind both images. Normal approved
image import prepares the local prerequisite before guest qualification,
without changing the user's selected init-image default or pulling weights.
The qualified Apple Containerization 0.10.0 prerequisite is pinned to OCI
index `sha256:5160897d2af14d8a510beb740df16c2264f6319b3e028f092f50fa6f8f5aa21f`.
Its Apache-2.0 notice is verified and shipped as
`AppleContainerization.LICENSE`. Custom runtime defaults remain custom; no
different image/version or credential is selected for them.

Producer acquisition uses anonymous public registry access, HTTPS-only
qualified artifact redirects, at most four 512-KiB ranged reads, exact
Content-Range/length checks and final full-object digests. It retains no
registry credential, strips authorization at the CDN boundary and never
publishes a partial archive. Cached ranges are not trusted as complete
objects. The producer's bounded download is separate from application
readiness and does not increase SendBox's runtime deadline or the existing
UI/ordinary-operation limits.

The distribution cache key includes the init pin and license. A verified
unchanged guest receipt can be reused to repack the archive without a worker
rebuild or starting unrelated build infrastructure. Cache publication is
atomic and rechecks the captured build inputs. Distribution/API format stays
version 1 and protocol stays 90: old clients already import reviewed
multi-image OCI archives. No event, migration or new permission is introduced.
Generated archive tests cover exact bytes/platform/license, ranged cache
reuse, corrupt/mis-sized ranges, malformed redirects, CDN credential stripping
and modified cached content; actual package verification requires both exact
runtime image indexes in the shipped archive.

Generated native model fixtures use deterministic public DNS declarations
because their in-guest model HTTP is intercepted. Accounting, role, private
copy, retry and cancellation tests do not become live-provider tests because
a system resolver happens to answer. The separate `providerScope` and
`coldNetwork` gates still use fresh actual DNS and real cold HTTPS/proxy
access; their failures are neither replaced nor relabeled by fixture DNS.
The qualification receipt records this distinction explicitly.

Managed group/retry/checkpoint fixtures also use the actual setup
review/apply/wait job, not a synchronous legacy probe that can outlive an
ordinary HTTP acknowledgement. Completion is followed by a fresh authenticated
snapshot; neither an admitted job nor a delayed broadcast proves readiness.
The exact distribution is passed explicitly to every child and must match
its workload image and worker/bridge digests.

The Moguri-owned host control PTY starts with echo disabled before SendBox
captures its temporary raw-mode settings. A constant, non-login OS wrapper
runs `/bin/stty -echo` and then `exec`s the already verified executable with
its exact positional argv; no user/model text is interpolated as shell source.
If setup fails, the CLI never starts. This changes only that private PTY, not
user consoles, host-wide terminal settings, services or networking.

The guest's private terminal is independent of that outer host PTY. Before
constructing Node's stdin TTY handle, the bridge checks the actual descriptors
with `isatty`, runs the existing guest `/bin/stty -echo`, and only then enters
raw mode. Otherwise libuv saves an echo-enabled guest mode and restores it
during teardown, reflecting a late parent packet even with host echo disabled.
Piped control does not run `stty`. Initialization is bounded and fails before
bootstrap if the existing OS tool cannot prepare that private terminal.

The original identity/direction guard still rejects reflected, malformed or
foreign control; none is silently discarded. Diagnostics distinguish format,
owner and direction without logging payloads or keys. Real generated single-
and nested-PTY regressions verify unchanged argv, successful peer delivery and
no reflection after raw-mode restoration. This reuses Node's MIT-licensed
built-in process/TTY facilities and existing OS tools, adds no dependency,
event or durable schema, and does not change ordinary user consoles.
The bridge bytes do change, requiring a new exact payload/image review and
fresh physical control qualification rather than reuse of the host-only cut.

The legacy fixture injected 2-GiB RAM/2-GiB disk settings, which setup correctly
preserved as customization. That was not the unchanged factory configuration
of 4-GiB RAM/8-GiB disk. A retained generated zero-model probe with those smaller
settings timed out before observed bootstrap; the corresponding factory-resource
probe completed with all three guest streams confirmed as TTYs. A separate
no-mount Apple VM ran Node in 544.05 ms without Moguri, credentials or model calls.
These observations distinguish configuration and integration scope, not a
specific out-of-memory, disk or TTY root cause. Managed qualification now
derives factory resources from the exact verified distribution and runs its
VM-heavy files sequentially; actual client-concurrency cases remain concurrent.
The original smaller-configuration failures remain retained, not relabeled as
successful default or custom-resource qualification. Production resource
defaults, VM deadlines and ordinary UI latency limits are unchanged.

<a id="current-verification-and-unresolved-native-startup"></a>
### Historical protocol90 verification and native startup investigation

At this protocol90 cut, the UI/service implementation and complete bundled
archive were present but **not fully native-qualified**. The draft stayed
open; the earlier successful physical cases did not erase later failures.

| Scope | Recorded result |
| --- | --- |
| Complete Node/native-TUI suite, including init-archive regressions | 2,304 pass, 29 skip, zero failures or cancellations |
| Complete source desktop suite | 355 pass, five skip, zero failures |
| Actual packaged desktop selection | 61 pass, two skip, zero failures |
| Actual physical first-use UI | Project and project-free cases both pass |
| Actual managed SDK selection | Four pass, including root-less work and startup requalification |
| Independently installed packed SDK, root/consumer audits, actual app/SDK/service/worker, two-image native archive, ZIP and readonly DMG | Pass; audits report zero vulnerabilities |
| Actual historical 88/89 app upgrades to 90 | Both preserve all 33 original ciphertext rows, draft, held queue, independent artifact, unknown original charge and exact authenticated user PTY, with no input replay |
| Three fresh-process packaged cached openings with 25,535 issue revisions and 61 chats | Real editable shell in 691.41/681.64/687.82 ms; corresponding authenticated rendered editor and acknowledged saved draft in 1,914.14/1,884.98/1,878.21 ms |
| First observed OS execution of this new ad-hoc app | FAIL: 4,112.90 ms versus the unchanged 1,500-ms window budget; the separately accepted first-OS-launch caveat remains, not notarization or universal first-launch qualification |
| Complete factory-resource native run at clean source `2c3da2d` | FAIL: artifact/runtime/provider-scope gates pass; raw guest readiness, worker settlement and group setup fail; retry/checkpoint and final teardown gates remain skipped |

Subsequent bounded zero-model observations authenticate the exact generated
plan, signer, root, command and guest before reading guest-only process/socket
metadata. Failed guests contain the init and stdio-bridge processes but no
supervisor or ready socket after bootstrap consumption. Their mounted release
manifest, all three signed artifact hashes, root ownership/modes/link counts,
public trust root and release signature check correctly. A successful sample
between failures remains a separate outcome, not a retry that redeems a failure.
The absence of a session directory does not locate the failing instruction:
upstream supervisor teardown removes it on several failure paths.

The observed failure precedes the generated public workload and can occur
without Moguri inference. At that investigation stage, the exact supervisor
exit cause remained unresolved; detached stderr was not published. The public
metadata prerequisite also returned HTTP 200 without credentials, which is not
proof that the failed guest's own network path succeeded. No timeout increase,
fake readiness, Local fallback, permission change, replay or repeated global
runtime recovery is used to qualify this gap.

The separately user-authorized dependency investigation subsequently captured
the actual egress gateway exiting after its fixed Meta A/AAAA UDP questions and
same-ID retransmissions received no replies within the existing three-second
budget. Meta stayed unavailable and the parent lost egress before readiness.
This identifies missing-reply handling, not where packets are lost outside the
guest. [mbianchidev/sendbox#80](https://github.com/mbianchidev/sendbox/pull/80)
adds one same-upstream TCP recovery exchange inside the original absolute
deadline, keeping UDP live and strict response validation intact. Its source
head `b3aa9b6` has all 19 CI checks passing, including Linux privileged proofs
and reproducible guest builds. At that investigation it remained a draft,
unmerged and unreleased; Moguri's pinned signed guest had not changed.
The complete native gate above stayed blocked pending reviewed bytes and actual
qualification; source CI success could not replace that evidence. The current
release and later exact feature-specific qualification are summarized above.

One separately approved Apple runtime stop/start interrupted one preexisting
container during the earlier prerequisite investigation. No further personal
Moguri or Apple runtime restart, app installation/opening, host profiling,
microphone use or paid inference was performed for this follow-up. Generated
failed/partial operation records and unknown accounting remain retained.

The current candidate installer, **not a final native-qualified delivery**, is
`release/qualification-builds/env-ready-1c66c1d/Moguri-0.31.0-alpha.1-macos-arm64.dmg`
(890,163,891 bytes), SHA-256
`86b3a281a14ecae7be5bdf2605ebce7b9266ee6b1db199d844993211cdb3f168`.
Later fixture/qualification-only commits do not change its app/SDK/worker bytes.

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

The later [exact 0.2.4 qualification](sendbox-0.2.4-qualification.md) records
the current protocol-76 artifact, physical guest/network and generated
service-led model/tool/accounting gates. It does not relabel the historical
measurements below or close the wider cancellation/recovery and milestone work.

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

The first-use Env flow shows these actual defaults and requires review and
approval, not Settings navigation, JSON authoring, a developer build or a SHA
command. The same shared review remains in Settings for customization. A matching
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

The compact Env menu exposes one rightmost settings action on each Sandbox
and Remote row, on hover, keyboard focus or touch. It omits the former repeated
disclosure and footer setup/results actions. Settings still expose all
customization, retained native work and result/publication inspection; this
is presentation simplification, not a removed policy or recovery surface.

First-use setup captures the actual SDK/profile/session revision from the
Env selection. The original Local/Remote Env and draft remain intact during
installation, image import and qualification. Only an actually completed setup
followed by fresh authenticated readiness can select Sandbox through the normal
revision-bound SDK command. A peer revision change refuses that selection
without undoing the separately completed global setup. Cancellation waits for
the original effect owner; partial or unacknowledged work neither selects Env
nor silently retries an installer/import. Previously reviewed manual settings,
custom versions and explicit automatic-workspace opt-outs keep their semantics.

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

## Captured project-group extension contract

The user-requested extension uses the already captured `Session.repositories`,
not current folder membership, a first project or a common parent. Local remains
the default; Sandbox is an independent explicit Env choice. Remote group
execution and Sandbox user consoles remain unqualified. Group colors,
navigation order and ungrouping cannot retarget or invalidate captured roots.

Reuse TypeBox/React/OpenTUI and Node filesystem/crypto under their existing
licenses, and SendBox under Apache-2.0. No new dependency, provider adapter,
terminal renderer or permission source is required.

The additive protocol80 shape has an explicit version-3 native input document:
every member binds its project ID/captured name, canonical source identity,
source HEAD, execution-relevant settings/policy and a collision-safe private
directory. Version-1 reviewed and version-2 automatic documents keep their
original meaning and digests. Workspace/execution records expose the exact
member map; group results/publication documents use distinct version-2 shapes.
Both `sandbox_multi_root_schema='1'` and genuine combined80 convergence are
required, not inferred from a higher numeric version. Actual standalone79
reserved the group marker but had no native group mapping or queued runtime.
Those version-3/version-2/maps and slash intent are therefore refused in a
fabricated predecessor, even if its theme/convergence markers were erased.
No old receipt or payload is relabeled or used to qualify new bytes.

Preparation leases every actual captured source and copies into one
Moguri-owned composite stage, never a live source mount. Reject overlapping
roots, aliases, changed devices/inodes, incomplete capture and aggregate limit
overflow before worker/model admission. Apply the existing complete
20,000-file/256-MiB tree boundary across the group, not once per member.
Tool calls must select an exact original repository ID or captured unique name.
Read/write policies remain per member; shell execution is unavailable across
the group if any member has folder restrictions that the shell cannot enforce.
Grouping never grants project MCP/hooks/background jobs or broader networking.

Retained work and rollback recovery preserve every original member snapshot
and complete private after-state. Unassigned unprotected files outside the
captured map block replacement; the signed originals remain inspectable rather
than silently dropping those files into no member. No changed root, policy, cancellation,
missing receipt or controller restart can replay preparation or substitute a
fresh checkout. Unknown VM cleanup/accounting remains quarantined. Every
model/tool frame uses the existing worker, actual tool authorization and
all-role ledger; selected-provider/CNAME and GitHub Meta scope stays unchanged.
Native authorization, pending approvals and explicit automatic delegation use
the broker-selected member's guest root, not the group's intentionally null
logical root. A root-less group never becomes a project-free workspace or a
Local permission fallback.

Publication explicitly chooses one captured repository and exact retained paths.
It binds that member's original Local root and bases, revalidates the complete
captured root/policy set and leases all publication roots. Actual user acceptance
is separate from model provenance. Copies retain existing partial/no-replay
attempt records and never stage files or change source Git HEAD/index.
Files outside captured member directories are not silently publishable.
Sequential member publications can advance bases only through independently
retained, completed actual-user copied-byte receipts. A deleted report or a
partial attempt is not a new base. Source modes are preserved exactly despite
the process creation mask; neither a text acceptance nor the helper's temporary
file may change a source's mode.

Desktop exposes **New Sandbox chat** in the project-group menu and an independent
Env selection. The result panel requires choosing an original repository before
selecting member-relative paths. Changing that selection revokes the old review.
CLI/TUI use `/folder-chat FOLDER_ID Sandbox`; omit Env to preserve Local.
SDK publication calls take the original repository ID as an optional final
argument, mandatory for groups. CLI publication adds `--repository ID`; shared
`/sandbox publish-preview RUN_ID {"paths":["file"],"repository":"ID"}` returns an
exact selector-bound confirm command. Native user consoles, SSH groups, native
Git/plan-write, project MCP/hooks/background transports remain blocked.

### Fresh prerequisites before group integration

Source `f89669d1f54e0f2697a27af7c0d255602bc586cf`, macOS 26.6 arm64,
hardware virtualization available (`kern.hv_support=1`). npm spikes use pinned
Node 26.12.0; the separately observed host `node` is 26.11.1.

| Generated prerequisite | Actual result |
| --- | --- |
| Foundation transport/cancellation | PASS, 6 intercepted requests / 32.63 ms cancellation |
| SQLite WAL/crash projection | PASS, 1,000 events / 0.0658 ms append p95 / 0.4953 ms rebuild |
| Owned PTY group stop | PASS, 152.91 ms / zero known survivors |
| OpenTUI and hidden Electron | PASS, 18.11 ms/update; 181.82 ms cold start / 8.24 ms scroll frame |
| Bounded filesystem/Git baseline | PASS, 2,000 files / 0.867 ms search / 6.667 ms Git status |
| Verified native package-manager reuse | PASS, 558 generated bytes / 554.97 ms; tampering refused, no lifecycle scripts |
| Final group/current80 guest, network, worker and installer | NOT YET QUALIFIED at this prerequisite cut |

The generic foundation script still reports its historical live-provider,
Rust/Linux, notarization, initial native/quality/decision/SSH and first-checkpoint
gates as unavailable/FAIL. Those rows are not new physical probes of the
separately installed 0.2.4 runtime and cannot qualify or disqualify changed80
artifacts by assumption. Exact final native and client artifacts require their
own retained PASS/FAIL/SKIP evidence.

The [final combined80 qualification](sendbox-0.2.4-qualification.md#protocol-80-combined-follow-up)
records all seven actual artifact/network/worker/group/teardown gates as PASS,
with exact current image, trust, installer and raw-receipt identities. The
prerequisite table above remains its original earlier cut, not relabelled data.

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
