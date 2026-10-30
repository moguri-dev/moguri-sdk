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

Qualified execution is **non-interactive Local only**: POSIX shell/Bash,
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
