# Work-item content and repository-script review

## Contract and authority

The user requested both safeguards inside Moguri. Hidden Markdown/HTML comment
blocks (`<!-- ... -->`, the requested `<--- ... -->` spelling and unterminated
blocks) are removed before built-in work-item viewing/import/model use. The
remaining visible text is still untrusted. Script source is different: agents
must receive and assess its entire exact contents, including code comments,
before any execution approval. Suspicious or unverified payloads/API calls must
be reported as unsafe. Unsafe advice blocks execution approval; only an
explicit actual-user force can override that advisory.

A safe assessment is model advice, not a safety guarantee or permission.
Normal Manual/Guided/explicit Autopilot policy remains in force. User force
cannot override source/root/revision binding, read-only mode, hard denials,
folder restrictions, environment policy or unsupported transport. No model
tool, script/plugin, inferred answer, confidence threshold or heuristic badge
can create the user-force event.

Reuse Node 26 filesystem/crypto/module and owned-process primitives, the
existing typed SDK, worker/ledger, encrypted source grants, revision checks,
React/OpenTUI and source-result acknowledgements. `shell-quote` 1.12.0 (MIT)
tokenizes literal shell syntax without evaluating it or expanding ambient
environment values. It routes direct file-script and download/execute
shortcuts into full review; it is not a malware classifier or OS confinement.
Opaque already-approved processes, package-manager internals, external MCP
services and transitive dependencies do not become inspected code by inference.
Literal inline program snippets keep their existing command approval, rather
than being silently reclassified as downloaded repository files. A command
parser is not proof against arbitrary obfuscation or code that implements its
own downloader.

Protocol/schema **83** adds `script.review_recorded`, scoped review/read/force
API and private execution authority, plus explicit filtered-view metadata for
retained work-item attachments. Its two distinct metadata markers are
`work_item_comments_schema=1` and `repository_script_review_schema=1`.
They append atomically with the version change. Genuine 82 events, receipts,
encrypted grants, profiles, drafts, controls, unknown accounting and historical
qualification remain unchanged. Actual retained script-review/force history
cannot be relabeled as 82;
new worker/native bytes require fresh qualification, not an edited old receipt.

## Work items

One browser-safe linear-time filter serves GitHub issues/PRs/reviews/comments,
read-only Kanban imports, Linear descriptions/comments and local tickets.
Literal prefix/routing identities are not sanitized into another repository,
account, user or work item. Outbound exact user-reviewed publication templates
are not silently rewritten. Filtering is idempotent, including comment openers
formed across removed blocks, and preserves visible Unicode/text order.

Legacy local-card projections filter their title/body without rewriting the
original append-only events. GitHub synchronization retains original source
ownership and checks genuine retained original text when an old source digest
predates filtering; a visible local edit remains an edit. Typed legacy GitHub
attachments keep their original descriptor/grant and report separate
comment-filtered view digests/bytes. Model context labels that derived view
before sizing, rather than claiming it is the unchanged original snapshot.
Arbitrary external MCP text is not heuristically relabeled as a work item.

## Script lifecycle

The owning agent discovers `review_script` and `run_script` through the existing
typed catalogue. `review_script inspect` reads the whole unprotected Local
workspace/captured-Home file or explicit public HTTPS raw URL, up to 64 KiB,
with its selected interpreter and arguments. URL inspection needs normal
website approval, public-address/redirect enforcement and lossless UTF-8;
HTML/login responses, credentials and query-token URLs are rejected. Only the
reviewed complete snapshot is later executed, never a second download.
It records exact bytes, canonical root/inode identity, current
hard-policy binding, profile/session and actual inspection-model provenance.
No execution, source truncation or hidden classifier call occurs.

The subsequent owning model assesses that complete source with an explicit
safe/unsafe verdict, concrete summary and blocking findings. The service
requires the original complete tool-result receipt to precede the actual
assessment model start. Context replacement invalidates that read. Advice is
immutable and distinct from user consent. All model legs use normal admission,
accounting, limits and cancellation; unknown usage is not zero.

`run_script` binds one original attempt to that exact source and current owner.
Unsafe advice returns a report without creating an execution-approval prompt.
The user-only force API binds the current review/session revisions and source
digest; missing receipts or an existing attempt never authorize replay.
After a genuine force, normal command approval still applies. Source/policy
changes require another explicit inspection, not optimistic reuse.
Individual execution approvals apply once to the unique original attempt;
they cannot create blanket/family grants or a remembered future replay.

Desktop exposes **Repository script reviews** below the original conversation.
**Read full source and review** shows the exact bytes and untrusted findings.
An unsafe review does not open an approval prompt. After the owning turn ends,
a user may check the explicit force acknowledgement and choose **Force unsafe
script under normal policy**. Manual/Guided still ask for normal execution
permission. CLI and TUI share `/script-review list`, `read ID`, and
`force ID REVIEW_REV SHA SESSION_REV confirm-unsafe`; CLI also exposes
`moguri script-review ... --session ID`. An admitted force returns an original
job to inspect, not a claim that execution succeeded.
Queued TUI/CLI force commands retain their exact user-input ownership and
atomically commit their job/turn intent with the original command receipt.
They cannot adopt another queue entry, consume held prompts or replay a
failed/missing receipt. Filtered GitHub review content uses the same view at
freshness recheck while preserving the original upstream digest, so hidden
source drift still invalidates the review.

Supported execution is **non-interactive Local only**: POSIX shell/Bash,
explicit Node ESM/CommonJS, or installed Python 3. Source bytes use a private
pipe, never process argv, a temporary script or a second download. Node's
trusted loader supplies only the exact main snapshot; Python compiles the
snapshot with its original filename; shells source the private descriptor.
Relative module context/original source labels are retained where supported;
shell `BASH_SOURCE` refers to the private descriptor. HOME is the bound root,
not an inherited project/account. No credentials or arbitrary ambient
environment values are forwarded.

An owned sentinel keeps untrusted code off its control event loop and stops
the known process group if its actual parent/control pipe disappears. Stop,
deadline, output overflow, background survivors and failed acknowledgement
remain partial/failed outcomes, never complete success or permission to retry.
Local/ordinary SSH is not whole-descendant isolation. Remote/Sandbox script
execution remains explicitly unsupported, with no control-plane fallback.
Literal inline snippets, package-manager tasks, already approved opaque
processes and external MCP internals retain their existing policy; the command
router is not an OS-level detector of arbitrary code or transitive effects.
User consoles remain private and are not inspected or controlled by this flow.

Before this feature integration, the repeated generated macOS arm64 Phase 0
run passed six foundation groups: OAuth/streaming **1,090.80 ms**, cancellation
**31.83 ms**; 1,000-event WAL append p95 **0.051 ms**, rebuild **0.545 ms**;
nested PTY cancellation **151.98 ms**, no known survivors; 60 TUI frames
**17.23 ms/update**; hidden Electron **203.46 ms** cold start, **448.36 MiB**,
**8.08 ms** scroll frame; 2,000-file search **1.07 ms**, Git status **5.74 ms**.
Live entitlement, physical SendBox, Rust/Linux release and signing/notarization
were not qualified by these generated checks.

## Final generated qualification

The final desktop source is
`f89faa990941f3006513f263f6f3f2680d44a9ac`, based on merged main
`37105eb604c17cdbfad52e08e699b8b62797f726`. It retains the separate settings,
navigation, file-policy and protocol-83 commits without rewriting history.
Both new markers remain distinct and equal to `1`; genuine 82 migrations
append them atomically without rewriting original events, grants or ciphertext.

The complete Node run uses
`03edc14b89cd5784fdf75261efe88077cd570bc6`. Later commits change only a renderer
button's accessible name and its UI checks, including explicit connection
readiness before a recovery keypress. SDK/service/worker sources and the exact
payload bytes below are unchanged. Strict types and production builds pass;
the final complete desktop run includes those renderer changes.

| Surface | Observed result |
| --- | --- |
| Complete Node/worker/CLI/TUI suite | 2,046 passed, 15 existing platform/native skips, zero failures; 2,061 checks in 1,598.98 seconds |
| Complete hidden Electron suite | 302 passed, three existing skips, zero failures; 305 flows in 8.2 minutes |
| Repeated affected desktop flows | 48 passed in 46.2 seconds; three repetitions of settings, Dashboard, recovery and unsafe-script interactions |
| Independently packed SDK | Browser-safe root/React, explicit Node/MCP entrypoints, declarations and actual installed runtime/worker/CLI/shared-TUI checks pass |
| Installed acknowledged-role worker | 12 passed in 4,544.45 ms, including failed receipts, accounting and control loss |
| Canonical file policy and exact-byte Local/SSH recovery | 17 passed in 15,770.98 ms, including actual workers, original Home/project roots and real control-plane SIGKILL |
| Owned rootless loopback SSH primitive | One generated request; pinned worker-side inference origin in 123.58 ms on Node 26.12.0 |
| Dependency installation and audits | `npm ci` passed; source and independent-consumer audits reported zero vulnerabilities |

These macOS arm64 checks use controller Node 26.11.1, generated repositories,
recognizers, providers, accounts and loopback endpoints, not personal credentials,
microphones, authorization pages or paid inference. Actual script execution
checks exercise shell `sh` and Node snapshots, including cancellation of busy
code and genuine parent SIGKILL. They do not independently qualify Python,
physical SendBox, an external Linux/Rust host or release signing/notarization.

The installed consumer proves complete original-source model inspection,
unsafe advice without an execution prompt, separate actual-user force, normal
policy enforcement, the original queued TUI command receipt, filtered work-item
context, service restart and no paid/execution replay. Source, policy, root,
revision and missing-receipt rejection remain fail-closed. The complete suites
also cover failed persistence, stale upstream hidden-only content changes,
cancelled work and genuine 82 migration/reopen/rollback.

Observed final SHA-256 identities:

| Payload | SHA-256 |
| --- | --- |
| `dist/worker.mjs` | `249638b3a59d1aae3f2b7007c3872bb117e387282cb3eee392a05ba8d6e855f2` |
| `dist/remote-bridge.mjs` | `72e068c0ba90e3bbe46f4f89c9c72da7432d77e0f8f5e62a4939c0b23d1c3edf` |
| `dist/runtime.mjs` | `f8c4ead7f9eb99250b9fb7172c276083e166fc9cc1376d19c58b6f5738759a08` |

Raw logs remain in the working session's `files/`:
`content-review-complete-suites.log` (successful complete Node run and an earlier
desktop diagnostic attempt), `content-review-sdk-remote-final.log` (successful
packed/SSH checks), `content-review-desktop-final.log` (rebuild and repeated
affected flows), and `content-review-desktop-complete-final.log` (successful
complete desktop run). Earlier failed attempts and original failure traces
remain diagnostic evidence, not passing receipts. Generated Dashboard
before/after, out-of-range active activity and unsafe-script-review screenshots
are retained separately for human review.

Earlier protocol-82 observations in [settings](settings-platform.md) and
[file access](file-access.md) retain their original identities and scope.
Current results do not retroactively qualify those or any other payload.
The OWASP category matrix remains a bounded review with explicit gaps, not
blanket compliance or a semantic malware guarantee.

Main-only CI is unchanged. Main run `41019712786` failed before steps because
GitHub requires account billing/spending-limit action; it was not rerun or
worked around. Working-branch checks are not claimed green by absence.
Existing large Vite chunks, experimental OpenTUI FFI, and packed-consumer
`whatwg-encoding`/`node-domexception` deprecations remain disclosed. No
validation, headroom assertion, consent gate or hard policy was weakened.
