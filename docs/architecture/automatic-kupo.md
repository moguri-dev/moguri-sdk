# Automatic Kupo

## Scope and sources

The owner-requested protocol84 [modes/recovery/compaction follow-up](recovery-scheduling-kupo.md)
uses the actual supplied HyDRA arXiv **2605.17106v1**, not the older unrelated
sensor-fusion reference below. New automatic selections expose
Balanced/Savings/Performance, actual supported effort and maximum context,
reviewed evaluation/reference-price profiles, bounded re-review and explicitly
enabled text compaction. Finite Local roles use complete existing-ledger plans.
The original protocol61 contract and measurements below remain their historical
source, not proof of live quality, current native bytes or an installed System
One provider.

Kupo is a synthetic model in the ordinary composer, not a provider or a second
agent runtime. The user explicitly chose automatic orchestration inside the
normal loop, with only the selected response's tool requests reaching existing
Manual approvals. The separately reviewed
[compound worktree workflow](compound-workflows.md) remains available.
The automatic composer pool cannot approve alternate models for the private
owned-role executor; that existing explicit-pool boundary remains separate.

The design follows GitHub's public
[Project HydraFusion overview](https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/):
single, gated cascade, and read-only critique with one revision. The supplied
[arXiv paper 2201.06644](https://arxiv.org/abs/2201.06644) was also read. It is
the unrelated 2022 autonomous-vehicle sensor-fusion paper, not a specification
of GitHub's LLM router. Neither source supplies Moguri model-quality scores or
qualifies GitHub's reported benchmark results for Kupo.

Reuse maintained pi-ai, TypeBox, React and the existing Node worker, SDK,
permissions, encrypted event store and all-role budget ledger. These libraries
are MIT-licensed. No dependency, agent framework, hidden database, live model
benchmark, extra authentication or provider metadata request is added.

## Selection and capability inventory

New modes class models for Savings/Performance by a current reviewed profile,
else as no-fee loopback economy, else by the output price a pay-per-use
provider declares (D56), else by the exact published output API price (D55);
Balanced may use declared support without invented scores. Dynamic routes over
the Balanced pool and records the concrete mode it applied to each classified
request. Supported transport levels and complete future escaped context are
filtered before role dispatch. Every mode picks effort per request by task
complexity and caps it at xhigh: Kupo never chooses Max, which tends to degrade
results. Performance uses High or xhigh and never drops a thinking budget to fit
a small ceiling. Legacy explicit selections keep their
original bounded contract until an actual user selection.

## Workflows and preferences (D56)

Workflow settings live in `kupo.workflows`; absent means every workflow on.
The owner replaced the reviewed-score and reviewed-lineage requirements for the
defaults, so Savings and Performance work with only enabled models:

| Workflow | Eligible models | Settings |
| --- | --- | --- |
| Single | Any admitted model | Always on |
| Cascade | A draft in a strictly cheaper class (economy, standard, frontier) than its escalation, or a reviewed comparable pair | `enabled`; `classes` overrides a model's Cascade class after a reviewed profile, and `excluded` removes it |
| Critique | A critic from a different known AI lab, never another binding of the drafting model, or a reviewed lineage pair | `enabled`; unordered `labPairs` narrow the allowed lab pairs |
| Council | One drafter and `size - 1` reviewers, each from a different known AI lab | `enabled`; `labs` narrows the members; `size` 3 to 5 |

AI labs come from the model ID, API ID, display name or direct provider
(`modelLab`). Unrecognized network models are `unknown` and never count;
unidentified local models count as one `local` lab. Lab labels are name-based
and are not proof of independent training. Lab-based Critique pairs have no
same-cost-class rule; reviewed lineage pairs keep theirs.

| Preference | Workflows | Models and effort |
| --- | --- | --- |
| Savings | Single, Cascade | Economy and standard, local first; low to High by task |
| Balanced | Every enabled workflow | Any admitted model; above 32,768 estimated solver input tokens, never a frontier solver or drafter while a non-frontier model is eligible |
| Performance | Single, Critique, Council | Frontier for substantive work; High for simple tasks, xhigh otherwise (High without xhigh) |
| Dynamic | Per request | Savings, Performance or Balanced rules by complexity, only when that mode allows the chosen workflow and models; otherwise Balanced |

A model whose thinking is a token budget (some Claude models through
`anthropic-messages`) qualifies for Performance Single at High, but High's thinking budget does not
fit the bounded 8,192-token draft or 512-token review roles, so it cannot draft
or review in Performance Critique or Council.

The classifier receives the workflows each request may use (and, for
Dynamic, each mode's list), eligible Cascade and Critique pairs, Council
members with their labs and roles, `longTask`, and each capability's class,
Cascade class, lab and admitted modes. `automaticPlan` refuses a switched-off,
mode-excluded or ineligible workflow, pair or council before any role. The
`routing.modes` query reports each mode's workflows, their reasons, eligible
pairs and Council models; those ignore the size of a particular request.

Kupo always appears in the shared model catalogue, including when disconnected
or unavailable in the selected environment. Its unavailable reason must remain
visible. Selection never starts inference or changes autonomy.

The automatic policy uses configured, currently advertised concrete models by
default. An explicit approved subset and hosted-data restriction can narrow
that pool. Exact environment, privacy, context, output and model bindings are
rechecked at dispatch. There is no recursive synthetic route or silent provider,
endpoint, environment or model fallback.

With no eligible model, admission fails before inference. With exactly one,
Kupo uses Single and that model, without a paid classifier. With multiple
models, a bounded tool-less router chooses an eligible Single, Cascade,
Critique or Council plan for the task. The classifier is chosen against the
estimated size of its complete input (history plus candidate snapshot), so a
small-window model never receives a request it cannot hold (D68). Kupo's
advertised window is the largest qualified window in its pool.

Capability categories describe declared general text, reasoning controls,
tools, images and long-context support. Unknown capabilities and unknown prices
stay unknown. Categories are routing hints, not measured coding quality,
latency, training lineage or billing. Pools of three through twenty models are
covered explicitly; the implementation must not silently truncate the pool.

Mode-aware Critique accepts a name-based cross-lab pair (D56) or an exact,
current, actual-user-reviewed different-lineage pair. A lab label is not
evidence of independent training. Mode-less legacy selections still need the
reviewed lineage pair. Without an eligible pair, the router can choose
another eligible pattern before execution.

## Response orchestration and effects

Single uses the normal solver loop. Cascade first generates a response/tool
proposal with the efficient model. A bounded tool-less gate either selects
that response or requests one stronger-model response. Critique first drafts,
then runs the eligible read-only critic, and permits bounded revisions by the
original drafting model. Council first drafts, then asks each reviewer in plan
order for a tool-less pass, revise or reject on that same draft; reviewers do
not see each other's verdicts. Every reviewer passing selects the draft. More
than half rejecting stops it with no tools or other model. Otherwise the
drafter revises once with every critique as labelled untrusted data and the
whole council reviews again, within `automaticLimits.maxRevisions`; exhaustion
never accepts an unreviewed response. The selection records every reviewer's
step (`reviewStepIds`), and the projection checks each original metered pass
on that exact source, in order.

Intermediate responses and tool requests are retained as observations, not
executed, streamed as final answers or inserted into ordinary solver history.
Only a durably selected original response reaches the worker's normal tool
dispatch. Every selected tool still needs its ordinary exact-argument
permission. A model verdict is not user acceptance, test evidence, a source
application decision or Git authority.

The workflow applies independently to each solver response in the owning
turn. Original task history and actual tool results remain canonical; router
reasons never become solver instructions. Revision receives only explicitly
labelled, untrusted draft/critique data. Context is sized in full, never silently
truncated. Existing per-request deadlines and the 32-call worker bound include
all auxiliary roles.

Failure, missing usage, invalid advice, changed bindings, cancellation or lost
acknowledgement prevents another role and prevents unselected tools from
executing. Already executed, previously selected operations are not rolled
back or replayed. Their ordinary partial-effect and cleanup rules still apply.

## Persistence and clients

Protocol84 additionally retains exact model-input/auth-scope recovery, one-time
scheduled ghost input, all-role response plans and policy-authored compaction
handover in the same authority. Authentication change intent is not successful
login. Original failed request/tool/role receipts and unknown charges survive.
Only an original, complete metered recovered response resets the backoff.
Only an explicitly enabled user policy can apply a bounded automatic text
summary; original public history and scoped document/tool resources stay
available, and restored history does not replay paid work. Unqualified
Remote/native wind-down and System One transports stay unavailable.

Protocol/schema 61 adds the automatic policy, exact capability/model snapshots
and selected-response events to the existing append-only authority. Every
actual call still uses atomic reservation plus `model.started` and its original
`model.completed` receipt. A selected response references the original retained
blob, not reconstructed or model-edited content.

Restart marks interrupted routes partial and never replays classifier calls,
reviews, selected tools or paid work. Unknown accounting remains held. Existing
explicit policies and historical plans remain readable. Finite automatic
multi-role admission must not bypass complete reservation and wind-down gates.

SDK, CLI/TUI and desktop consume the same catalogue, inventory, policy,
selection and per-role observations. Disconnected desktop menus cannot hide
Kupo behind the Copilot login view. Fixed models remain selectable.

## Prerequisite observations

Before feature implementation, `npm ci --no-fund` restored the missing
dependencies and audited 454 packages with zero reported vulnerabilities.
`npm run spike` passed the generated provider, store, macOS PTY, TUI,
hidden-Electron and bounded filesystem/Git checks. Measurements included:
provider cancellation 31.52 ms; SQLite append p95 0.0514 ms; PTY cancellation
151.04 ms with zero known survivors; Electron cold start 190.50 ms and
441.72 MiB; Git status over 2,000 generated files 6.70 ms.

The same spike explicitly reported unqualified live inference, Linux/Rust,
signed/notarized release packaging, native SendBox, live router quality,
System One and personal SSH. These are not converted into passing claims.
The subsequent generated Single probe passed 8 cases in 1.24 s. The combined
compound/owned-role prerequisite passed 92 cases in 140.30 s, including real
controller loss, cancellation, retained roles and unknown accounting.

The baseline product build passed. Existing warnings were experimental FFI
and renderer chunks above 500 kB.

## Integrated protocol-61 qualification

The user-approved integration preserves main's protocol-59 workspace/skill
gateway and protocol-60 session navigation. Kupo uses its own additive
protocol-61 marker rather than reusing either schema number or replacing
their settings, events, identities or console ownership.

Final generated macOS arm64 qualification:

| Check | Result |
| --- | --- |
| Full Node/worker/CLI/TUI suite | 1,491 passed, 14 physical/platform skips, zero failed/cancelled; 1,231.88 s |
| Full hidden desktop suite | 195 passed, three physical/packaged skips; 6.3 min |
| Final desktop routing recheck | All six automatic, explicit Single and reviewed-worktree cases passed |
| Production build and both type checks | Passed |
| Independently packed SDK | Browser/React/Node/MCP imports/types, real installed automatic Single and all 12 installed worker continuation probes passed |
| Root and independent consumer audits | Zero reported vulnerabilities |

The actual loopback/SSH runs cover all three patterns, conditional escalation,
one same-model revision, exact Manual approvals, solver-sourced Guided advice,
selected-answer artifact/activity provenance, three-through-twenty model
inventories, unknown usage, cancellation and atomic receipt failure. Real
controller SIGKILL during review and selected-response approval retains unknown
capacity and original blobs without replaying paid calls or proposed tools.
Schema-60 rollback/reopen preserves ciphertext, receipts and explicit policies;
forged selections and downgrade/replay attempts fail explicitly.

The broad sweep exposed a private-role eligibility regression from the new
automatic default. That executor now explicitly rejects borrowing an automatic
composer pool, including a manually narrowed automatic subset. Both the
original rejection and expanded consent-boundary regression pass in the final
full suite. Exact context filtering also runs the sole remaining model directly,
without paying for a redundant classifier or dropping the original task.

Known non-blocking advisories remain experimental OpenTUI FFI, renderer
bundle-size warnings and deprecated transitive `whatwg-encoding` /
`node-domexception` packages in the packed consumer. None is an audit
vulnerability. These results do not qualify live-model quality, physical
SendBox, Linux release readiness or signed/notarized release artifacts.
