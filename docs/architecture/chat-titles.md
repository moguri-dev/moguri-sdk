# First-topic chat names

Protocol/schema **90** adds `chat_titles_schema='1'` and
`live_delivery_schema='1'` in one transaction after the existing schema-89
read-index migration. The migration changes metadata only: existing encrypted
events, retention keys, blob grants, receipts, queues and original budget holds
are not rewritten. Missing, invalid or premature markers fail explicitly.
Actual naming or live-delivery history cannot be relabeled as older state.

This uses the existing MIT TypeBox, SDK, React/Electron and maintained
`@earendil-works/pi-ai` worker, with Node's crypto/SQLite APIs. No dependency,
provider, model weights or new execution transport is introduced.

## Original source and user precedence

Only a newly created ordinary chat whose actual creation event records
`titleSource: factory` is eligible. An explicit title, an unmarked legacy chat,
private role or queued slash command is not inferred to be eligible from its
text. The first ordinary prompt records one `chat.title_recorded` intent with
its exact message/source digest, original factory title/revision and Env.
The default feature is on; `chatTitles.enabled: false` disables future naming.

After the first solver reply, the existing worker may perform one separately
charged, tool-less naming call. Its input is the first prompt's text, not
attachments, ordinary solver history or a later interjection. This is an
explicit naming input contract, not an image/document fallback. The complete
escaped envelope must fit 128 KiB and the actual model window; it is never
silently truncated. Output is bounded to 128 tokens and 15 seconds of inference.
Only the actual first-topic owner receives the explicit worker-start naming
capability. Existing private/root-less compaction, candidate and standalone
worker probes do not gain another RPC or model role from an omitted phase.

The model returns only `{"title":"short topic summary"}`, normally 3-6 words
in the user's language and at most 80 characters. Invalid, incomplete, unsafe
Unicode or non-JSON output is retained with an explicit rejected/partial
outcome, not applied or retried. Naming results never enter ordinary solver
context, model-owned acceptance or permission decisions.
Fully metered malformed/tool-calling output is rejected with its known charge;
it cannot execute a tool or relabel completed solver work as unknown usage.
Actually missing accounting and output-bound violations keep their separate
partial/held outcomes.

`session.title_generated` binds the original factory-title revision, source
and settled original title-role charge. An actual user rename, cancellation or
disabled naming policy wins over an in-flight result. Inline rename may submit
over one model-generated factory-title change while editing, but never over a
different user's title. Other metadata revisions still use the existing
single known-conflict retry. The service owns names; clients do not fabricate
a title by truncating the first prompt.

A later request that clearly changes topic can rename a model-named chat through
the same bounded call, at most three times. See
[session lifecycle](session-lifecycle.md#title-refresh).

## Model and accounting

Settings / Providers exposes automatic topic naming and an optional exact
model ID. Automatic selection prefers an already configured, available
loopback model in the original Env, then a fresh configured token-price
estimate, then the actual selected solver model. Price estimates are not model
quality or billed cost. An explicit unavailable model, failed preparation,
changed account/root/policy or unsuitable input has no provider/Env fallback.
Remote/native preparation uses the original pinned worker/guest, not a new
Local process or controller endpoint.

The call has the real `title` model role. Its profile/session-owned reservation,
exact request grant, `chat.title_recorded` admission and `model.started` are
committed before dispatch. `model.completed`, derived actual accounting,
terminal naming state and any title application commit together. Known usage
settles once; lost or unknown completion retains its original capacity through
stop, source deletion and restart. A deleted result or missing receipt cannot
authorize a second naming call. The existing all-role 32-call turn bound applies.
The complete future wind-down aggregate is bounded by the actual model-role
schema, including `title`, not a stale thirteen-role constant. Adding this role
does not shrink, truncate or relabel an already retained budget reservation.

The SDK exposes `sessions.titles(sessionId)` and optional `Snapshot.chatTitles`;
the service supplies the actual records in every current snapshot. Title calls
remain visible in shared usage/role filters without adding blank chat messages.
TUI and desktop share the same lifecycle and metadata. Saving naming settings
does not authenticate, select a solver, start inference or grant tools.

## Generated qualification

The source worker regressions cover one first-topic call, explicit user titles,
known and unknown accounting, rejected output, cancellation and exclusion from
the next solver request. Hidden desktop tests cover default live Send, the
acknowledged live row and an inline user edit winning over an admitted model
name. These generated checks do not qualify a personal provider or model.
The installed/native-byte qualification is separate from these source checks.
