# Experimental kupo Single

This is the retained explicit Single policy, not the current factory default.
[Automatic Kupo](automatic-kupo.md) is always listed and uses configured models
by default. Existing saved Single policies keep this explicit contract;
restoring Kupo defaults now switches to Automatic without starting inference.

This checkpoint adds opt-in **Single** routing to the existing owned agent loop.
It is not qualification of the complete D11 router, calibrated model quality,
cascade, independent critique/revision, candidate application, finite-budget
wind-down or System One. Fixed models remain independently selectable.

## Reuse and prerequisite

Reuse maintained `@earendil-works/pi-ai`, TypeBox and React, all MIT-licensed,
the existing SDK, SQLite event authority, worker, SSH transport, permissions,
retention and all-role budget ledger. No dependency, second loop, hidden
orchestration database or client-owned provider payload is added.

The [routing primitive](routing-primitives.md) first qualified actual bounded
classifier/solver transport, eligibility, unknown telemetry, failed completion
receipts, cancellation and context separation with generated endpoints. Those
mechanical results do not establish confidence calibration or provider quality.
The integration adds durable ownership and actual client/worker coverage rather
than treating that prototype as a complete implementation.

## Explicit scoped policy

Each profile starts with:

```json
{
  "enabled": false,
  "workflow": "single",
  "classifierModelId": null,
  "approvedModelIds": [],
  "allowHosted": false,
  "minimumConfidence": 0.9
}
```

Configure an actual discovered classifier and up to eight exact solver IDs.
Hosted classifiers and solvers require the separate explicit task-data flag.
It permits approved task history at that destination, not another provider,
endpoint, execution env or permission. Only known loopback configured endpoints
can omit this flag. The catalogue derives `endpointBoundary` from the exact
validated URL, not its provider label: network or unknown destinations still
need consent even if called "local." Discovery and configured-model inference
reject redirects. Loopback identifies the HTTP boundary on the execution host,
not an attestation that a user-configured server/proxy never forwards data.
On Remote, calls run on the pinned SSH machine; Copilot additionally requires
the existing scoped credential grant. SSH is not SendBox process isolation.

Eligibility requires the scoped catalogue, matching env, positive known output
bound, actual context capacity and hosted-data policy. Discovery does not make
paid calls or invent missing capabilities. The classifier receives only the
eligible candidate metadata and canonical task history, not endpoint credentials.
No synthetic model may route recursively. Saving policy does not select `kupo`,
start work, authenticate or change autonomy.

Only Local and the qualified core Remote transport can offer this alpha.
Sandbox remains unavailable. Images, per-model context/thinking overrides and
any finite session, owning-session, profile or global cap block selection or
further admission. Unlimited never lifts inherited policy. Finite routing stays
unavailable until reserved wind-down and an authorized accepted-work checkpoint
path are qualified; no unqualified finishing call or Git commit is attempted.

## One owned execution

1. Snapshot exact routing policy, permission/env revisions, canonical task digest,
   classifier and filtered candidate IDs. Recheck after asynchronous preparation
   and immediately before dispatch.
2. Atomically retain the actual router reservation, `routing.started`, step
   prompt digest and role-bearing `model.started` before sending credentials or
   authorizing inference. The same owned worker uses a tool-less classifier
   context and an actual output bound of at most 128 tokens.
3. Validate one complete, tool-less, bounded JSON Single plan against the exact
   candidate snapshot and configured confidence threshold. A model's confidence
   is uncalibrated advice, never a user answer, permission or policy override.
   Missing/invalid metering cannot authorize solver continuation.
4. Atomically retain normalized classifier completion, real/unknown accounting
   and either `routing.planned` or the rejected terminal diagnostic. A failed
   commit acknowledges no continuation and keeps its unknown reservation.
   Actual output-limit violations retain charges but halt the route.
5. Only after durable acknowledgement does that same worker enter the selected
   solver's normal loop. It rechecks policy, env, task and actual context fit,
   reserves that real model/role and retains its start before dispatch. There is
   no fallback, another classifier attempt or silently substituted provider.

The solver stays fixed for the turn. Agent turns have no step cap
([D72](decisions.md#d72-agent-turns-have-no-step-cap)); existing request deadlines and zero automatic provider
retries apply to both roles. Normal exact-argument approvals and current policy
still govern tools. Guided advice comes from the actual solver step, not the
router or synthetic label. Policy changes invalidate pending routed approvals.

Classifier JSON is retained as audit data, never appended to solver history,
shown as an assistant answer or converted into instructions. Canonical context
reconstruction also excludes router completions after restart or context copy.
Queued steers invalidate a classification of the old task and remain available
for explicit review; no hidden reclassification is started.

## Persistence, accounting and cancellation

Protocol/database migration **16** adds typed policy snapshots and
`routing.started`, `routing.planned`, `routing.finished`. A routing turn retains
owning session/turn/project/env, policy and task digests, revision provenance,
classifier/candidate IDs, actual plan, lifecycle and diagnostic. `model.started`
and each reservation/completion carry the actual model and role while the
session selection remains `kupo`.

Every router and solver call belongs to the existing owning-session ledger,
including model-created children. Estimated, provider-reported and billed costs
remain distinct. Rejected advice is still charged. Missing reports, interrupted
calls and failed receipts remain unknown and held, not zero or refunded.

Stop propagates through the same owned work. Requested/acknowledged cancellation
does not prove provider completion or process cleanup. A stopped route cannot
become successful. Recovery marks planning/ready/running routes partial, retains
unknown reservations and holds saved queues without replaying inference, tools,
approved effects or Git writes. Schema-15 recovery preserves both profiles'
event ciphertexts, receipts, blob grants, retention keys and independent
artifacts; a failed migration reopens unchanged schema-15 state.

## Shared clients and generated coverage

`sdk.routing.policy()`, `configure(policy, expectedSettingsRevision)` and
`history(sessionId)` use the existing immutable profile connection and settings
authority. `/kupo status`, `/kupo set POLICY_JSON`, `/kupo history` and
`/model EXACT_ID` share one dispatcher across CLI/TUI/desktop. Explicit model
selection clears old model-specific options without starting inference.

Desktop settings expose the opt-in, classifier, approved pool, hosted-data
flag, confidence threshold, fixed classifier contract and availability
diagnostics. The composer labels Moguri's synthetic model distinctly from
Copilot, disables unsupported controls and links back to policy. Insights and
the TUI expose actual plans/roles/models from the same SDK projection.

Generated coverage uses real owned Local and pinned SSH workers with separate
loopback classifier/solver endpoints. It covers exact approvals and remote-only
file writes; scoped opt-in and stale revisions; invalid/low-confidence/tool
plans; unknown/over-limit telemetry; failed atomic commitment; concurrent cap,
pool, permission and task changes; images/options; cancellation and recovery.
Native TUI and hidden Electron tests exercise actual client controls. The packed
external consumer exercises the delivered SDK's real staged worker, actual
role accounting, no classifier-context promotion and inherited-cap rejection.
No personal credential, paid provider, VM, calibrated benchmark or production
SendBox qualification is implied.

The `0.10.0-alpha.1` checkpoint passes 291 full local checks (188.15 s), 21 hidden
packaged-app workflows (46.4 s), exact-archive external SDK/CLI exchanges and
source/consumer audits with zero reported vulnerabilities. Ad-hoc signature,
native assets and actual DMG integrity are verified. The historical failed
schema assertions and unchanged older artifacts are recorded in
[setup](../setup.md#current-010-checkpoint); none of these mechanical checks
establishes model-confidence calibration or compound-workflow readiness.
