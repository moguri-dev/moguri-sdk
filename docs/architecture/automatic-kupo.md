# Automatic Kupo

## Scope and sources

Kupo is a synthetic model in the ordinary composer, not a provider or a second
agent runtime. The user explicitly chose automatic orchestration inside the
normal loop, with only the selected response's tool requests reaching existing
Manual approvals. The separately reviewed
[compound worktree workflow](compound-workflows.md) remains available.

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
models, a bounded tool-less router chooses an eligible Single, Cascade or
Critique plan for the task.

Capability categories describe declared general text, reasoning controls,
tools, images and long-context support. Unknown capabilities and unknown prices
stay unknown. Categories are routing hints, not measured coding quality,
latency, training lineage or billing. Pools of three through twenty models are
covered explicitly; the implementation must not silently truncate the pool.

Critique requires an exact, current, actual-user-reviewed different-lineage
pair using the existing source-review mechanism. Names and provider family
strings do not manufacture independence. Without that evidence, the router
can choose another eligible pattern before execution.

## Response orchestration and effects

Single uses the normal solver loop. Cascade first generates a response/tool
proposal with the efficient model. A bounded tool-less gate either selects
that response or requests one stronger-model response. Critique first drafts,
then runs the eligible read-only critic, and permits at most one revision by
the original drafting model.

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

Protocol/schema 59 adds the automatic policy, exact capability/model snapshots
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
and renderer chunks above 500 kB. Integration observations belong below once
the rebuilt path has actually been exercised.
