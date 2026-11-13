# First-milestone combination evidence

This preserves issue [#38](https://github.com/mbianchidev/moguri/issues/38)'s
required Local/SSH coverage and residual native-gate definitions.
#38 closed after merged #56 on 2026-11-07 despite that PR's explicit disclaimer
of full/native acceptance. Closed issue state does not accept Milestone 1 or
its unqualified native cells. The residual
acceptance owner is [#39](https://github.com/mbianchidev/moguri/issues/39), with
#17 administratively consolidated into it. The unchanged
[milestone criteria](../implementation.md#milestone-acceptance-criteria)
remain authoritative.

## Current qualification, 2026-11-13

**All 3,360 Native cells now have verified complete-group coverage under the
explicitly reviewed method below.** The fresh `a6bdbe7` group-only invocation
passes all 336 cells in the two remaining groups: **339 records, zero failures,
cancellations or skips, 2,197,989.806542 ms**. Its report SHA-256 is
`3a8b7c4bd297080d9029cd50a9c5c921bc36e68d2bcbdd934bcf93a8e29d08d3`.
Only the 18 fully completed groups from the original `3a012f0` journal are used;
all partial observations from its two interrupted groups are excluded.

The strict merger verifies **20 complete nonoverlapping groups, 3,360 unique
original Native owners, every required ID, exact setup/cell/group source parity
and matching runtime/input digests**. The independent coverage artifact passes,
SHA-256
`62cfd73e4c01f2ff807962aa15f9b89dd7542daa0813c5c737c6fe9e2a42ef95`.
The original four-hour whole report remains **INCOMPLETE, zero qualified**.
This is neither one passing whole invocation nor a relabeling of failed work.

The exact disjoint Local/SSH and Native set contains all **10,080 required IDs**.
At that Native qualification cut, runtime/SDK/build bytes match the fully tested
`51fce72` cut and all 36 non-test build/input hashes are unchanged. Its complete source run retains **10,870
passes, 56 explicit Native skips, zero failures/cancellations**. Separate
physical receipts cover every non-nominal skipped Native path.

Across accepted complete groups, 60 cells take more than the old 30-second
phase cap; the maximum is **42,732.218375 ms**, within the unchanged 45-second
complete-cell limit. The signed reader authenticates **224 witnesses above
128 KiB**, maximum **132,442 bytes**, without changing client publication
limits. All-role reported totals are **498,624 generated tokens**; billed USD
remains `null`, not invented zero usage or live billing. Duplicate cells,
altered worker digests and escaped journals are independently rejected without
creating an output.

**Milestone 1 remains open.** Fresh hosted-main CI is still blocked before job
steps by account payment/spending eligibility; absent working-branch checks are
not green CI. Optional Apple tracing remains unqualified on the inspected
guest/kernel, and the packaged-app CLI-install skip is a separate distribution
receipt. No tests were removed; no merge, main push, host installation,
service/network change or advancement of #45/#53 occurred in that qualification.
The later explicitly requested [inline command/sidebar menu change](session-interactions.md#inline-command-responses-and-sidebar-menus)
has rebuilt desktop assets and separate UI checks; the Native core inputs
remain unchanged. It does not complete the remaining #53 sidebar/search/game
scope or the hosted-main gate.

## Reviewed complete-group coverage, 2026-11-13

The3a012f0 whole invocation reaches its unchanged four-hour limit with
**3,248 passing cell observations and18 complete168-cell groups**. Before the
limit, no assertion fails. The timer cancels two active cells, both incomplete
groups and the parent; their stopped/closing outcomes remain real cancellation,
not successful work. The original report stays **INCOMPLETE, zero qualified**,
SHA-256 `2c5fce6475db37012b709aa4b4c9d49cb83a7f5452baef6b3cdfacb657e70806`.
Exact read-only ownership checks verify both interrupted guests absent; private
records and unknown accounting are retained.

The user explicitly selected **"Qualify the last two whole groups and combine
only verified complete-group receipts (Recommended)"**. This is a reviewed
coverage method, not an upgrade of that timed-out invocation. Only its18 fully
completed groups are eligible; partial observations from the two interrupted
groups are excluded entirely.

`MOGURI_NATIVE_GROUPS` accepts a JSON list of exact, unique whole-group names.
Absent it, the full3,360-cell method is unchanged. Group-only runs require every
cell and cleanup in each selected group, use the same45-second cell and original
group/four-hour bounds, and write a distinct `native-group-report` with
`wholeMatrixQualified:false`. They never overwrite the original whole report or
claim a complete matrix. Partial, duplicate and empty selections fail before a
qualification journal or guest launch.

With the existing reviewed native configuration variables, the remaining run is:

```sh
MOGURI_NATIVE_GROUPS='["critique/Autopilot","critique/Autopilot Max"]' \
./node_modules/node/bin/node --import tsx --test \
  --test-name-pattern='^reviewed native Sandbox groups execute' \
  tests/milestone-combinations.test.ts
```

`./node_modules/node/bin/node --import tsx scripts/merge-milestone-group-receipts.mjs BASE_REPORT GROUP_REPORT NEW_OUTPUT`
checks complete original journals, exact required IDs, all20 nonoverlapping
groups, signed-proof references, root/image/worker/cleanup and all-role token
accounting. It requires matching runtime/input digests and exact retained
setup/cell/group source regions; only the selector/report path may differ.
It rejects filesystem escapes, mismatched or partial records and writes a new
atomic, non-overwriting coverage artifact. Node and existing test helpers are
reused, with no new dependencies or production events/schema. The original
whole invocation remains INCOMPLETE even if that separately reviewed coverage
artifact passes. Hosted CI and the other acceptance boundaries remain separate.

## Reviewed native cell-budget allocation, 2026-11-12

The6d54979 invocation independently exposes a stricter30-second settlement
sub-wait inside the existing45-second complete-cell limit. Its failing Guided/
Cascade/document cell has all nine roles accounted for, but its actual original
execution is still draining at the sub-wait boundary. This is not the previous
polling false negative and is not labeled completed. The interrupted run retains
**2,482 observations,one failure,13 complete groups and zero qualified cells**.
Read-only exact launch/image/init/mount inspection verifies the two latest owned
guests absent; original pending/unknown accounting remains untouched.

The user explicitly selected **"Use the remaining 45-second cell budget
(Recommended)"**. Native settlement now uses only the time remaining from cell
entry, rather than a separate30-second phase cap. Local/SSH's existing30-second
wait stays unchanged. The45-second complete-cell limit, all client/model/VM
deadlines, group concurrency and four-hour whole-run limit are unchanged.
The same exact terminal/cleanup/proof/role/accounting assertions still apply.
No prior partial set is aggregated or upgraded; the reviewed harness requires
another complete original3,360-cell invocation.
Before freezing it, the full14-case actual Native proof/control/mixed-context/
setup/restart/TUI check passes in **123,839.19575 ms**, zero failures or skips;
type checks pass. Runtime/build inputs remain identical to51fce72.

## Final bounded-poll observation, 2026-11-12

The corrected3ea61df native invocation retains **2,560 observations,one failed
settlement assertion and13 complete groups**, with all3,360 still unqualified.
It successfully authenticates56 original witnesses above the unchanged128-KiB
user publication limit, largest **131,288 bytes**. That proof-reader repair is
exercised, not inferred from a controller request.

The failure exposes a separate shared test-polling bug. After its final15-ms
timer, `waitFor` checked deadline expiry before sampling the state again. Its
error diagnostic already observed the original completed session, stopped guest
and all nine settled roles. The original signed owner and encrypted event
chronology remain retained. A deterministic timer regression reproduces the
false negative when completion occurs at5ms, deadline at10ms and the final poll
wakes at15ms.

The helper now samples the actual condition before deciding expiry, including
that final wake. It adds no wait, retry, model/client/VM timeout or replay.
The unchanged-pending negative case still rejects. The original failure is not
reclassified; a new complete native invocation remains necessary. Both boundary
cases and23 existing fixture/native-evidence guards pass together in
**3,508.89725 ms**; types pass. Production/runtime/SDK/worker bytes remain51fce72.
The complete14-case actual Native oversized-proof/control/mixed-context/setup/
restart/TUI invocation also passes in **118,427.122792 ms**, with zero failures
or skips, before the next complete nominal attempt.
Read-only exact launch/image/init/mount inspection verifies the two interrupted
owned guests absent; their original pending records and reserved/unknown
accounting remain preserved, not silently finalized. No unrelated guest,
service, networking or host setting changed. No tests were removed.

## Complete source and bounded native proofs, 2026-11-12

The complete unfiltered source runner at clean runtime cut
`51fce721a3db79002775db9d68c95aa9d02d2329` passes **10,870 records,56 explicit
platform/native skips, zero failures or cancellations**, in
**8,489,745.150958 ms**. All **6,720 required Local/SSH nominal cells** pass.
The source report SHA-256 is
`ceff379e958bb2f7ac67307a40fd9203e21d33e4699fb9057b1af77b0dc7852c`.
This is a full invocation, not the earlier interrupted preflights.

The separate native invocation exposes a qualification-only boundary error:
its Guided/Cascade document guest completes with CLI0, verified journal and
owned-VM absence, but its original nine-call witness is **131,279 bytes**,
207 bytes above the unchanged128-KiB per-file client output limit. The bounded
publication projection correctly excludes it. Read-only signed-after-state
inspection authenticates its exact bytes and SHA-256
`273dc0e7d044c63a9c59ed7c08bd36c371b6b2bb0a23e202fe4542812a663096`.
The interrupted invocation retains **2,259 observations/one failed assertion**,
12 complete groups and **zero qualified** native cells. Every required ID and
original private scope remains retained.

Native qualification now reads only that original signed completion's proof,
with a separate2-MiB bound, exact SID/plan/signer/audit/before/after binding,
strict UTF-8 and unchanged whole-role/context assertions. It neither expands
client publication limits nor truncates evidence or accepts controller calls.
The proof-reader implementation is included in the native input digest set.
A focused actual-guest oversized-proof regression passes in **9,080.856666 ms**;
15 signed-evidence/receipt guard cases and type checks also pass.
Runtime/package/SDK/worker bytes remain exactly the fully tested51fce72 cut.
The revised Native-only harness still needs its own complete fresh3,360-cell
invocation; prior failed observations are not upgraded.

The remaining actual desktop first-use project/root-less paths now assert the
canonical v4 queued admission and original consumed capture, not obsolete
`automatic` ownership. Native checkpoint acceptance waits for its exact terminal
reader, while normal window shutdown waits for renderer acknowledgement and
the original read transport's actual terminal ACK/cleanup. The corrected four-
journey hidden suite passes in **51.2 seconds**, without a timeout increase or
before-unload bypass. Original failures remain retained. Together with the five
native control selections and physical rewind, these cover all10 Native skips
from the413-pass desktop suite; its separate packaged-app CLI-install skip is
not a new distribution receipt. No low-signal tests were removed.

An explicit audit of all56 source skips finds only Native cases. Existing
physical receipts cover42; a complete additional13-case invocation covers exact
arbitrary windows/effort, mixed image/document context, provider-independent
engine setup, bundled restart and the original native TUI journey in
**119,107.965458 ms**, zero failures or skips. Only the complete3,360-cell
nominal parent remains pending. These are separate physical receipts, not source
skips relabeled as passes.

That audit also exposes two stale assumptions in the original TUI fixture.
Authenticated failed-scope events show publication was queried immediately after
the terminal event while its exact after-capture still leased the source. It now
requires that original capture to be consumed before fresh publication review.
The default untitled session also correctly meters **three solver calls and one
title call**, not three total calls. The fixture retains that real journey and
asserts every role plus zero controller inference; it does not suppress title
generation or alter accounting. Its isolated corrected run passes in
**6,274.135375 ms** before the complete13-case invocation above. Both original
failures stay retained. This TUI-only fixture is outside all19 frozen inputs of
the active native nominal runner; no runtime, guard, publication limit or
deadline changes.

## Registry disappearance and original-command recovery, 2026-11-12

The `d06f232` terminal ordering repair passes two fresh complete native80 actor/
cap invocations, with86 records each and no failures/skips. Read-only inspection
authenticates all80 first-run original terminal journals with ACK equal to the
terminal sequence. All27 native fault/profile/PTY cases, all ten physical
baseline gates, five native TUI and desktop selections, the complete hidden
desktop suite and the independent packed SDK also pass at that exact cut.

The wider source invocation nevertheless exposes a real service-registry
cleanup race: the original file can unlink between `open` and `fstat`, so its
zero-link descriptor was misreported as invalid live metadata rather than
`ServiceFileDisappeared`. Two deterministic real-file tests reproduce the
failure, including an independently preserved replacement at the same path.
The reader now reports that existing typed disappearance without accepting
bytes, removing a replacement or bypassing captured-owner/lock/endpoint checks.
All43 focused lifecycle/receipt cases, type checks and build pass. No API,
durable schema, dependency or guest worker/bridge bytes change.

The source invocation was gracefully interrupted to retain its original
failure stack; later cancelled-file reports are interruption outcomes, not
new product regressions. Its4,431 observed nominal cells are not a complete
source pass. The separate native invocation stops before rebuilding:1,202
observations, no observed native cell failures, six complete groups and all
**3,360 still unqualified** IDs remain retained. No interrupted result is green.

The preceding five-case native candidate run retains four passes and one
`command_pending` Critique attempt. The original source revalidation can use its
existing90-second bound while a mutation's20-second transport acknowledgement
expires earlier. Qualification now captures the exact immutable command/ID and
inspects only its original receipt until that same operation bound; it never
resends a write, extends a VM/client timeout or adopts an unknown result.
The original pending attempt and private resources remain retained.
Fresh complete current-cut acceptance is still required. No low-signal tests
were removed.

## Terminal ACK ordering repair, 2026-11-12

The `ca23cef` host/guest echo initialization passes all ten physical baseline
gates in **145,387.4445 ms**, all five native candidate/compound journeys in
**575,493.668833 ms**, all five native TUI and hidden desktop selections, the
independently installed SDK, and27 focused native fault/PTY cases. The full
hidden desktop invocation passes **413 cases with11 explicit physical skips**
in15.2minutes. Additional owned probes verify an in-flight human answer wins,
provider revocation preserves the unanswered parent, and a failed private-result
transaction retains unknown capacity and a partial/unconfirmed after-state
instead of fabricating a signed result. Earlier overstrong fixture expectations
remain recorded as failed attempts, not relabeled.

Nevertheless the80-case native actor/cap invocation retains **77 passing records
and three failures including parents**. Cascade/Autopilot/tokens receives a
controller-direction packet on its worker stream. The nominal invocation also
records three guarded direction failures. Its interrupted journal retains
**1,012 observations:1,009 passes and three failures**, four complete groups and
**zero qualified** cells; all3,360 required IDs remain unqualified. The separate
source invocation stops with3,510 observations and no observed cell failures,
not a completed source pass.

The controller's terminal path sent the accepted result reply before the outer
frame handler sent its durable cursor ACK. That reply releases the foreground
peer, so the late ACK can reach terminal teardown. A deterministic actual SSH
regression records `reply, ack` before the repair (**4,011.978417 ms**) and
`ack, reply` after it (**4,103.600583 ms**). The controller now sends the exact
committed contiguous ACK before the terminal reply, once, including an
already-recorded terminal frame. No unknown packet is ignored, no authentication
or replay guard changes, and no new API, durable schema or dependency is added.

This is a host-only ordering repair. Worker/bridge/MCP-worker bytes still match
the exact6a0b image produced from `ca23cef`; its previous physical source-cut
receipts are not upgraded. Fresh complete actor, nominal, source and physical
receipts remain necessary. No low-signal tests were removed.

## Nested private terminal repair, 2026-11-12

The host-only `0edb415` repair is not complete qualification. A fresh actual
native TUI run retains **four passes/one failure**: the fixed selection correctly
stays partial after private-control identity rejection despite all11 worker
frames, a completed original worker, CLI exit0 and verified owned-guest absence.
Its original signed after-state authenticates sequence11/ACK10; the rejected
raw packet was not retained and is not retrospectively invented.

A real two-PTY regression then reproduces the remaining mechanism in
**218.079416 ms**: the guest restores its own echo-enabled mode independently
of the already-corrected host PTY. The bridge now initializes only its private
TTY before Node saves that original mode. The same regression passes in
**206.531209 ms**. Strict sealed-frame format, owner, direction, authentication
and sequence guards remain enforced. This is a transport-only repair with no
new dependency, API, event or durable migration; changed bridge bytes still
require new exact native image/distribution and complete qualification.

The interrupted `0edb415` nominal journal
`.test-output/milestone-combinations/native-progress-20261112125838822.jsonl`
retains **639 observed cells**, two completed groups and all **3,360 still
unqualified** IDs. Its default managed setups also failed during a separately
observed credential-free GitHub Meta quota window: a disclosed controller
request returned403/remaining0, then200/remaining54 after the captured reset.
That observation is not the missing original guest HTTP response or a license
to weaken network policy, change host networking, inject credentials or replay
an old intent. The complete source invocation was interrupted for the verified
transport repair and is not labeled green.

At that unchanged host cut, a fresh retry case passes after the external reset
in **14,508.051375 ms**, and all five physical candidate/policy/lost-result/
Cascade/Critique journeys pass in **532,288.094416 ms**, without skips.
The earlier failed baseline and setup invocations remain failed. These focused
successes do not qualify the new bridge, nominal cells, complete source suite
or final Milestone1 acceptance. No low-signal tests were removed.

## Private control teardown repair, 2026-11-12

At clean `dbbce81`, the PTY-fixed ten-gate baseline passes in
**143,223.492375 ms**, all25 focused native loss/accounting/profile gates pass
without skips, the independently installed SDK passes, and the complete hidden
desktop run passes **413 cases with11 explicit physical skips** in15.4minutes.
The80-case actual-answer gate then exposes a separate late private-control
failure after the actual model calls, human answer and terminal frame, despite
CLI exit0 and verified original-guest absence. The identity guard correctly
retains a partial result. That invocation is **77 passes/three failures**
including parent failures, not an accepted complete actual-actor gate.

A real host PTY reproduces reflected parent input when a child restores its
original echo-enabled terminal settings. The
[private native launch now disables echo before exec](managed-sandbox.md)
without changing user terminals or weakening control authentication.
The regression fails with the original launch and passes with exact argv,
peer delivery and no reflected controller frame. The old failed scope at
`.native/qualification/native-service-8XqOKD` remains retained. The next
source/native nominal invocations were interrupted for this root repair;
their ordered journals and all3,360 unqualified IDs remain available.
Their315 observed native cells are not accepted cells, and the interrupted
source invocation is not a full pass. Fresh complete fixed-host gates are
still required.

The corrected host launch then passes all80 actual native human/delegated-answer
and cap cases, with **86 passing test records, zero skips or failures**, in
**207,892.344459 ms**. All five selection groups complete. This is separate
from the still-unqualified nominal cells and does not rewrite the failed run.

## Reviewed PTY capacity repair, 2026-11-12

The clean `a02224e` current-image ten-gate baseline passed in
**135,490.000958 ms**, including real cold network, actual retry/checkpoints,
all private rewind scopes, hidden desktop and exact owned-guest absence.
The first full native nominal invocation then observed **487 passing cells**
but failed two later cells with `posix_spawnp failed`; subsequent group setup
could not start. Its report deliberately qualifies **zero** cells and retains
all **3,360 unqualified** IDs:
`.test-output/milestone-combinations/native-report-20261112105528499.json`.
The original ordered journal and failed private compartments remain retained.
The full source invocation was interrupted for the root-cause repair rather
than mislabeled green. The hidden desktop run retained **411 passes, two
failures and11 physical skips**; the two focused repairs subsequently pass.

The failure was reproduced independently with completed generated PTYs and
traced to the borrowed macOS allocator cleanup, not addressed by changing host
limits, retrying old launches or deleting resources. The user
[approved the exact maintained PTY beta](decisions.md#d06-rust-helpers).
`node-pty`1.2.0-beta.18 is pinned with its original MIT license and exact lock
integrity. A600-exit regression now passes with no process-local allocator
growth; installation and audit report zero vulnerabilities.

The rebuilt payload is
`docker.io/library/moguri-worker@sha256:a8975ddcb0d1ad74d1636d6747a5df3a29ebd649904472a588dd31ac3ccdd282`,
distribution `.native/sandbox-distribution/build-EacXOL`, digest
`afea32dd7d4fad78e346520017c61297046ee1237ef2ea9c00a2128aad8a6244`.
The complete payload digest is
`799b2f78073cb44aee8734e69433ded812a8966696b6656b07d17db816b35aa2`.
Its no-cache producer took **36,381.927417 ms**. Worker/bridge JavaScript hashes
remain unchanged, but dependency bytes and the immutable image changed and
require fresh package/native/source acceptance. No prior receipt is relabeled.
Actual distinct-root native profiles separately pass concurrent ownership,
foreign-ID refusal, own-Stop-only behavior and retained unknown global holds;
shared-source contention stays blocked rather than inheriting another profile.

## Protocol102 continuation, 2026-11-12

The current repaired payload is
`docker.io/library/moguri-worker@sha256:cf9129d94ca4f3784c4e0d597f3ed7b8d1b8e8ac194997a5957cf174823ba880`,
distribution `.native/sandbox-distribution/build-Mo9BqQ`, digest
`87847b6a06f9bc0797a0c6cd136dc1022c84360d50f7c2c644534ec9287719ca`.
The no-cache build took **49,077.875042 ms**. It retains released, user-installed
SendBox0.2.6 and the reviewed Container1.7.1 client. Worker SHA-256 remains
`a526cd34dc389cae982a9a6f7a7472d8de293acc5830a5b902541f696dbe09ec`;
bridge SHA-256 is
`1ea4ef301c3ebdf943b57f63cf3e26f8863e40bc392c0003c98e73cf7ccee634`.
The complete payload digest is
`8f5054746bccde9eac77eaa5acb05f351af909313662fa767904a1a9c1c97cfb`.

Focused actual-guest cases now pass private candidate creation/application,
compiled CLI source/application, fresh signed-result publication, policy
revocation and original lost-result recovery without replay. The recovery
reads the original authenticated journal from the signed completion's unique
private-store after-snapshot when rollback replaced the live inode; it never
adopts the replacement root. Actual native Cascade passes in
**116,801.446167 ms**. Critique passes in **239,088.142541 ms**, including denial
without critic spending, explicit fresh source/stage review, the real configured
guest project test, metered critic and separate private source application.
All retain original Local checkout/index and exact guest-absence checks.
Earlier failed physical attempts and their quarantined resources remain failed.

All five actual native TUI selections pass in **63,531.499417 ms**; all five
hidden native desktop selections pass in **1.0 minute**. These exercise exact
window/effort, a separately confirmed combined cap, a generated document,
actual-user tool approval and actual guest request/accounting witnesses.
Fixture teardown sometimes explicitly stops a pending terminal checkpoint
reader; these client cases do not claim that every terminal snapshot completed.
The recovered-status desktop regression also passes after generated-service
restart: a known partial peer status cannot masquerade as a terminal ACK.

The shared journal/capture/namespace primitives pass 60 focused cases, and 15
real SSH compound/crash/foreground regressions pass. A fresh independently
installed packed SDK also passes. At clean `97e3093`, all **6,720 Local/SSH
nominal cells** passed, but that complete source invocation still had four
migration-fixture failures; their 13 focused repairs pass without relabeling
the failed invocation. The complete hidden desktop run at that cut passed
**412 cases with six physical skips**. Final current-cut integrated source,
desktop, package, ten-gate physical and all **3,360 native nominal** receipts
remain separate pending gates. No low-signal tests were removed.

## Current-build qualification, 2026-11-11

The latest continuation uses the user's separately
[reviewed published SendBox 0.2.6](managed-sandbox.md#reviewed-026-distribution-2026-11-11),
including matched Apple Container 1.7.1 support and patched host/guest
dependencies. Exact release-workflow provenance, unchanged trusted Ed25519 root,
signed guest bytes and user-installed root-owned artifacts are verified.
The new no-cache producer image is
`docker.io/library/moguri-worker@sha256:b6e8ae1de6b78408f852abf9e4d32c297fdb33ad77156ec60059c903379600f2`.
Producer/installation evidence does not qualify execution; all 3,360 nominal
native cells remain unqualified pending their fresh actual runs.

At clean cut `a91f8a9`, that exact released host/guest/current image passes
all ten feature-specific physical gates in **136,000.583334 ms**. The report
`.native/qualification/current-sendbox-YUCGVF/qualification.json` includes
cold actual network/effective policy, generated guest worker accounting,
grouped roots, five physical retry/checkpoint cases plus one primitive,
all three private rewind scopes, actual hidden native desktop rewind and
confirmed owned-guest absence. Earlier snapshot failures remain historical
failures, not retroactively successful. The independent packed SDK also passes.

The next actual candidate gate fails before workspace creation: repeated
standalone guests observe inode **3, 2, 3** for one unchanged host-private
inode and snapshot. Its evidence is retained at
`.native/qualification/native-service-dioRum`. The user explicitly approved the
[versioned private-root identity repair](candidate-transports.md#versioned-native-identity-repair),
including genuine101 migration/restart preservation and per-VM grant evidence.
That changes the protocol/worker to102; the successful101 receipt above is not
qualification of the new payload. No nominal cell is accepted by that repair
or by removing an identity comparison.

The first protocol102 v3 run completes real guest source/stage/application,
then exposes a coupled publication defect at
`.native/qualification/native-service-mJeut3`: the fresh signed result and
original source/plan/signer match, but immutable stage-creation provenance was
incorrectly compared with the checkpoint's later admitted working-tree digest.
Versioned checkpoint `stageBinding` now keeps those meanings separate, while
retaining exact original Local bases and signed result/input binding. All 71
affected source/publication/rewind/identity cases pass, including missing and
changed binding refusals. The failed physical attempt remains failed; its
complete corrected native candidate journey still needs a fresh actual run.

The starting merged main is `13001b7e206211cc70b32639b155de0b064bf2e1`,
including #61/#62, protocol101, `0.32.0-alpha.1`. Fresh qualification uses its
actual compiled payload, not the historical protocol99 image below.
All ten existing physical gates passed in **124,919.886208 ms**, including
real cold provider/network policy, generated guest-owned model accounting,
grouped roots, retry/checkpoints, three rewind scopes, hidden desktop rewind
and verified original-guest teardown. The retained report is
`.native/qualification/current-sendbox-Smqrho/qualification.json`.
Its exact current image is
`docker.io/library/moguri-worker@sha256:33cc56b627ab5df8405bd9211452ae3abc4be93b319211ddf3735e6f8ca7ec38`.
This feature-specific pass does not yet qualify the 3,360 nominal native cells
or all N1-N8 failure/client gates.

Subsequent 0.2.4 managed GitHub-scope starts failed before bootstrap, including
an unchanged stock-adapter probe; provider-only scope still reached readiness.
Five native arbitrary-window text boundaries passed before these failures.
They are not nominal maximum/half cells and do not reduce the 3,360 count.
The failed mixed-input/startup attempts remain failures, with original private
intents retained under `.native/qualification/`. No longer timeout, reduced
scope or older passing receipt substitutes for them.

The user then explicitly approved the [reviewed 0.2.5
distribution](managed-sandbox.md#reviewed-025-distribution-2026-11-11).
Its new producer image is
`docker.io/library/moguri-worker@sha256:89e98e56d9cfb17d08fcd4e8bfde907d6ba95af68cc6952ea07dbe957130a5e6`;
the distribution is `.native/sandbox-distribution/build-9MgCWp`, digest
`6b9f83a68bafc04eea10aea62ce6819ffbcbfb00fcd490ef61e803716e282eca`.
The 16,607,929-byte side-by-side no-script installer has SHA-512
`f5742145814757474af4bae22fb8d6c202a3f907d481e57b04e3e46e19317994e12ccdfd3c53876409f4fc88b943d5c1b03cf1936b3f533a756f8ac36e9c4199`.
It was prepared but not installed at that producer cut. The user subsequently
installed and approved its side-by-side bytes. The clean `02edb1b` follow-up
report `.native/qualification/current-sendbox-EeC0TX/qualification.json`
verified seven gates, failed retry/checkpoint and per-turn rewind, and skipped
the dependent desktop rewind gate in 188,306.415166 ms. Those failures remain
failures, not a ten-gate pass. All 3,360 native nominal cells remain unqualified.

The [selected 1.7.1 host boundary](managed-sandbox.md#selected-apple-container-171-boundary)
and upstream compatible/patched-release gate are separate from that original
0.10.0 receipt. No new native matrix pass is inferred from host installation,
schema parsing, generated tests or a development-only upstream result.

Two direct acceptance defects were exposed and repaired without changing the
event/schema authority. Native model instructions now name the actual
`/workspace`, not the controller's Local project path; the actual mixed
image/document fixed-model boundary then passed. A rewind refused before its
private preparation intent could otherwise become permanently uninspectable.
After restart, exact read-only inspection now reports `not-prepared` and no
dispatched copy effects while leaving the operation partial/quarantined until
the actual user's separate acknowledgement. It never refunds model charges,
replays the original operation, claims external files unchanged, or binds a
replacement stage. The generated restart regression and prior copy/persistence/
cancellation cases remain distinct.

The fixed-model mixed-input pass belongs to the original 0.10.0 boundary,
not the changed 1.7.1 host. The private Git snapshot mutation observed during physical retry/rewind still
requires current-runtime qualification. Complete directory/inode/byte/mode
checks were not loosened, failures were not retried into success, and original
private stages remain retained. Diagnostics now identify the exact stage and
changed directory metadata without including source contents.

The coupled source fixes passed 76 focused settings/platform/snapshot/recovery
cases and fresh type/build checks. The independently installed packed SDK,
compiled CLI/TUI/worker, controlled crash/restart and ownership/accounting
consumer probes also passed; both root and external-consumer npm audits report
zero vulnerabilities. Existing chunk-size, experimental FFI and dependency
deprecation notices remain disclosed. These source/package results do not
replace the outstanding native cells, upstream Rust audit/release or hosted CI.
No low-signal tests were removed.

The first unfiltered `6e1752d` source attempt exposed six stale candidate
retention/recovery/profile fixtures. They created new Git sessions with the
new default isolated worktree while asserting original-checkout writes,
quarantine or a shared physical writer. The run was stopped before the heavy
matrix and remains a failed/incomplete attempt. Those exact fixtures now
explicitly select `workspaceMode: checkout`; production defaults and assertions
are unchanged. All six regressions and the complete 48-case affected suites,
including the positive default-isolated-worktree contract, pass on pinned
Node 26.12.0. This focused result is not an unfiltered full-suite pass.

The first full hidden-desktop run retained **411 passes, six skips and one
failure** in 16.8 minutes. Its retained group-publication fixture lacked the
new required original-checkout opt-in for each member, so the service correctly
refused an unqualified automatic group worktree. The fixture now records both
explicit project choices before capturing the group. All 51 affected
publication/default/upgrade cases and both generated desktop publication
journeys pass; the actual-native desktop case remains explicitly skipped.
This does not relabel the first failed desktop run as green.

The complete bounded no-heavy source diagnostic at `4271b1d` then retained
**3,008 passes, seven failures, 44 skips and no cancellations** in
3,205,904.437584 ms. It deliberately excluded the 6,720-cell Local/SSH nominal
set and is not an unfiltered acceptance run. Four more fixtures needed their
actual default worktree to become ready or an explicit original-checkout
choice. The competing Kanban origin also needed its intended original root,
not an unrelated default worktree counted as a duplicate task. The lost-response
issue fixture now counts the implemented metered read-only continuation without
retrying its write. A timeout with confirmed cleanup is not an unknown effect;
that continuation fixture now loses an actual post-effect completion receipt.
All eight exact reproductions and the complete 93-case affected suites pass.
Production workspace defaults, capacity and no-replay guards are unchanged.

A second complete hidden-desktop attempt at `4271b1d` retained **410 passes,
six skips, two failures and one teardown error** in 16.6 minutes. One fixture
closed before the renderer acknowledged its saved draft. The other exposed a
real rewind UI race: old conflict controls remained usable during a fresh
preview request, then the response discarded the user's selection. A held
real preview response now reproduces that defect deterministically. Starting
review clears the old preview, per-file choices and confirmation immediately;
the new exact response still needs fresh user choices. The two-repeat affected
desktop set passes **26 cases**, with six explicit physical skips, after fresh
type/build checks. Earlier failed runs remain failed; final complete source,
desktop, package and native gates are still separate.

The actual retained pre-copy failure at
`.native/qualification/native-service-TSGuqb` was additionally inspected with
current native readiness deliberately unavailable. Read-only inspection
returned `not-prepared` and no dispatched effects, with unchanged event count,
original partial outcome and quarantine. This proves historical inspection,
not current-host execution or permission to replay the old operation.

The native matrix now has a separate physical runner over **all 3,360 original
IDs**. It uses the same service/SDK, role responses, controls and assertions as
Local/SSH; only generated provider HTTP is intercepted inside the real guest.
After unexplained pre-bootstrap failures, the user explicitly approved
**provider-only mechanical fixtures**, not a product-policy change or native
scope exclusion. Each fixture first reviews the real installed/default runtime,
then explicitly removes tool-domain grants and separately probes that stricter
configuration. Each actual model launch admits only its generated selected
provider origin; its effective scope is asserted and retained per cell. This
avoids an unrelated public GitHub Meta lookup for every mechanical VM. Actual
factory/GitHub Meta, cold provider networking, network denials and effective
policy remain separate **mandatory** gates; their original failures are not
replaced by these stricter generated fixtures. All original axes/IDs remain.
Two bounded Node preload arguments preserve the existing eight-argument and
4,096-byte-per-argument limits. Each cell binds signed guest/plan/signer/image
identity, authenticated terminal journal, non-root Linux request witness,
all-role accounting, unchanged source and confirmed owned-guest absence.
No native result is inferred from a controller request or the source report.
The independent native report retains failed/unrun IDs and only declares its
nominal set passed after every cell and fixture cleanup completes. It does not
certify live quality/billing, arbitrary scripts, hosted CI or other N1-N8 gates.

The only coupled runtime repair retains a bounded 3,000-character tail of
pre-readiness CLI diagnostics in the existing failure diagnostic. Before
readiness no model credentials have been dispatched. It preserves the
64-KiB diagnostic-output bound and 60-second readiness deadline, never promotes
unconfirmed guest absence, and does not record ordinary post-readiness output.
The physical generated-preload refusal fails without this repair because its
actual cause is discarded behind a generic cleanup error.

There is no new library, production API, event, schema, migration or permission
authority. The separately approved SendBox pin update retains Apache-2.0.
Existing Node/React/OpenTUI/pi-ai MIT, Sharp
Apache-2.0, OpenSSH BSD, Git GPL-2.0-only and SendBox Apache-2.0 reuse is
unchanged. Existing failure/recovery tests remain distinct; no low-signal test
was removed.

Before changes, fresh generated Phase 0 checks passed provider streaming and
cancellation (31.3085 ms), SQLite (1,000 events, append p95 0.05375 ms), owned
macOS PTY cancellation (152.124583 ms, zero known survivors), actual OpenTUI
(60 updates, 16.916475 ms/update), hidden Electron (190.110958-ms cold start,
449.21875 MiB, 12.77-ms frame), filesystem/Git (2,000 files, 5.519375-ms status),
model controls (55.542542 ms), configured-provider transport (38.3135 ms),
pinned loopback SSH (144.093875 ms), retention/Ghostty (500 events/250 retained
artifacts; actual input/resize), archive reuse (828.144958 ms) and generated MCP
OAuth (17.840209 ms). Locked dependency restoration reports zero vulnerabilities.
The generic foundation spike's static historical unavailable rows remain
limitations of that old probe, not fresh discovery of the current native build.

## Current disposition, 2026-11-10

Audited main is `2f6c4bc`, merged #60, protocol99. The
[clean protocol99 test cut](session-inbox.md#final-qualification-2026-11-10-utc)
`c39995a` re-executes all 6,720 required Local/SSH source cells; all 3,360
native nominal cells remain present and explicitly unqualified. The older
protocol93/94 reports below retain their exact identities.

The same current record separately proves ten selected native gates on exact
protocol99 worker/bridge/package bytes, including provider/network policy,
retry/checkpoints, three physical rewind scopes, packaged desktop confirmation
and verified original-guest teardown. It replaces a blanket claim that no
current guest/startup/rewind evidence exists, **not** the complete N1-N8
role/control/input/candidate/concurrency/loss matrix.

The 2026-11-07 N0 release observation below is historical. Live release
[SendBox v0.2.5](https://github.com/mbianchidev/sendbox/releases/tag/v0.2.5),
published 2026-11-08, includes mbianchidev/sendbox#80. Moguri still pins reviewed
0.2.4 bytes; this audit neither upgrades nor probes a personal runtime.
Do not carry the old "repair unreleased" description forward as an independent
universal blocker.

Hosted main
[run 42838925934](https://github.com/mbianchidev/moguri/actions/runs/42838925934)
still has no executed job steps because of account payment/spending eligibility.
The [current acceptance checklist](../remaining-milestone-gaps.md#remaining-first-milestone-acceptance)
keeps that gate, the full remaining native set and final integrated acceptance
separate from live-model quality/billing and optional public distribution.

The original starting checkout was merged main
`73821b7f77b29724027380c7e1ff3783ad731d26`, including #51 and #52:
protocol **93**, `0.31.0-alpha.1`. Protocol92 receipts in the
[completion archive](milestone-completion.md) keep their original scope.

## Change contract

Reuse the actual service, worker, SDK, append-only encrypted store, provider
adapter, budget ledger and pinned rootless loopback OpenSSH fixtures. Node,
React, OpenTUI, TypeBox and maintained pi-ai retain their existing MIT licenses;
Sharp is Apache-2.0, the document parser retains its documented
Apache-2.0/MIT/BlueOak-1.0.0 components, system OpenSSH is BSD-licensed and Git
is GPL-2.0-only. SendBox remains Apache-2.0. No dependency, model framework,
installer, credentials, paid inference or additional permission authority is
introduced.

This is qualification code and documentation, not a new production API,
durable event, schema or migration. Genuine91 upgrade/reopen coverage remains
in `tests/milestone-model-migration.test.ts`; it is neither rebuilt nor relabeled.
Generated model declarations and lineage/rate sources are mechanical fixtures,
not real model quality, independence, calibrated confidence or live billing.

Two coupled desktop defects are corrected. Budget readiness now compares
actual control/root/model/capacity inputs, not a newly allocated but identical
model array on every snapshot. An unrelated acknowledged draft update must
not disable a field mid-edit or restart its readiness request. Current edit
and save intent are read synchronously before an older effect may reload
controls. Changed actual policy still disables finite controls and preserves
pending caps. The original renderer reproducibly issued a third readiness read
where the unchanged-input baseline had two; the regression asserts no extra
read and exact retained values. Single/Compound setup text also no longer
claims obsolete blanket Local-only, image or tuning restrictions.

## User-directed protocol94 follow-up

The subsequent GitHub/approval/keyboard request adds
[authenticated search, canonical fresh tool IDs and composer controls](session-github-workflows.md#protocol94-github-and-input-follow-up).
That source cut is protocol94. Its metadata-only upgrade and actual issue-origin
restart do not change the original genuine91 witness. Earlier protocol93
reports, app/worker hashes and installer receipts below remain immutable
historical evidence; they cannot qualify these changed bytes.

The nominal cell definition and native criteria are unchanged. Fresh Local/SSH
execution, complete client/SDK/package checks and resulting current identities
were recorded separately. At that cut every Sandbox cell remained unqualified,
with the released SendBox 0.2.4 Meta-DNS prerequisite and exact physical N0-N8
evidence still missing. The current disposition above distinguishes later
feature-specific receipts from the still-unqualified wider native set.
Neither a producer image nor generated GitHub tests replaces physical evidence
or the account-blocked hosted-main run.

## Required nominal cells

`tests/fixtures/milestone-combinations.ts` defines the independent axes.
`tests/milestone-combinations.test.ts` checks their complete Cartesian product,
unique IDs and every marginal count before executing source cells.

| Axis | Required values |
| --- | --- |
| Env | Local; pinned SSH Remote; native Sandbox |
| Selection | Fixed; automatic singleton Single; explicitly configured classifier/solver Single; gated Cascade with escalation; Critique with same-model revision and re-review |
| Autonomy | Manual; Guided; explicit Autopilot; configured bounded-model Autopilot Max |
| Budget | Unlimited; tokens; USD; combined tokens and USD |
| Window | Actual maximum; integer-floored half above the 8,192-token minimum |
| Effort | Default; every declared exact wire level: minimal, low, medium, high, xhigh, max |
| Input | Text; locally normalized approved image; retained document descriptor with bounded approved inspection |

This is **10,080 nominal cells**, not six representatives: **3,360 per Env**.
Local and pinned SSH account for **6,720 executable source cells**. All
**3,360 native cells remain explicitly unqualified** pending their complete
current required-set evidence. Later feature-specific physical receipts do
not qualify those cells; they are not skipped tests counted as passes.

Each source cell has a fresh service-owned session and exact controls. The
generated compatible transport declares 32,768/16,384-token windows and the
six actual forwarded effort values. The test rechecks immutable advertised
capacity, every actual `model.started`, prepared request, output bound, role
charge and selected original input. Source groups own separate roots and
services; four groups run concurrently without sharing a writer or profile.
There is no continuous-window sampling claim: the exact integer, minimum,
rounding and discrete-provider rules have their separate criteria below.

Finite positive cells use an explicitly estimated 1,000,000-token and/or
10-USD cap with fresh generated input/output rates. Those ceilings let the
complete configured future set fit; they do not prove an exhaustion boundary.
The independent exact-cap, unknown-rate, concurrency and wind-down tests below
prove those boundaries without weakening them.

Configured local endpoints currently advertise **no adjustable thinking**.
The fixture does not give them invented effort support. The separate fixed
and singleton-Kupo Local/SSH negative cases try all six overrides, retain
the exact image/document draft and controls, and assert zero inference or
charges. Ordinary compatible local-model paths retain their existing evidence
in `tests/kupo-combinations.test.ts` and the configured-model/SSH tests.
Performance, Savings, discrete windows, ignored/aliased thinking and
budget-based thinking remain conditional capabilities, not extra nominal
support inferred from a model name.

### Actual roles and context

| Selection | Text/image first response | Document response plus bounded-tool continuation |
| --- | --- | --- |
| Fixed | solver | solver, solver |
| Automatic singleton Single | solver; zero classifier calls | solver, solver |
| Explicit Single | router, solver | router, solver, solver |
| Cascade | router, draft, gate, escalation, re-gate | First set, then draft, gate, escalation, re-gate |
| Critique | router, draft, critic, revision, re-critic | First set, then draft, critic, revision, re-critic |

The ledger calls gates `critic`; the table distinguishes their semantics.
Every executed fixture call reports exactly 42 tokens. The test counts every
actual call, one-time reservation transfer and released unused hold, while
leaving billed USD null. Router/critic requests have zero tools; an omitted
wire list and an empty list both mean zero tools, not a permission grant.
Router reasons never become solver instructions.
The original admitted turn item is asserted byte-for-byte; public transcript
attachment labels are not mistaken for a changed prompt. Disclosed execution
contract paths identify the actual selected root. The client document source
path and, on SSH, the controller's Local project mapping must remain absent.

Images must reach every participating role unchanged. Documents enter as
descriptors, not whole originals or extraction. Only the selected response
can request one approved 512-byte section through the authenticated controller
snapshot broker. Workstation paths never enter peer requests. PDF/DOCX/XLSX
format/provenance, search and inert-formula semantics are separately proven
by the document tests; a DOCX dispatch cell is not claimed as a new OCR or
Office-execution capability.
Ten additional mixed image/document cases require both capabilities together,
every role's image bytes and the same bounded descriptor/tool boundary.

An additional **160 actual-question cases** cover
`2 Envs x 5 selection paths x 4 autonomies x 4 budgets`. Manual, Guided and
Autopilot wait for a real user answer; Guided advice retains the selected
solver actor. Only the exact configured technical-choice delegation enables
one bounded-model Max decision. Its original provider/model, tool-less call,
42-token charge and non-user answer actor remain visible. Selecting Max
without a question does not itself manufacture or pay for a decision.

## Required conditional and failure criteria

These are explicit outcomes, not cells silently removed from the matrix.
Existing tests are reused where they already exercise the real boundary.
References name executable tests, not historical pass totals.

| Criterion | Required outcome and exact source evidence |
| --- | --- |
| Presets, exact windows and stale declarations | Supported exact values dispatch without clamping; unsupported/discrete/stale values preserve controls/history. `model-windows.test.ts`: "working windows use the exact maximum and floored half" and "SDK context choices bind provider windows"; ten new "exact arbitrary" Local/SSH cases use 24,577/high. |
| Genuine effort and mode | Unsupported, ignored, aliased or underfunded thinking is blocked before paid work. `model-controls.test.ts`: “transport capability lists reject silently ignored”; `kupo-options.test.ts`: “preserve provider-declared windows”; `kupo-modes.test.ts`: “budget-based thinking cannot be labeled xhigh/max” and actual Performance/Savings cases. |
| Complete future context | An overfull classifier/review/revision/test envelope cannot truncate history or acquire another model. `kupo-options.test.ts`: “complete future reviews must fit”; `compound-options.test.ts`: exact classifier/all-role preview, 98,305-token Local/SSH dispatch and changed-review refusal. |
| Image/document capability | Incompatible models retain context and block admission. `context-inputs.test.ts`: “images are locally normalized” and intact image requests; `document-attachments.test.ts`: tool-incompatible drafts/held queues and approved pinned-SSH inspection. The new nominal cells require every actual role's image support. |
| Exact model and lineage | Foreign/duplicate API bindings, missing lineage, extra model authority and changed prepared models cannot dispatch another role. `kupo.test.ts`: “never dispatches a prepared API model different”, “foreign bindings, extra authority and unknown critique lineage”, and “changed routing policy during gate preparation”. |
| Profile/root/peer/build ownership | Wrong owners are denied; aliases cannot create another writer or borrow controller metadata. `profile-remote-roots.test.ts`, `remote-transport.test.ts`, `model-readiness-transports.test.ts`, `candidate-env-protocol.test.ts` and `candidate-env-leases.test.ts` bind actual captured ownership. |
| Allowed Env and other hard policy | New Local work is denied after exclusion; only an already-admitted Local turn may finish. `profiles.test.ts`: “global environment policy is atomic across profiles”; `platform.test.ts`: “hard tool denials win”; `approval-memory.test.ts`: actual explicit autonomy actors and exact command/MCP grants. |
| Actual user and stale decision races | Human intervention, revoked delegation, changed root/provider and hard denial win. `decisions-authority.test.ts`: actual human approval, revoked delegation, disabled provider, replaced Local root and failed stop-intent persistence. `decisions-policy.test.ts` keeps real Jev's unenforceable output contract blocked. |
| Full token/USD set and rates | Whole future-role plans precede dispatch; insufficient, stale or unpriced sets are blocked, not free. `budget-plan-batches.test.ts`, `kupo-budgets.test.ts`, `decisions-budgets.test.ts` and `winddown-budget.test.ts` prove exact owners, micro-dollar bounds and current stricter caps. |
| Concurrent capacity and unknown/lost usage | Unknown means held, not zero; another profile, deletion or reset cannot refund it. `budgets.test.ts`: “actual concurrent project-free calls”, stopped-provider restart, ignored output limits and failed settlement; `profiles.test.ts`: global reservations; `kupo.test.ts`: unknown draft/gate accounting. |
| Stop and failed cleanup | Stop cannot select unreviewed tools, fake an answer or assert unobserved termination. `supervisor.test.ts`: persistent signal denial; `decisions-owned-transports.test.ts`: private Stop, reply loss, failed persistence and late exact SSH result; `candidate-reconciliation.test.ts` retains partial outcomes. |
| Controller/SSH loss and no replay | Actual SIGKILL, interrupted storage and late original receipts preserve owners/holds without rerunning inference/effects. `kupo-recovery.test.ts`, `budget-plans-recovery.test.ts`, `remote-recovery.test.ts`, `decisions-transport-loss.test.ts` and `candidate-transport-recovery.test.ts`. |
| Retained drafts, queues and typed input | Failed capture, stale revisions, policy changes and restart preserve source bytes and actors. `document-attachments.test.ts`, `paste-files.test.ts`, `paste-file-state.test.ts`, `questions.test.ts` and `profiles.test.ts`. Exactly 50/51 lines, UTF-8 boundaries and source grants remain their own checks. |
| Selected-boundary finishing and Git | The original SSH parent spends only its transferred checkpoint hold; Local Git cannot stand in for peer/native work. `finishing-owned-transports.test.ts` retains known/unknown/late outcomes; `winddown-budget.test.ts` and the reviewed checkpoint tests keep current policy and original index/HEAD. |
| Reviewed candidates and project tests | Original source is unchanged until separate user acceptance. `candidate-envs.test.ts`, `compound-envs.test.ts`, `compound-options.test.ts` and `candidate-transport-recovery.test.ts` cover real peer worktrees/scripts, denied tests, changed bytes, unknown cleanup and no replay. Local v1 and native root-less snapshot meanings remain distinct. |
| Readiness, schema and browser-safe SDK | Actual machine facts are not endpoint capacity or another Env's readiness. `model-readiness*.test.ts` and genuine91 `milestone-model-migration.test.ts` preserve one-use reviews, unknowns, ciphertext and markers; `npm run verify:sdk` uses an independently installed consumer. |

### Client evidence boundary

The service/worker matrix is not a screenshot or a client-owned mock.
`tests/tui-milestone-combinations.test.ts` and
`tests/e2e/milestone-combinations.spec.ts` additionally exercise all ten
Local/SSH selection pairs through actual OpenTUI and hidden Electron. They
edit half/high controls and warned combined caps, preserve a document draft,
send through the same SDK, and perform the exact human document-tool approval.
These are presentation/interaction contracts over the same authority, not a
claim that every nominal cell was separately clicked in each UI.

Compiled CLI evidence remains in `candidates-clients.test.ts`,
`decisions-clients.test.ts`, `model-readiness-cli.test.ts` and shared slash
tests. Installed SDK/application evidence remains separate from source imports.
Native TUI rendering, hidden desktop, a generated SSH process and an installed
SSH client do not establish physical SendBox or external-Linux release support.

<a id="remaining-native-gates"></a>
## Historical protocol94 native gates

These are the original gate definitions and their disposition at that cut.
The current disposition above supersedes stale release/blanket-availability
claims without rewriting these missing or failed physical receipts.

The refreshed live read on 2026-11-07 still finds released **SendBox 0.2.4**,
published 2026-10-24. The DNS repair
[mbianchidev/sendbox#80](https://github.com/mbianchidev/sendbox/pull/80),
head `b3aa9b6e7d36d89c8482d1f7373faa824f717862`, merged at
`dab5f4f69477ad405331dc5a0576db2e8138ed7a` on
2026-11-06T23:25:13Z. No post-repair release was published at this read.
The documented released gateway loses Meta A/AAAA replies before workload
readiness. Same-upstream TCP recovery stays inside the original absolute
deadline, but merged source is not yet reviewed/pinned released Moguri input.
The current released macOS tar archive remains SHA-256
`94168cd57db14740a49fbdae88e63d7d5aa99f61da4ff47b1863d2058e774b31`.
This task changes neither upstream, installed runtimes, egress,
personal authorization nor another user's processes.

| Gate | Disposition at the protocol94 cut |
| --- | --- |
| N0: released Meta-DNS prerequisite | **Blocked after source repair merged.** A newly released, explicitly reviewed dependency must be pinned before qualification; merged source/CI is not a released-byte receipt. |
| N1: exact current payload/distribution | **Producer/archive inputs verified; physical binding unqualified.** The exact protocol94 image/app/archive identities in the current cut below are fresh. Protocol93 identities remain historical. The new payload still needs an actual matching guest, installation/attestation/trust root and original signed launch. A producer image or package is not a guest run. |
| N2: cold real network and effective policy | **Unqualified.** First credential-free selected-provider metadata request in a fresh guest, no warm-up/retry; retain actual Meta domain/CIDR/CNAME delegation and private/unapproved/direct-network denials. Never broaden egress or claim exact-host-only scope. |
| N3: real guest/control/ownership | **Unqualified.** Verify signed guest/root/build, non-root controls, mounts and authenticated bridge; never mount a live source checkout or substitute controller facts. `sandbox-runtime.test.ts` and the physical qualifier are reproduction boundaries, not current passing receipts. |
| N4: native nominal controls and input | **Unqualified: all 3,360 cells remain present.** Qualify fixed/both Single paths/all Kupo patterns, four autonomies, whole-role caps, genuine windows/effort and compatible text/image/document/scoped-paste paths on the actual current guest. Unsupported roles need explicit denied/blocked outcomes. |
| N5: selected finishing/checkpoints | **Unqualified.** Actual native private role/hold/known-or-unknown result, selected boundary and original guest cleanup; source acceptance followed by separately reviewed original Local Git. Sandbox-only policy still denies that Local Git, and native output cannot claim a commit. `sandbox-finishing.test.ts` and `native-checkpoint.test.ts` retain this separation. |
| N6: native candidate acceptance | **Unqualified.** Actual bounded private snapshot creation, exact source/stage reviews, native script/tests, denied/rejected preservation, original private application and separately accepted publication. Local/SSH worktrees and a passing critic cannot qualify it. |
| N7: loss, cleanup and late receipt recovery | **Unqualified.** Actual controller/guest/control loss, stop/failed signals, frame/terminal-storage failure and late known/unknown accounting must retain original SID/plan/signer/journal/root, partial effects and no replay. Cleanup additionally needs verified original guest absence, never PID inference or CLI EOF. |
| N8: native clients and concurrency | **Unqualified.** Actual native SDK/CLI/TUI/desktop controls, fresh policy/human override and simultaneous profile/root leases over N1-N7. Existing generated/older physical rows do not count for changed current bytes. |

Current bytes must qualify together. The [historical native receipts](sendbox-0.2.4-qualification.md),
[managed prerequisite investigation](managed-sandbox.md#current-verification-and-unresolved-native-startup)
and protocol92 development DMGs remain immutable evidence about their own cuts.
No missing native gate is replaced with Local execution, producer-image
success, a skipped test, a model verdict or an older signed result.

## Reproduction and retained results

Run the build before tests; workers/CLI and the report's compiled identities
come from `dist`, not `npm ci` alone.

```sh
npm ci
npm run build
npm run typecheck
npm exec -- playwright install chromium
node --import tsx --test tests/milestone-combinations.test.ts tests/tui-milestone-combinations.test.ts
npm run test:e2e -- tests/e2e/milestone-combinations.spec.ts
npm test
npm run test:e2e
npm run verify:sdk
npm audit --audit-level=moderate
```

The generated report is
`.test-output/milestone-combinations/source-report.json`. It retains every
nominal ID, actual source-pass/failed/not-run or native-unqualified outcome,
source commit/dirty flag, protocol, Node and source/compiled input digests.
Each run also retains a uniquely timestamped report; updating the latest
pointer does not overwrite an earlier failed or successful receipt.
An ordered JSONL progress journal retains actual cell results and separately
confirmed fixture cleanup during execution. An interrupted journal is not a
complete-source pass. Source fixtures group six window/input cells per exact
Env/selection/autonomy/cap/effort binding, avoiding unnecessary retained-history
growth; their document captures serialize against the real shared two-parser
process limit. The product limit is unchanged, and no rejected capture is
silently retried.
Only the complete source set plus known fixture cleanup can produce
`sourceStatus: PASS`; `nativeStatus` remains `UNQUALIFIED`. A failed or
interrupted group leaves later cells not-run, not inferred successful.

The generic Phase 0 spike's historical unavailable rows are not current
feature discovery. This task's repeated generated prerequisites pass provider
stream/cancel (31.78 ms cancellation), SQLite (1,000 events, 0.0592-ms append
p95), owned macOS PTY cancellation (152.09 ms, zero known survivors), actual
OpenTUI (60 updates, 17.26 ms/update), hidden Electron (212.05-ms cold start,
448.84 MiB, 8.23-ms frames), filesystem/Git (2,000 files, 6.48-ms Git status),
supported model controls (59.40 ms), local-provider transport (41.02 ms) and
pinned loopback SSH (152.82 ms). Initial missing `node-pty` was restored with
locked `npm ci`, which reports zero vulnerabilities.

The first complete source attempt at `d7f6648` is a **failed outcome**:
2,691 passes, two failures, three cancellations and 29 explicit skips in
3,488,562.98 ms. The installed Chromium revision was absent; the aggregate
actual-question test hit its five-minute parent deadline; and the matrix
identity preflight incorrectly requested `dist/sdk/runtime.mjs` rather than
the real `dist/runtime.mjs`. The nominal matrix did not execute in that attempt.
Its other passing cases do not substitute for the missing required cells.

The corrections retain the original per-cell/model/context/output/latency
bounds. Aggregate harness deadlines now account for the complete declared
case count, and a preflight failure still writes all required cells as
not-run/native-unqualified before rethrowing. Chromium preparation is an
explicit pinned developer/macOS-CI action, not a product tool download or a
personal browser launch. Main-push-only CI and the external account gate are
unchanged.

The `d00addd` continuation is **interrupted and incomplete**, not a passing
source sweep. Running four fixture services in one Node process exposed the
actual shared two-parser capacity guard. Some document captures were correctly
refused before model admission. The test harness now schedules captures
without raising that limit, replaying a rejected request or removing a cell.
Smaller six-cell fixture histories and per-result progress receipts retain
the same independent axes and exact assertions. The interrupted log remains
historical evidence, not qualification of its remaining cases.

## Final frozen source and package cut

The complete corrected qualification uses clean source
`5051b6f15c8cd41d55967820b24ffed3e95150cb`, protocol **93**, Node **26.12.0**,
`0.31.0-alpha.1`. Application/worker bytes are the frozen
`d7f66488c2cbe105de32c824a17f108782daa570` cut. Later harness/CI/docs corrections
change neither `apps`, `packages`, production scripts, dependency manifests nor
the delivered binaries. They do not relabel either earlier failed attempt.

| Evidence | Actual final outcome |
| --- | --- |
| Complete nominal source set | **6,720/6,720 PASS**, zero failed/not-run source cells, 3,360 explicitly native-unqualified cells; all 10,080 IDs retained |
| Primary matrix accounting | 23,744 actual generated calls and 997,248 generated provider-reported tokens; every original entry settled once, billed USD remains null |
| Exact matrix interval | `2026-11-06T20:44:51.159Z` to `2026-11-06T22:22:56.135Z`; 5,884,976 ms |
| Complete macOS source/service/worker/migration/restart/CLI/actual TUI suite | **10,538 passed**, 29 explicit physical/platform skips, zero failures/cancellations; 10,567 tests in 9,355,021.52 ms |
| Complete hidden desktop suite | **376 passed**, five explicit skips, zero failures; 381 flows in 14.5 minutes |
| Strict types and production build | PASS |
| Independently installed packed SDK | PASS for browser/React/Node/MCP imports/declarations, actual current runtime/readiness/review/pooled controls, genuine retention/restart and pinned-SSH candidate/owned-role lifecycles; audited consumer has zero vulnerabilities |
| Actual packaged application | PASS for ad-hoc identity/mascot, bundled Node/CLI/TUI/service/worker, owned generated model/tool/SSH/console/retention/upgrade paths and original input/receipts without replay |
| Actual packaged critical desktop set | **16/16 passed** in 50.7 seconds, including every Local/SSH selection path and the budget-input/policy regression |
| Packaged retained-history gate | Actual 62,836,224-byte history: negotiation 26.79 ms, hidden desktop 466.65 ms; remaining package gates retain their unchanged per-sample bounds |
| Packaged shell memory | 549.55 MiB for one console and 559.11 MiB for four against the 600-MiB shell-only budget; control-plane/broker and combined totals stay separately disclosed |
| Dependency audits | Root, independently installed consumer and no-cache Linux producer all report zero vulnerabilities |
| Development DMG | Exact disk-image checksum and standalone archive/bundle integrity PASS; no installation, Finder/app opening, notarization or physical native acceptance |

The primary call-role totals are solver 5,376; router 4,032; draft 3,584;
critic/gate 7,168; escalation 1,792; revision 1,792. The separately executed
160-question set additionally proves actual user/Guided/autonomy behavior and
40 metered bounded-model Max decisions across both Envs, every selection path
and every cap. It is not hidden inside the primary call count.

The final report is **15,434,978 bytes**, SHA-256
`fb48ee2235eca618879ef105cb80071238eb8d299b3b2cf9d57f57fde033f12c`.
Its immutable receipt is
`.test-output/milestone-combinations/source-report-20261106204451159.json`;
its ordered progress journal is
`.test-output/milestone-combinations/source-progress-20261106204451159.jsonl`.
The report's source status is PASS and native status is UNQUALIFIED, not an
overall issue/milestone acceptance flag.

### Exact producer and delivered identities

The no-cache Linux arm64 producer passed in 119,662.83 ms with generated native
PTY/cache checks. This is producer evidence only. The matching distribution
contains the original released SendBox 0.2.4 archive/trust root, not the
unreleased DNS repair.

| Artifact | Exact identity |
| --- | --- |
| Immutable workload | `docker.io/library/moguri-worker@sha256:32848e35297541137f118f35862c95d5b04a0bf3669c0141465843d2ee836671` |
| Compiled worker SHA-256 | `f869340cb7a08f1403bcdebcea9f93f180b4484917848e77edee78d20ab2ed13` |
| Compiled bridge SHA-256 | `a86b0333718a2540696d129cfbea6c3fc4f4d17393de65da866333bed5f3d2f1` |
| Complete distribution payload SHA-256 | `092611d58441bb4a140707c7ac30d6c1eae6f4dbc4b3ba0c0d0d5ae33cb3b995` |
| Worker/init OCI archive | 526,479,360 bytes; SHA-512 `049744da53582f74b85f9a31aa342ff34635358239e7b50266dd09b7535aaf87072dc670f84c805a53fd223258de49cf3c8cda6ff681f290f26e53bdb9fa11e9` |
| Development ZIP | 874,608,005 bytes; SHA-512 `e00da5cd808a15f03530694a7556b7d9e22ab31f8aa80c6d2694c46dca0aee706954fda237b18992537e98987e347f715e8282a99c28cab909ed6d1c20745ac9` |
| Canonical ad-hoc bundle SHA-512 | `22e7521a6e3f6e9bb7e0d9243bc873b3e1f0fc6a1996646afe3ba24d02178fbe626437ff15c3c912c03b402efc789282f012126721a7a21417dddd9586ec4b47` |
| Development DMG | 890,609,045 bytes; SHA-512 `2db1bb6bff25774d1151581e02142096aead9bab287834c71559acbbba7062f15dd18c5d2f3227ddf6dc3a893bc7b1b8f5c84a74320c71b5776b09f8c5a536a0` |

Delivered output directory:
`release/qualification-builds/milestone93-d7f6648/`.
Existing renderer-chunk (>500 KiB), experimental OpenTUI FFI and absent optional
Icon Composer `.icon` notices remain visible; the actual `.icns` identity passes.
The producer's npm-major-update notice is informational, not a dependency
update or vulnerability. No warning, deadline or failed receipt was hidden.

Main hosted [run 42250298984](https://github.com/mbianchidev/moguri/actions/runs/42250298984)
at `73821b7` is **failed before either OS job started a step**. Both annotations
say: “The job was not started because recent account payments have failed or
your spending limit needs to be increased.” macOS capacity and Ubuntu image
transition notices are separate warnings. This is account-owned eligibility,
not a source-test failure. Keep main-push-only CI; no working-branch checks is
not green CI. Real provider/billing, physical native and public
signing/notarization/distribution evidence remain separate gates.

## Protocol94 frozen source and package cut

All executable source, tests and follow-up documentation were committed and
pushed as `07087bf509147261a0f855b4e56f8adc8b2ed2b7`. A fresh matching build was
made from that clean cut before qualification. Protocol is **94**, Node
**26.12.0**, app **0.31.0-alpha.1**. The later evidence-only notes do not change
that worker/SDK/TUI/desktop source or relabel any protocol93 receipt.

| Evidence | Actual current outcome |
| --- | --- |
| Complete required source cells | **6,720/6,720 PASS**, no failed/not-run source cell; every one of 10,080 IDs retained, 3,360 native-unqualified |
| Primary all-role accounting | 23,744 actual generated calls, 997,248 generated reported tokens; billed USD null |
| Primary matrix interval | 2026-11-07T01:22:28.379Z to 2026-11-07T02:33:53.946Z; 4,285,567ms |
| Complete source/service/worker/CLI/native-TUI/migration/restart suite | **10,562 passed**, 29 explicit platform/physical skips, zero failures/cancellations; 10,591 total, 6,843,964.07ms |
| Complete hidden desktop suite | **382 passed**, five explicit skips, zero failures; 387 total, 12.4 minutes |
| Types and matching production build | PASS |
| Independent packed SDK | Approved/audited consumer installation, browser/React/Node/MCP imports/declarations, actual runtime/CLI/worker and all 12 private continuation probes PASS |
| Actual new packaged app | Ad-hoc identity/Node/SDK/service/worker/CLI/TUI, original scoped model/tool/SSH/console/candidate/retention/upgrade paths PASS |
| Actual new packaged desktop | **17/17 PASS**, 50.2s: every Local/SSH selection pair plus all six new GitHub/approval/input/copy reproductions |
| Packaged shell memory | 549.89MiB one console; 559.61MiB four consoles, against the 600MiB shell-only bound; other runtime/user-program totals disclosed separately |
| Dependency audits | Root, independent installed consumer and no-cache Linux producer: zero vulnerabilities |
| Installer/archive | DMG checksum and standalone bundle/archive/runtime integrity PASS; no personal installation, Finder opening, notarization or physical native acceptance |

The primary roles remain solver 5,376; router 4,032; draft 3,584; critic/gate
7,168; escalation 1,792; revision 1,792. The separate actual-question set still
executes all 160 cases and 40 metered bounded-model Max decisions. Every
ownership/capability/budget/context/override/stop/late-result/concurrency and
restart criterion above retains its current source witness. Genuine91 and
other retained predecessor migration fixtures were not rebuilt or relabeled.

The new immutable report is **15,435,107 bytes**, SHA-256
`08e7cded52e83453b53796568c67e9501de50b259ed9950676d8795346715e36`:
`.test-output/milestone-combinations/source-report-20261107012228379.json`.
Its ordered journal is
`.test-output/milestone-combinations/source-progress-20261107012228379.jsonl`.
Full source, independent SDK, hidden desktop, package build/verification and
packaged-desktop logs are separate `protocol94-*-07087bf` files in
`.test-output/`. No native-image/physical receipt is claimed by the report.

### Current exact artifact identities

The no-cache locked Linux arm64 producer passes in **71,573.09ms**, preserving
the exact tested worker/bridge bytes. It proves a producer workload, not a
physical SendBox guest or external Linux-host qualification. The bundle retains
the released 0.2.4 archive, signed manifest/key and trust root; it does not
substitute the merged unreleased repair.

| Artifact | Exact identity |
| --- | --- |
| Immutable workload | `docker.io/library/moguri-worker@sha256:268dacf7defdd4b8e9ae4af71fb8d834eede721753a46db6979ae6a05ca335ff` |
| Compiled worker SHA-256 | `e5740ed0dfc76f956a772fef0f286b1e581257bb793d227ac38cf40d6b9557ec` |
| Compiled bridge SHA-256 | `65db5dd76e38513c6323ad6676e6faf7c3ed7f538f5289124f83e68ca6771c35` |
| Distribution payload SHA-256 | `29b9ad1b74a43e51558611e7872664bc94597581e82ddc88fd0c5c820e620b77` |
| Worker/init OCI archive | 526,479,360 bytes; SHA-512 `379565f13038773689dca99b91436b087af4798ba8052e29a4ec3ff4fe4dddbfa8a19ede5becc692e4b5174c3ef1fd7a9fd3e03072913b2a4294f58b58217f13` |
| ZIP | 874,618,330 bytes; SHA-512 `4fd44413ab8e3878a2c3437898d5abd105c36df05dd56ae7f91793a0909d786e730931100bbfb78be33ba470a0d8b4091c7f9c19b3b24eb157441fe5ac09a73a` |
| Canonical ad-hoc bundle SHA-512 | `d84c4e57638eafe9d34c11a9311f8cc1e3d6730e9a9ccee4de010d08293b08cbd0088c513cd4aeb05ec149b5cbcb3b3db4999ab8d18a6c8be579bf1059ddb7e9` |
| DMG | 890,611,301 bytes; SHA-512 `9243e1127b7cbedcd97a10d0204dfac0416fe68c9d8ba8a1859adaffd60814be3d05114a0a87801468a47183bbf315d53a652cb5436b5f073e289221b6017d42` |

New output directory: `release/qualification-builds/milestone94-07087bf/`.
The existing protocol93 output remains untouched. Optional Icon Composer
`.icon`, experimental FFI, lazy renderer-chunk and producer npm-major notices
are not hidden. Main hosted run 42250298984 still cannot start either OS job
because of billing eligibility; the macOS arm64 capacity notice is separate.
No branch CI was added or triggered. This cut did not finally accept Milestone 1
or the remaining native set. #38's later closed state is not native acceptance;
the current parent-owned checklist is above. Live-model/billing evidence and
public distribution remain separate from the unchanged milestone criteria.
