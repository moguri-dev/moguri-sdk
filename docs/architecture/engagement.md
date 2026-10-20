# MCP OAuth, project-free chats and reviewed metachat

This user-requested slice extends the same SDK, service and append-only event
authority. It does not activate unattended self-modification, grant model
authority over settings or replace the existing execution boundaries.

## Guided advice and actual answers

Protocol/migration 15 adds optional offered-choice recommendations to the
existing `ask_user` call. The current solver can supply one zero-based
`recommendation.choiceIndex` and a bounded `reason` in Guided mode. The service
validates actual option membership and stamps actor/model/provider/step/call
from the already committed solver result, never from model-supplied identity.
An open-ended question cannot manufacture a recommended user-only fact.

There is no auxiliary model call or second agent loop. The same solver call
already reserves/reconciles its budget. Advice never answers the question:
the user may choose another option, queue text without answering, or stop.
Guided approval text must belong to that exact model step and tool call;
historical narration is not a current recommendation.

SDK/CLI preserve typed advice. Desktop and native TUI label it untrusted model
advice, without preselecting or automatically accepting the recommended
answer. The normal actual-user endpoint remains authoritative and records the
real user actor. Model advice cannot lift hard denial or Git policy.
Retained answer artifacts separately label recommendation and actual answer;
their model/user source digests remain distinct.

Migration 15 adds a transactional schema marker without rewriting ciphertext,
scoped receipts, wrapped keys or existing profile identities. Old questions
project null advice; restart cancels interrupted waits without an invented
answer or replay. Generated tests cover two-profile legacy recovery, injected
migration failure, cancellation, source attribution, actual native TUI choices
and no additional paid request. This is a Guided slice, not Jev, Autopilot Max
or automated question/approval/steering delegation.

## Reuse and Phase 0

Use the installed official MCP SDK (MIT) for protected-resource/issuer
discovery, client registration, OAuth authorization code/PKCE and refresh.
Node HTTP/crypto owns a temporary loopback callback; the explicit keychain
backend stores issuer/resource-bound client/token bundles. No extra auth
library, provider credentials, personal browser automation or token files.
`node scripts/engagement-spikes.mjs` qualifies the real helper using generated
loopback endpoints before feature work.
The real helper passed protected-resource/issuer discovery, dynamic client
registration, S256 PKCE, issuer/resource-bound exchange and refresh against
generated endpoints in approximately 16.5 ms. No real account was authorized.

Project-free sessions use a real null project association, never a synthetic
folder/project. They may use the selected provider and explicitly configured
global MCPs, but cannot list/read/write workspace files, run a host shell,
index a repository or silently use a previous project's root. Bound-session
scope is immutable. Global chats do not share a fake project writer lease.

## OAuth boundary

OAuth starts only through a user-only SDK/client action. Authorization URLs
are presented for an explicit browser action; a model cannot begin login,
answer consent or obtain credentials. Code verifiers/state stay in bounded
memory, callbacks are exact/single-use and no authorization code/token is
written to command receipts, conversation or event payloads.

Retain the SDK's issuer metadata and RFC 8707 resource binding. Refresh uses
only an existing grant; failure requires login rather than anonymous or
bearer fallback. Never retry a tool invocation to conceal an auth failure.
Cancel/expiry/shutdown/project removal settle the owned callback and prevent
late secret writes. Tests inject generated vaults and OAuth servers.
Newly exchanged grants carry their authorization ID and are unusable without
the matching durable connected event. Cancellation during a native secret write
awaits and scrubs it; an uncertain cleanup is explicitly failed/blocked, not
reported as cancelled successfully. Global accounts survive origin-session or
project removal; historical project-owned resource keys are explicitly removed.

Servers without dynamic registration can use a user-supplied public or
confidential client, including an exact registered
`http://127.0.0.1:PORT/oauth/callback` URI. An occupied fixed port fails without
falling back to a new registration. No confidential secret enters settings,
shell arguments, events or the model.

## Suggestions and metachat

`/suggestions` previews bounded previous-session user prompts and their scope.
Project chats default to that project; project-free chats default only to
other project-free chats. Cross-project analysis requires an explicit scope
preview and consent, not an automatic global read. Generation uses the shared
worker/provider/accounting/cancellation path, never hidden model calls.
Preview includes at most 12 prior agent/side sessions and the last eight user
prompts from each, at most 4,000 Unicode characters per prompt and 32 KiB of
actual UTF-8 content in total. Control/model-subagent conversations are excluded.
The analysis chat retains only those exact approved excerpts as evidence, not
unreviewed tails of a truncated source. Cross-project hints require the reviewed
analysis path before becoming proposals.

`/meta` and `/metachat` create a settings-focused conversation for the chosen
scope. Its tools read non-secret configuration or create exact reviewed
proposals. They cannot edit files, execute commands, authenticate MCPs or
approve/apply their own proposals. Normal optional evolution stays off.

Proposals support global/project settings, global user guidance, local repo
instructions and disabled skills. Every proposal retains source evidence,
target scope, exact content digest and base revision/digest. A user-only apply
checks the current base, shows risk, and records the actual user actor. Repo
instruction writes do not commit or push. Skills are installed disabled.
Concurrent decisions recheck both pending status and the live target revision.
An instruction file written before a storage/removal failure is explicitly
reported partial, with inspection/fresh-proposal guidance, not called success.
Credentials and connection secrets are neither readable nor editable by the
model. Advisory text and detected prompt patterns never become user approval.

## Attention and notifications

Atomically derive durable question/bell/done attention from actual approvals/failures/
completion, with conservative nonblocking question-text detection. Heuristic
questions are not structured user answers or permission decisions. Read
acknowledgement is distinct from responding/resolving the work.
Already-admitted runnable follow-up prompts suppress a premature done/waiting
indicator. Notification delivery follows the sequenced snapshot watermark and
does not replay old events on startup or when enabling banners.

Both clients expose per-session indicators and an attention list. Desktop can
show OS banners when the user enables them; banner content is generic by
default and foreground activity suppresses unnecessary OS banners. Native
notification tests never show an actual personal OS banner. TUI shares the
service state; OS banners require the desktop to be running.

Protocol/database migration 6 must preserve schema-1 through schema-5 state,
encrypted grants, event identities and restart recovery. Profile-owned guidance,
proposals and skills survive individual session deletion. Project removal still
never deletes repository files or external PRs. CI remains main-push-only.

## Local qualification

The 0.6 source checkpoint passes 115 generated unit/integration/native-TUI
checks and eight hidden Electron workflows, including project-free chat,
explicit generated OAuth, exact configuration review and compact attention.
The clean locked install and external packed consumer audit report zero
vulnerabilities. The consumer independently imports/types all four entrypoints,
exercises project-free/metachat/configuration APIs and real macOS PTY I/O.
The final OAuth primitive rerun passed in 17.27 ms.

One external-consumer run concurrent with the other suites reported `EPERM`
during existing native PTY cleanup and correctly remained unconfirmed. Its
complete isolated rerun passed; no process-containment improvement is claimed
from that rerun. Known upstream FFI/deprecation and lazy Ghostty chunk notices
remain visible. No live account, browser authorization, OS banner, microphone
or model weights were used.

The actual 0.6 app passes all eight hidden Electron workflows. Independent
bundle checks verify the ad-hoc signature, declared mascot icon, bundled
Node 26.12, native PTY input/close, Ghostty assets and speech readiness without
weights. The compiled service also completes generated OAuth and an exactly
approved HTTP tool call from a project-free session; echoed credentials remain
redacted. No source-runtime substitution is used for that backend check.

`release/` contains the app, the checksum-verified 348,589,491-byte DMG,
270,153,686-byte ZIP and independently packed SDK tarball for `0.6.0-alpha.1`.
These are ad-hoc development artifacts, not notarized releases.
