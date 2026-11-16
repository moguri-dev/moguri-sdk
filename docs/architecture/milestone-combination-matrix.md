# First-milestone combination evidence

This document defines Milestone 1's composer axes, conditional and failure
criteria and native gates, the current covering-array regression method and
the final full-product qualification.
[#39](https://github.com/mbianchidev/moguri/issues/39) owns acceptance;
#38 and #17 were consolidated into it. The unchanged
[milestone criteria](../implementation.md#milestone-acceptance-criteria)
remain authoritative. The criterion-by-criterion acceptance record is in
[first-milestone acceptance](../remaining-milestone-gaps.md#milestone-1-accepted-2026-11-15).

## Regression method: covering array

[D38](decisions.md#d38-covering-array-milestone-regression), signed off by the
project owner on [#69](https://github.com/mbianchidev/moguri/issues/69) on
2026-11-16, replaces the full Cartesian product in the normal test loop.
Milestone 1 was accepted on the full product (below); that record is
historical and is not re-qualified or relabeled by this method.

| Coverage | Cells or checks | Where |
| --- | --- | --- |
| Covering array | **78 cells**: 32 Local, 23 pinned SSH Remote, 23 native Sandbox. Every supported pair of values over all seven axes; every supported Env x selection x budget, Env x selection x input and Env x selection x effort tuple; the 15 Env x selection client journeys (Manual, combined cap, half window, `high` or default effort, document). | `tests/fixtures/milestone-covering-array.json`, checked by `tests/milestone-combinations.test.ts` |
| Manual Kupo effort | **72 refusals**: 4 Kupo selections x 6 non-default efforts x 3 Envs, each with no session, event, reservation, request or worker. These are the only excluded value pairs. | `Local/Remote/Sandbox manual Kupo effort cells reject…` |
| Focused contracts | 160 Local/SSH and 80 native actual-question actor/cap cases, 15 exact arbitrary-window cases, 15 mixed image/document cases, finite native critique, oversized native witness and the conditional/failure criteria below. | `tests/milestone-combinations.test.ts` and the named test files |
| Full product (opt-in) | All 10,080 IDs: 6,720 Local/SSH and 3,360 native, including the 6,912 refusal cells. | `npm run test:matrix` (`tests/matrix/milestone-full-product.test.ts`) |

`tests/fixtures/milestone-covering.ts` generates the array deterministically:
client seeds first, then the earliest product-order cell that covers the most
uncovered targets, then a reverse pass that drops redundant non-seed cells.
`npm run generate:covering` rewrites the JSON. The map test fails unless the
checked-in file equals the generator output, every target is present
(checked independently of the generator), the 15 client journeys are members
and the excluded value pairs are exactly manual Kupo effort.

Measured 2026-11-16 on an Apple-silicon development Mac at clean `c5ce5f6`
(protocol 108, Node 26.12.0), SendBox 0.2.7 and a no-cache worker image
`moguri-worker@sha256:18b1b2bf…a31afd` built by `npm run prepare:sandbox` in 82 s:

| Run | Result | Retained evidence (SHA-256) |
| --- | --- | --- |
| Covering Local/SSH source slice | **55/55** cells in 54 s, four groups concurrent (the full product took 5,281 s). | `covering-source-report.json` |
| Ten physical gates | **PASS 10/10** in 123.5 s (`scripts/qualify-sandbox.mjs`). | `qualification.json` `8db00a97387bdbab39340db371c54dbf3faacf10f8217565fa6e816ed133c2e7` |
| Covering native slice | **PASS 23/23** guest executions in 62.9 s, each with its own signed witness and `owned-guest-stopped` (71 generated calls). | `covering-native-report.json` `edfa5788f9c5c4109dcdc650313c432a3696e1278b4d5b48a2bf8ecfe70a3341` |
| Full `npm test` | **3,182 pass, 65 native-gated skips, 0 failures** in 3,423 s (the last full-product run took 6,652 s). | |
| Every native-gated case in `tests/milestone-combinations.test.ts` and the TUI mirror | **134/134 pass** in 351 s: the covering slice, 80 actor/cap questions, 24 refusals, arbitrary windows, mixed attachments, finite critique, oversized witness and 5 TUI journeys. The 5 native hidden-desktop journeys pass in 1.0 min. No owned guest remains. | |

`npm test` no longer contains a multi-hour matrix. The covering native slice
has a 30-minute test bound; the ten physical gates and the other native-gated
cases run separately as before. These are regression measurements, not a new
milestone qualification.

Reports are version 2 and carry `method: "covering-array"` or
`method: "full-product"`. Covering runs write
`covering-source-report.json`, `covering-native-report.json` and their
`covering-*-progress-*.jsonl` journals; the full product keeps
`source-report.json`, `native-report.json` and `native-group-report.json`.
Version-1 reports keep their original full-product meaning.
`scripts/merge-milestone-group-receipts.mjs` combines only version-2
full-product native groups.

## Final qualification, 2026-11-15

<a id="current-qualification-2026-11-13"></a>
<a id="current-build-qualification-2026-11-11"></a>
<a id="current-disposition-2026-11-10"></a>
<a id="patched-image-acceptance-continuation-2026-11-14"></a>
<a id="protocol102-continuation-2026-11-12"></a>
<a id="final-frozen-source-and-package-cut"></a>
<a id="protocol94-frozen-source-and-package-cut"></a>

Milestone 1 was accepted on the full product, before D38: all 10,080 required
nominal IDs pass at one exact cut: 6,720 Local/SSH source
cells in the full source invocation and all 3,360 native Sandbox cells in a
single whole-matrix invocation. No complete-group merge, partial report or
earlier image receipt contributes to this result.

### Exact identity

| Input | Identity |
| --- | --- |
| Final cut | Clean `18e3f78` for the source, desktop, SDK and package runs; clean `e67faf511b4cae0be6d01273bb56c196683c91c1` (`dirtyAtStart: false`) for the native runs. Protocol **106**, Node **26.12.0**, `0.32.0-alpha.1`. Between them, only `tests/compound-options.test.ts`, `tests/single-routing.test.ts` and `tests/budget-metering.test.ts` change; all 19 native-matrix inputs and 20 ten-gate harness files are byte-identical at `18e3f78`. Later commits change documentation only. |
| Runtime cut | `d4dd58e` built the worker image. `3f03716` changes documentation; `e67faf5` only isolates `tests/native-fixture-receipts.test.ts` from the real distribution environment. Runtime, worker and native harness bytes are identical from `d4dd58e` through `18e3f78`. |
| Worker image | `docker.io/library/moguri-worker@sha256:130647503e9ad37b84ecc059447051e7ec7e44c506efbc2842f5dd987cf1d9c3`, a no-cache build (32.6 s) explicitly approved by the user. Independently verified: OCI index/manifest, all 14 layer digests, 9/9 embedded payload files and the non-root `node` entrypoint on pinned base `node@sha256:f6e55fb0…`. Worker `f86d5ad8…`, bridge `6e3246da…`, MCP worker `f10fe2ee…`, `package.json` `c0bb87b4…`. |
| Distribution | Private distribution digest `2599dfeeb330f6cef416d81c4a8808befda9c0d2e1509ff56e751f79aba3879d`. |
| Runtime | [SendBox 0.2.7](managed-sandbox.md#reviewed-027-distribution-2026-11-15), installed by the user at `/opt/moguri/sendbox/0.2.7` and independently verified; Apple Container 1.7.1. |

### Results

| Gate | Result | Retained evidence (SHA-256) |
| --- | --- | --- |
| Ten physical gates | **PASS 10/10** in 125,742.574 ms: artifacts/attestation, installed runtime, provider scope, cold network, worker accounting, grouped workspace, snapshot retry/checkpoints, per-turn rewind, desktop rewind, teardown. | `qualification.json` `fde48cd7d9762acdac20f62f2bd8b92f6066b77422b30e2c201681665ac4cd0a` |
| Native nominal matrix | **PASS 3,360/3,360** in one whole run (39 m 17 s): 1,056 guest executions, each with its signed witness and `owned-guest-stopped`; 2,304 manual-Kupo-effort refusals before admission (`not-started`). `nativeUnqualified: 0`. | report `0d8c2b96325056e788a27855de31acca1d4e0bbe75a40741e3ec3fbe7b7232a8`, journal `6cf3922a2bfb0084fcf7f4cd567edd4a6978f59a9d0240c9a27004d10a2c6769` |
| Native combination file | **3,483/3,483** pass, zero failures or skips, in 2,713,272 ms: the nominal matrix plus every native actor/cap, actual-question, mixed image/document, finite critique, oversized signed proof and group-selection guard. | `5aae1120c9b940ec4bc262cbec80897477eaac43f9deb9b970111d81f97514dc` |
| Native SDK/TUI/script/profile/loss cases | **97 pass** across 18 native-gated files at `3f03716` (retry/restaging, checkpoints, candidates, decision transports, profiles, reviewed scripts, finishing, containment, recovery, TUI). Its one failure was a test-isolation defect (a generated-receipt test kept the real distribution variable); fixed at `e67faf5`, where that test and the actual older-protocol pinned image case (fails before initialization, signed-guest cleanup verified) both pass. The original failure is retained in the log. | `c732d2d3db04ee53a9331601b9ab01eba6ed2c609f938b30247e42af3e7a06dc`, `79564dbbd41ad1c5a7d70bcb049b625be031215c12b4ed245e25e2bc87a1bd07` |
| Native hidden desktop | **26/26**: all 15 Local/Remote/Sandbox selection journeys, native checkpoint publication, actual source staging/publication, native script force/approval, and first-use SendBox in a project and a root-less chat. | `e8d057c935c42ae87895efa80c55a841d7af121f5989933be7aac3907a6afbe5` |
| Full source suite | Final run at `18e3f78`: **10,908 pass, 66 skips, 2 failures** in 6,651,804 ms, including **6,720/6,720 Local/SSH cells** (`sourceStatus: PASS`, clean tree). Both failures are load timing in `compound-options.test.ts` on a host shared with an external Chromium build (load average about 11): an SSH critique whose body passed but whose candidate worker missed the cleanup acknowledgement deadline (correctly retained as unconfirmed, never success), then the next case's 12-second wait. The same file passes 6/6 at the same commit under the same load and passed in the full `446cdc6` run. Earlier full runs at `e67faf5` (four stale manual-Kupo-effort tests, a missing pinned Chromium, one SSH wait) and `446cdc6` (one load-sensitive stream-timing floor) produced the test-only fixes now in `18e3f78`; their logs keep every failure. All 66 skips are native-gated cases that pass in the native runs above. | report `4993999e5e15f136d2b6c876d8642fbceacf7418b16e667cc29ad8079e88553d`, journal `af8fe01a5117f460178e1b05a8ebb48554e1c8b8f1c3e6d4921a8b987a19c98f`, log `6e7bedc31896a9c4e89b9a7b3a3a956feba8d2c6d5cff88b4bb483c998401898`, rerun `abcc9be9a39680aff81d04a261b265ff7608da416137473590e4768ad01e4ff8`; earlier logs `90f0a4b1…` (`e67faf5`), `f5b839a5…` (`446cdc6`) |
| Full hidden desktop suite | **433 pass, 12 skips, 0 failures** at `18e3f78` in 17.9 min. Eleven skips are native-gated and pass in the native desktop batch or the ten-gate desktop rewind gate; the packaged-app CLI install passes against the packaged app. An earlier full run at the same commit had one bare 30-second timeout in `session-workspace.spec.ts:32` that did not reproduce in 3 isolated runs or 10 repeats under CPU load; it stays in its log. | `922300450e208842cb02a4ffaebd671f0e2cc707c56fc8c1b8f6439fb05d72d8`; earlier run `4d8dbc63fd99430ee7b5840053b2b2201651a65e4b3cdc83da497ffb25ae6b70` |
| Packed SDK and audit | `npm run verify:sdk` PASS (independently installed packed consumer, all entrypoints, installed worker probes); `npm audit --audit-level=moderate`: 0 vulnerabilities. The ad-hoc signed development app passes `verify-sandbox-package` (bundled SendBox 0.2.7, approved image) and the packaged CLI install. DMG `3d3103dc…`, ZIP `a997fec8…`, manifest `f61e46fb…`; not notarized. | |

Evidence lives under `.native/qualification/current-sendbox-m8G2KZ` and
`.test-output/milestone-combinations`. After the final native run, inventory shows
no remaining owned guest.

The cold-network gate's only guest request is the credential-free selected
provider `/models` metadata read (HTTP 400 in 588 ms, as expected without a
token). SendBox 0.2.7 seeds the GitHub Meta scope from its host cache (251
domains, 6,008 IPv4 and 2,734 IPv6 CIDRs); neither the guest nor Moguri's probe
makes a `/meta` request.

The protocol104 desktop batch's four Kupo setup timeouts and its native-script
guest-readiness failure keep their original outcomes. The same cases pass on
this image without any raised deadline.

### Native gate disposition

| Gate | Final disposition |
| --- | --- |
| N0: released Meta-DNS prerequisite | **Met.** SendBox 0.2.7 is released, attested and installed; Meta is host-seeded. |
| N1: exact payload/distribution | **Qualified.** Approved image, verified layers/payload and matching distribution, installation, attestation and trust root. |
| N2: cold real network and effective policy | **Qualified** by the cold-network and provider-scope gates, with private/unapproved/direct denials. |
| N3: guest/control/ownership | **Qualified** by every signed launch, non-root controls, authenticated bridge and owned-guest teardown. |
| N4: nominal controls and input | **Qualified:** all 3,360 cells. |
| N5: finishing/checkpoints | **Qualified** by snapshot retry/checkpoint gates, native finishing and the native checkpoint desktop journey. |
| N6: candidate acceptance | **Qualified** by native candidate, reviewed-script and source publication cases. |
| N7: loss, cleanup and late receipts | **Qualified** by native guest-loss, cancellation, Stop, restart and older-image cases without replay. |
| N8: clients and concurrency | **Qualified** by native SDK, TUI and hidden desktop cases and simultaneous native profiles. |

## Native qualification method

The regression method runs every native-gated case in this file, including
the 23-cell covering native slice, in one invocation with the reviewed
installation, workload and distribution receipts:

```sh
MOGURI_NATIVE_INSTALLATION=.native/qualification/<run>/group-installation.json \
MOGURI_NATIVE_WORKLOAD=.native/sandbox-distribution/<build>/image.json \
MOGURI_SANDBOX_DISTRIBUTION=.native/sandbox-distribution/<build> \
./node_modules/node/bin/node --import tsx --test --test-name-pattern 'native|Sandbox' \
  tests/milestone-combinations.test.ts
```

The opt-in full product uses the same receipts with
`tests/matrix/milestone-full-product.test.ts`. Its 3,360 Sandbox IDs comprise
1,056 execution cells and 2,304 control-plane refusals of manual Kupo effort
(the classifier owns Kupo thinking). A refusal is not a VM-execution receipt;
reports tag each form and its cleanup separately.

<a id="reviewed-complete-group-coverage-2026-11-13"></a>
If a whole full-product run reaches its four-hour bound, `MOGURI_NATIVE_GROUPS` selects exact
remaining whole groups and `scripts/merge-milestone-group-receipts.mjs` combines
only verified complete-group receipts with matching runtime and input digests.
The original whole report then stays INCOMPLETE. The final qualification did not
need this method.

Retained harness and transport repairs found during qualification:

<a id="reviewed-native-cell-budget-allocation-2026-11-12"></a>
<a id="final-bounded-poll-observation-2026-11-12"></a>
<a id="complete-source-and-bounded-native-proofs-2026-11-12"></a>
<a id="registry-disappearance-and-original-command-recovery-2026-11-12"></a>
<a id="terminal-ack-ordering-repair-2026-11-12"></a>
<a id="nested-private-terminal-repair-2026-11-12"></a>
<a id="private-control-teardown-repair-2026-11-12"></a>
<a id="reviewed-pty-capacity-repair-2026-11-12"></a>

- Native settlement uses only the time remaining in the unchanged 45-second
  cell budget, not a separate 30-second phase cap.
- `waitFor` samples the actual condition before deciding deadline expiry, so a
  completion observed on the final wake is not a false negative.
- Qualification reads only the original signed completion proof, with its own
  2-MiB bound and exact SID/plan/signer/audit binding, without widening the
  128-KiB client publication limit.
- A service-registry file that unlinks between `open` and `fstat` reports the
  typed disappearance, never accepted bytes or a removed replacement.
- The controller sends the exact committed contiguous terminal ACK before the
  accepted terminal reply, once, because that reply releases the peer.
- The bridge initializes only its private TTY before saving its mode, and the
  private native launch disables echo before `exec`, so restored guest or child
  terminal modes cannot reflect controller frames.
- The maintained `node-pty` 1.2.0 beta fixes the macOS allocator regression
  seen after about 600 PTY exits; a 600-exit regression guards it.
- Budget-plan projection memoizes only static shape validation; ownership,
  transition, price and bound checks still run fresh.

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

## Composer axes and the full product

`tests/fixtures/milestone-combinations.ts` defines the independent axes.
`tests/matrix/milestone-full-product.test.ts` checks their complete Cartesian
product, unique IDs and every marginal count before executing source cells;
`tests/milestone-combinations.test.ts` executes the covering array over the
same axes.

| Axis | Required values |
| --- | --- |
| Env | Local; pinned SSH Remote; native Sandbox |
| Selection | Fixed; automatic singleton Single; explicitly configured classifier/solver Single; gated Cascade with escalation; Critique with same-model revision and re-review |
| Autonomy | Manual; Guided; explicit Autopilot; configured bounded-model Autopilot Max |
| Budget | Unlimited; tokens; USD; combined tokens and USD |
| Window | Actual maximum; integer-floored half above the 8,192-token minimum |
| Effort | Default; every declared exact wire level: minimal, low, medium, high, xhigh, max |
| Input | Text; locally normalized approved image; retained document descriptor with bounded approved inspection |

The full product is **10,080 nominal cells**: **3,360 per Env**.
Local and pinned SSH account for **6,720 executable source cells**; the
**3,360 native cells** run on the actual guest with the reviewed native
receipts. The covering array selects 78 of the 3,168 supported cells. In
either method, feature-specific physical receipts never stand in for a cell,
and a skipped native case is never counted as a pass.

Each executed cell has a fresh service-owned session and exact controls. The
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
`tests/e2e/milestone-combinations.spec.ts` additionally exercise the 15
covering-array client journeys (`milestoneClientCells()`: every Env x
selection pair, the Sandbox five native-gated) through actual OpenTUI and
hidden Electron. They
edit half/high controls and warned combined caps, preserve a document draft,
send through the same SDK, and perform the exact human document-tool approval.
These are presentation/interaction contracts over the same authority, not a
claim that every nominal cell was separately clicked in each UI.

Compiled CLI evidence remains in `candidates-clients.test.ts`,
`decisions-clients.test.ts`, `model-readiness-cli.test.ts` and shared slash
tests. Installed SDK/application evidence remains separate from source imports.
Native TUI and hidden desktop journeys run separately on the physical guest;
a generated SSH process and an installed SSH client do not establish
external-Linux release support.

<a id="remaining-native-gates"></a>

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
npm run test:matrix   # opt-in full product, about 1.5 h of Local/SSH cells
```

The covering run writes
`.test-output/milestone-combinations/covering-source-report.json`; the
opt-in full product writes `source-report.json`. Each retains every
selected ID, actual source-pass/failed/not-run or native-unqualified outcome,
source commit/dirty flag, protocol, Node and source/compiled input digests.
Each run also retains a uniquely timestamped report; updating the latest
pointer does not overwrite an earlier failed or successful receipt.
An ordered JSONL progress journal retains actual cell results and separately
confirmed fixture cleanup during execution. An interrupted journal is not a
complete-source pass. Covering source fixtures group cells per Env/selection;
full-product fixtures group six window/input cells per exact
Env/selection/autonomy/cap/effort binding, avoiding unnecessary retained-history
growth. Document captures serialize against the real shared two-parser
process limit. The product limit is unchanged, and no rejected capture is
silently retried.
Only the complete source set plus known fixture cleanup can produce
`sourceStatus: PASS`. The source report always marks native cells
`UNQUALIFIED`; the separate native report of the same method qualifies them. A failed or
interrupted group leaves later cells not-run, not inferred successful.
