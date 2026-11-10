# Session Inbox and explicit skill loading

## Change contract

This follow-up extends the same reviewed skill/checkpoint change. It reuses
the authoritative attention stream, actual question/approval owners, source
admissions, chat activity, SDK, existing React/OpenTUI clients and Moguri SVG
icons. Node, React, OpenTUI and TypeBox retain their existing MIT licenses.
There is no new dependency, provider, authentication flow or model-owned
permission.

The shared API/schema advances from98 to99. Atomic
`session_inbox_schema=1` and `explicit_skill_load_schema=1` markers preserve
genuine98 admission/checkpoint history, original ciphertext, owners, receipts
and accounting. Missing/corrupt/premature markers and actual future history
must fail without rewriting state. Historical skill-use records stay
inspectable; an upgrade never invents a source load.

## Inbox authority

Inbox is the profile resource immediately after Dashboard. It replaces the
titlebar notification destination and uses the existing active-attention
lifecycle. Each session notification opens its exact surviving session;
project-free and archived sessions keep their own identity. Global GitHub
observations retain their existing independently reviewed destination.

Read acknowledgement does not answer, approve, resume or start a model.
Deleting a notification is a separate actual-user command. It retains an
inactive deletion witness so the same observation cannot be replayed as a new
notification, without cancelling the underlying question, tool or job.
Subsequent genuinely new attention can still appear. Session deletion removes
all of that session's notifications through the authoritative projection and
existing retention boundary; deleting a notification never deletes a session,
artifact or accounting record.

Deletion validates the complete requested ID set against the actual profile
before its atomic event. Stale/foreign/deleted IDs fail explicitly, without a
partial removal or optimistic success. UI failures remain visible. Notification
replay, sound and OS banner delivery remain governed by their original
settings and source checks, not by opening Inbox.

## Explicit skill-load evidence

Discovery, source inspection and mentioning a skill are not loads.
The existing `use_skill` find/load contract remains the model entrypoint.
Loading requires complete actual-user source admission and current ownership,
policy, expiry and revocation checks; the follow-up grants no new privilege.

A successful complete load retains a versioned `skill.loaded` event with the
actual source name, complete body digest/byte count, observed loading time,
actor and exact session/turn, plus the original native call ID when present.
The source-load event and consumed-source provenance commit together.
User-selected draft insertion is still revision checked and atomic. Failed,
cancelled, stale or revoked requests cannot publish a successful load icon.
Diagnostic reads remain diagnostic.

SDK activity and both clients display a named book-icon row from this actual
evidence. The native load operation is not shown twice, and an external MCP
tool's name alone cannot become Moguri source-load provenance. Original
pre99 skill-use/activity history remains honest. Rewind never replays loads
or revives a source grant.

## Desktop layout and access

Keep the existing dark/light tokens, system typography and restrained icon
language. Inbox is ordinary keyboard-accessible resource navigation, not a
new popup. Session links, read acknowledgement and deletion have distinct
names and actions; removal leaves focus on a surviving action or Inbox.

The empty new-chat mascot, heading and guidance are horizontally and
vertically centered in the available chat area. The no-selected-chat welcome
uses the same alignment. Existing composer, sidebar, scrolling and narrow
layouts remain usable; centering does not move a populated conversation.

## Required evidence

Generated tests cover actual skill loading versus discovery/inspection,
complete retained bytes, failed/revoked/cancelled loading, exact native-call
deduplication and restart. Inbox tests cover profile isolation, atomic
concurrent deletion, session deletion, unchanged questions/approvals/budgets,
original-session navigation and no inference on read/delete/open.

Hidden desktop tests exercise Dashboard/Inbox order, keyboard navigation,
answering through the owning session, independent deletion, live session
removal, actual skill icons and measured centering at wide/narrow sizes.
Packed external SDK/CLI/TUI checks preserve browser-safe root/React exports.
Changed native protocol bytes need their own matching-image qualification,
not the preceding protocol98 receipts.

## Prerequisites

Before feature edits, the generated macOS arm64 foundation spike passed
provider/streaming in 1,094.87 ms (cancellation 31.55 ms), SQLite in 67.61 ms
(append p95 0.061 ms; rebuild 0.521 ms), PTY cancellation in 151.96 ms with
zero known survivors, OpenTUI in 16.87 ms/update, hidden Electron in
177.17 ms startup/441.36 MiB/8.00 ms scroll, and generated search/Git in
0.920/5.741 ms. The separate session spike retained 500 events and 250
independent artifacts in 112.27 ms and ran real hidden Ghostty WASM in 26 ms.
The foundation script's static live/Rust/Linux/release/native-unavailable
markers remain failed/unqualified; its exit status is not blanket acceptance.

## Final qualification: 2026-11-10 UTC

The implementation/package build is
`13fd073c91d6be14a06e147a51af2e7957eb5262`, protocol99,
`0.32.0-alpha.1`. The clean final test cut is
`c39995a45841692a94618dd6b183332440027393`. Its application, package, script
and dependency-manifest bytes are identical to the implementation cut; the
intervening commits correct four stale test expectations for the new Inbox,
load event and additive schema markers. No runtime behavior or deadline was
changed during qualification. The complete Node matrix uses Node 26.12.0;
the physical qualification driver uses host Node 26.13.0, with packaged/guest
Node 26.12.0.

| Verification | Result |
| --- | --- |
| Typecheck/build | Passed. No new dependency or install script. |
| Complete unfiltered `npm test` | 10,836 tests: 10,804 passed, zero failed/cancelled, 32 explicit skips; 8,252,576.869375 ms. |
| Actual Local/SSH source matrix | All 6,720 required cells passed at clean final `c39995a`, protocol99. The broader 3,360 native milestone cells remain explicitly unqualified. |
| Complete hidden desktop | 400 passed, six explicit skips, 14.6 minutes. |
| Exact packaged Inbox/load/layout tests | All three passed in 5.2 seconds, using the final packaged executable and generated state. |
| Fresh packed external SDK | Passed the complete browser-safe root/React, explicit Node/MCP, types, actual CLI/TUI/worker, complete-source retention, Inbox deletion and restart probes; install audit found zero vulnerabilities. |
| Root audit | `npm audit --audit-level=moderate`: zero vulnerabilities after complete acceptance. |
| Packaged setup/service recovery | Exact bundled worker/Apple-init and no-script installer passed. Actual packaged Node/service and hidden Electron preserve generated encrypted history and the exact authenticated PTY through explicit restart, with no input replay. |
| Fresh physical protocol99 qualification | All ten independent gates passed in 129,180.015208 ms, including verified owned-guest teardown. |

Focused shared service/CLI/TUI/policy/legacy/My work coverage passed 95 cases,
and the additional exact repeated-observation/new-head deletion case passed.
All 19 directly affected desktop interaction/navigation cases also passed.
The actual TUI renderer receives a named book indicator after successful load,
not discovery; the live desktop keeps one stable native operation row rather
than retaining both a pending tool row and a duplicate load row.

The new layout checks measure the actual mascot/heading group at 1280x900 and
860x680. Horizontal center error must be at most 12 CSS pixels and vertical
error at most 16, and the complete group must remain inside its available
chat area. The no-selected-session welcome is separately centered. Short
windows use compact spacing/type instead of centering oversized clipped
content or relaxing the geometry check.

The new physical receipt includes six retry/checkpoint cases (five physical,
one generated primitive), three physical per-turn rewind scopes and one
hidden native desktop restoration case. This requalifies the changed protocol99
worker/bridge bytes; it does not reuse the preceding protocol98 receipts or qualify
reviewed-script Sandbox execution, live model quality, all native milestone
cells, notarization or Linux release acceptance.

### Exact retained identities

Development artifacts are under
`release/qualification-builds/inbox-skills-13fd073/`. They remain ad-hoc
signed and were not opened for a user handoff. The packaged tests select
`builds.noindex/0.32.0-alpha.1/Moguri-darwin-arm64/Moguri.app/Contents/MacOS/Moguri`,
never the `.app` directory. Only generated profiles/credentials/projects,
loopback models/SSH, hidden Electron and exact owned guests were used; no
personal Moguri state, authorization, microphone or power configuration was
accessed.

| Artifact | Exact identity |
| --- | --- |
| Native image | `docker.io/library/moguri-worker@sha256:6b2d1abb28d0c4d626072e529aa62088342ebe22e56bcc94646f5f72d59279af` |
| Worker | SHA-256 `1e044ddae6809f7fb6e12c88693ee45965fb7bce87a70b6bcbe8bbc6c2c524c8` |
| Bridge | SHA-256 `67b58d0cfb28b985c5a92042620e10f73156ebf990b721770f4c43bc755b63cd` |
| MCP worker | SHA-256 `c4e9215c71610b122ce331a9bbd6b4c7f8c3a7a512e6988d9e185e5a8198cd10` |
| OCI archive | 530,350,080 bytes; SHA-512 `d2b3cad0264e4d0168a7b89c98f0fa4e8dad5764f55a333db12947ef3dac7ee688d7fe88f2c33f4e154977018ed019042eeaa557630d4f025f7da79af88cd5f6` |
| No-script installer | 16,589,223 bytes; SHA-512 `786d17e083d51de120a1d710254ac2120ef6b973699136b93f42af962bfc718ab434e8c9af0c0756f76a85ac92ec855bd4f832e70d7709f2221c767a4b60bf3a` |
| ZIP | 883,014,088 bytes; SHA-512 `30056ca3b794b9b9057d73a0b111b2fff704bb0bf27d82fc4ab241a684550ecf72495e21b8ba7edd6d85fe52a3fc2f86f448401fdfc5928a9a21d5bae0a5a73b` |
| App tree | SHA-512 `140c3beae7bc972e7b36b22e6fe1d951fa64aa63c2beab978903e68661d10486d6fcef5343be392cea5184bcff8fd53e068ccd09fdf8b9b07f9e05a4a2d6c8e1` |
| DMG | 897,768,915 bytes; SHA-512 `1a6398c5e87002f9cb3f693662c9a84b0af7ad4363a43d2bbef35fb30530f8382a1b7a47b9605bc063e42e220b5796aa763780f9cfa2ec8b4b849fdaaba34b28` |
| Physical report | `.native/qualification/current-sendbox-BZEFn3/qualification.json`; SHA-256 `14372144a4aa093d052a45cb9b687bd32d870291c037d94375c7c65b61529372` |
| Complete source matrix | `.test-output/milestone-combinations/source-report.json`; SHA-256 `8e388ab952ccd1f2f92aa10a94d8530a45970fc69ba7deeb19deb800fbe45590` |

The physical report records clean `c39995a` and exact harness hashes. The
matching distribution is `.native/sandbox-distribution/build-z0jQmV`, with its
own `image.json`, the unchanged pinned SendBox 0.2.4 vendor archive and
`/opt/moguri/sendbox/0.2.4`. Its API/prerequisite checks used no personal
credentials or Local fallback.
The complete Node, desktop, packed-SDK and packaged-feature logs respectively
have SHA-256:

```text
8912bd7f80ecfbe22c7646f43bc7d670b31e08ab53ab112074cac4eef3ba576b
22d0a66651a6dcc8ef9a4e24bcd90d003c92f425c092c176f080748d1167d412
6f8b53a145a65ada607c28438b1158c4935395a039ca8186afd3dc87aca44c11
6a359b73e2cc335901cc53573abcc915bc70e2f63a1320d27d20aa9077a88d7c
```

### Failures remain failures

The first protocol99 full desktop run retained 398 passes, two stale
three-resource navigation failures and six skips. The next retained 399
passes, one native allowed-redirect teardown timeout and six skips, plus a
worker-teardown error. Its trace shows every redirect assertion and the
Draft saved check passed before Close context stalled. Both redirect cases
then passed unchanged in 4.9 seconds, and a new complete desktop run passed
400 cases. No deadline was changed or host-only cause inferred.

The first complete Node attempt was stopped on an old `skill.used` assertion,
an upgrade expectation missing the two additive protocol99 markers, and an actual
`ENOENT` for Playwright's matching Chromium 1248. The two expectations were
corrected; only after that explicit missing-dependency failure,
`npm exec -- playwright install chromium` restored the matching test browser.
All 11 affected prefix cases then passed. A remaining-files diagnostic
passed 1,932 cases with 28 skips while explicitly omitting the heavy source
matrix; it was not full acceptance. The final unfiltered run above includes
that complete matrix and supersedes, rather than relabels, those diagnostics.

Existing Vite chunk-size, OpenTUI FFI, dependency-deprecation, optional modern
`.icon` and generated native Git-template warnings remain disclosed. The
workload build also reported a newer npm major; the pinned toolchain was not
silently upgraded. CI remains main-push-only. Main
[run 42610288497](https://github.com/mbianchidev/moguri/actions/runs/42610288497)
remains account payment/spending-eligibility blocked before either OS job
starts, with runner-capacity/Ubuntu-label notices. Absent branch checks are
not green CI. The broader skills-safety issue remains open; this follow-up
does not qualify Sandbox scripts, Remote skills/scripts or semantic scanning.
