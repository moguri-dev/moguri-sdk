# Moguri SDK and CLI

Moguri is one importable SDK, with terminal and desktop clients on top. The
service is the only durable writer; the SDK exposes its typed commands,
queries, sequenced events, optimistic revisions and cancellation. Electron does
not own a second agent loop, settings store or provider connection.

This is an alpha API. Protocol 23 deliberately rejects incompatible running
services and requires the matching SSH worker for exact user plan operations,
reviewed compaction and model telemetry. State migrations preserve schema-1
through schema-22 history, sessions, drafts,
receipts, blobs, indexes and retention compartments. Migration 5 adds optional
model controls without resetting prior defaults. Migration 6 adds nullable project
scope, reviewed configuration and OAuth/attention state. Restart a previously running alpha service explicitly with
`node bin/moguri.mjs service restart`; do not delete its state.

## Build and consume

```bash
npm ci
npm run build
npm pack
```

Install the resulting `moguri-<package-version>.tgz` in a Node 26 consumer with
npm. The latest qualified delivery is `moguri-0.16.0-alpha.1.tgz`; a newer
development manifest is not another qualified archive until explicitly checked.
The package is private and is not published to the npm registry. It includes
compiled SDK modules, declarations, CLI, workers, clients and the pinned local
speech runtime, but no speech weights. Native dependencies must match the
consumer's platform. Use npm's normal dependency installation, not
`--ignore-scripts`, for an operational CLI.
With npm's script allowlist enabled, review `npm install-scripts ls` and approve
this known Moguri package plus its pinned Node/node-pty native installation
steps. A file-tarball dependency is approved by package name rather than a
registry-version selector. Do not approve unused provider lifecycle scripts.

For an installed file tarball, complete its reviewed native-helper setup with
`npm install-scripts approve moguri` then `npm rebuild moguri`.
The approval command resolves the package name to that exact file dependency;
an unapproved install notice is not proof that its postinstall ran.

| Import | Surface |
| --- | --- |
| `moguri` | Browser-safe `MoguriSdk`, typed protocol, defaults, `DraftEditor`, ASCII identity |
| `moguri/node` | `connectMoguri`, `createRuntime`, private service discovery and explicit owned-service shutdown |
| `moguri/react` | Renderer-independent `useMoguri` subscription hook |
| `moguri/mcp` | The single outward native MCP server, bound to one session |

`npm run verify:sdk` packs and installs into a separate temporary consumer,
type-checks all four entrypoints without the repository's tsconfig, and runs an
embedded service with real vector retrieval and native MCP discovery. It also
exercises the packed package's actual PTY transport on macOS after explicit
script approval and an independent consumer audit. It does
not authorize a personal account, record audio or download model weights.

Pass an existing archive to qualify the exact delivered bytes rather than
repacking: `npm run verify:sdk -- release/moguri-0.16.0-alpha.1.tgz`.
Current verification also exercises actual installed-worker SSH files,
Git/plan reads, dated/per-call telemetry and actual metered compaction with the
installed CLI/worker. Historical archives retain their separately
recorded qualification; protocol-16/17/18/19/20/21 SSH receipts remain inspectable without
reattaching or continuing an old worker.

## Connect to the shared service

```ts
import { connectMoguri } from "moguri/node";

const sdk = await connectMoguri();
try {
  const settings = sdk.settings.get();
  if (!settings) throw new Error("Moguri is not connected.");
  console.log(settings.values.appearance.theme); // dark by default
  const projects = sdk.getState().snapshot?.projects;
  console.log(projects?.map(({ id, name }) => ({ id, name })));
} finally {
  sdk.disconnect();
}
```

Connection metadata contains a private token. Never print it, put it in URLs,
send it to a model or pass it to plugins. Disconnecting a client does not stop
the shared service or its owned work. SDK command IDs are idempotent; a lost
response does not authorize an automatic resend.

Embedding is explicit:

```ts
import { createRuntime, connectMoguri } from "moguri/node";

const stateDir = "/absolute/private/moguri-state";
const runtime = await createRuntime({ stateDir });
const sdk = await connectMoguri({ stateDir, autoStart: false });
try {
  console.log((await sdk.voice.status()).voice.diagnostic);
} finally {
  sdk.disconnect();
  await runtime.close();
}
```

Only embed when no other service owns that directory. Importing the SDK alone
does not start a service or read credentials. Node discovery does not load the
provider/MCP/native PTY runtime; `createRuntime` explicitly loads its packaged
`runtime.mjs` entry. Default provider initialization
uses Moguri's OS-keychain backend; generated providers are injected only in tests.

## Shared capability APIs

| Facade | Operations and boundaries |
| --- | --- |
| `profiles` | Root catalog/create/revisioned name-color update/explicit retry-stop/wait, shared global defaults/caps and `open(id)` returning a new immutable scoped client. No account/data copy or automatic selection. |
| `settings` / `prompt` | Get, revision-checked update/reset, effective prompt preview. Prompt edits require explicit risk acknowledgement; running turns retain their prompt digest. |
| `memory` | Opt-in index, lexical-vector search, import/symbol graph, explicit project-style facts. Context injection has a separate opt-in. |
| `capabilities` | Import disabled standard skills/plugins, inspect source, toggle with revision, propose, review and decide against an exact SHA-256. |
| `mcp` | Paged tool discovery, non-secret auth status, explicit OAuth begin/status/cancel/clear/registered-client setup, user-only keychain credentials, exact approval-bound call and retained result pages. |
| `subagents` | Explicit opt-in, depth-one tool-less child using the inherited selected model policy and approved parent context. Every role charges its real owner. |
| `voice` | Local status, explicit licensed download, record/transcribe, stop/finalize and revision-safe draft insertion. |
| `jobs` | Wait or explicitly cancel. A wait timeout/disconnection does not cancel or retry the service's job. |
| `sandbox` | Truthful readiness/configuration diagnostics. Configuration is not proof of a qualified SendBox transport. |
| `issues` | Local feature/bug/misc board, create/update/move/archive, revision-checked phases and read-only linked-PR refresh. |
| `cache` | Local plan inspection, explicit metadata-sharing consent, integrity-verified archive preparation and script-free managed install. |
| `linear` | Optional team-scoped read-only page import, status and user-only OS-keychain credential setup. |
| `sessions` | Revisioned controls/modelOptions, local context preview, rename/mode/pin/unread/group/attach/delete, explicit side/agent children and work-item/verified-PR context. Side sessions cannot acquire write authority. |
| `projects` | Configuration, ordered folders/color, atomic reorder, relocation/removal, scoped Git/source reads, reviewed MCP imports and explicit default-file publication. |
| `prompts` / `DraftEditor` | Copy queued/sent text, revisioned editing and explicit held release. `send("queue", true)` returns the admitted queue ID without starting work. |
| `plans` | Digest-checked Local/Remote plan read/save and independent snapshots. Remote writes require the reviewed binding and an owned no-model operation; actual saves/info/exact-stop expose partial/recovery outcomes without replay. |
| `artifacts` | Independent typed text documents, exact source preview/promotion, revisions, optimistic edits/archive/delete and reviewed project retain/export/delete. No automatic instruction or memory promotion. |
| `questions` | Exact owning-turn/revision-bound actual user answers, choice/freeform validation and optional atomic saved-draft consumption. Question routing never grants tool/Git authority. |
| `budgets` | Cumulative owning-session/profile status, revision-bound hard policy, UTC-filtered/paged role/model/turn dashboard, captured rates and retained calls/stream observations. Filters never change admission; unknown usage remains held. |
| `telemetry` | Independently retained, sanitized tool/MCP outcomes with scoped UTC filters and a known-result failure rate; current-profile key-backed ciphertext sizes, never physical/freed disk usage. |
| `repositories` | Explicit actual-root preview/refresh/state/revision-bound clear, with displayed GitHub access and immutable future model/tool attribution. No automatic lookup, backfill or permission grant. |
| `compactions` | Source/model-bound preview, explicit metered generation, actual history/content review, revision-checked apply/discard and original-context restore. Same Local/SSH worker and ledger; no automatic compaction, history deletion or user-answer/permission promotion. |
| `routing` | Opt-in scoped Single policy/configure with an observed settings revision and session-owned plan history. Actual router/solver roles use the existing worker/ledger; finite caps, images and model tuning remain blocked. |
| `workspaces` | Explicit Local create/discover/inspect/bind/remove/reconcile/wait and session-bound Git/files reads. Owned directory identity is not a process-containment claim. |
| `terminal` | Exact Local PTY open/read/resize/input/close, terminal/owner reconciliation and explicit process-inspection acknowledgements. Authenticated per-profile ownership survives explicit restart. Input/resize bypass durable receipts. |
| `slash` / `slashCommands` | One browser-safe shared dispatcher/catalogue. Results are typed session/native-panel/copy/text actions, not client-owned domain state. |
| `suggestions` | Local scoped preview, exact source digest and explicit generation consent. Analysis uses a normal cancellable/accounted metachat turn. |
| `metachat` / `configuration` | Explicit settings chat, non-secret exact proposals, review and human risk/base-bound apply/reject. No model application or automatic enablement. |
| `attention` | Shared read acknowledgement only; questions/approvals remain unresolved until an actual answer/decision. |
| `models` | Explicit Copilot/local catalog refresh, synthetic Single availability and user-only resource-bound local endpoint keys. Synthetic metadata is not labeled as Copilot. No host scan, weight download or automatic model substitution. |
| `attachments` | Explicit local text/images, exact folder/reference/session previews and confirmation, private snapshot reads. Unsupported models preserve context rather than silently dropping images. |
| `remote` | Explicit pinned-target probe/status, resource-bound endpoint keys and existing-run reconciliation/inspection acknowledgement. No provisioning, key forwarding, Local fallback or side-effect replay. |

### Local user consoles

`terminal.open(sessionId)` is an explicit user action, not an agent tool.
`terminal.read(id, offset, limit)` returns the exact Local binding, actual
attachment generation, bounded volatile data and base/next offsets. A missing
prefix or expired buffer is not reconstructed as a transcript.

```ts
const opened = await sdk.terminal.open(sessionId);
if (!opened.id) throw new Error("No terminal was admitted.");
const page = await sdk.terminal.read(opened.id);
console.log(page.terminal.status, page.terminal.binding?.root);
await sdk.terminal.reconcile(opened.id); // Inspect, never launch or resend.
```

`terminal.input(id, text, signal?)` splits bounded input without splitting a
surrogate pair, and checks cancellation/current `attachmentId` between chunks.
An error can mean some bytes arrived: inspect before typing again, never retry
the same input automatically. Neither input nor resize uses durable command
receipts. Reconciliation and input require the original profile/root identity;
policy can block new Local input without preventing inspection or close.

`terminal.reconcileOwner(ownerId)` also inspects an empty pending owner.
`acknowledge(id, true)` and `acknowledgeOwner(ownerId, true)` require actual user
process inspection and do not prove historical cleanup or delete an unverified
capability. Owner acknowledgement cannot hide unconfirmed terminals.

`stopMoguriService(stateDir, { preserveTerminals: true })` requests an
authenticated **service-wide** restart detach; ordinary stop/default embedded
`runtime.close()` closes known groups across its loaded/recovered profiles.
An explicit embedded `runtime.close({ preserveTerminals: true })` also preserves
them. Failed private cleanup keeps the registry and writer lock, blocks new
work and permits an explicit cleanup retry. No saved PID is blindly signalled.
See [ownership, secret backend and cancellation](architecture/terminal-reattachment.md).

### Reviewed context compaction

`sdk.compactions.state(sessionId)` returns actual retained history, active ID,
current source digest and labeled active/original conversation estimates.
Preview is free of inference:

```ts
const { preview } = await sdk.compactions.preview(sessionId, {
  keepRecentTurns: 2,
  modelId: actualAvailableModelId,
});
const requested = await sdk.compactions.generate(sessionId, preview, true);
// Inspect state after actual settlement, then read the exact proposal.
const { compaction, text } = await sdk.compactions.read(sessionId, requested.id!);
// Only after the actual user reviewed text and compaction.status is proposed:
await sdk.compactions.apply(sessionId, compaction.id, compaction.revision);
```

Generation owns one read-only control turn, not a fake user prompt or optional
subagent. It uses an actual selected model, at most 1,024 output tokens (or its
stricter model/budget bound), normal cancellation and all-role admission.
`sdk.compactions.stop(sessionId, compactionId)` targets only that exact running
operation; a stale request cannot stop newer solver work.
Synthetic kupo requires an explicit real compactor. Missing usage stays held;
tools, incomplete/expanding output and changed source/model/policy cannot be
applied. Text-only support rejects image history without dropping it.

Original encrypted history, complete recent turns and drafts remain retained.
The synthetic context-only summary has no usage anchor; it never replaces the
actual compactor report or ledger charges. Read/discard/restoration do not make
paid calls. Restore with the current state's `activeId` and `sourceDigest`:
`sdk.compactions.restore(sessionId, activeId, sourceDigest, true)`.
Restoring may exceed the working window; normal admission still fails closed.
See [the compaction contract](architecture/context-compaction.md).

### Opt-in Single routing

`sdk.routing.policy()` starts disabled. Configure exact discovered model IDs
with `sdk.routing.configure(policy, observedSettingsRevision)`; the policy has
`workflow: "single"`, an actual `classifierModelId`, explicit
`approvedModelIds`, separate `allowHosted` data consent and a
`minimumConfidence` threshold. `ModelInfo.endpointBoundary` is derived from
validated configured URLs; network/unknown destinations require consent even
when their provider is named local. Loopback is the execution host's HTTP
boundary, not proof against forwarding by a configured proxy. Configured-model
inference rejects redirects. Copilot metadata retains the maintained model's
actual output bound rather than a fixture-only or invented value.
This is uncalibrated model advice, never an
actual user answer or permission.

Only after saving, explicitly select `modelId: KUPO_MODEL_ID` through normal
session controls, the picker or `/model kupo`. `/kupo status`,
`/kupo set POLICY_JSON` and `/kupo history` use the same shared dispatcher.
The session stays labeled `kupo`; `snapshot.routings`, `session.usage` and
`budgetEntries` retain actual roles/models, plans, outcomes and charges.
Classifier output never enters solver context. Invalid, stale, unreported or
over-limit classifier results pause without fallback or another paid attempt.

This alpha uses the same Local/pinned-SSH worker and exact approvals, with an
Unlimited preference only when no finite owning-session/profile/global cap
applies. Images, per-model tuning, compound workflows and reserved wind-down
remain unavailable. Restoring `settings.reset("kupo", revision)` disables
future routing without deleting retained accounting or provenance. See the
[durable routing contract](architecture/routing.md).

In Guided mode `ask_user` may include a bounded offered-choice recommendation.
`UserQuestion.recommendation` contains the exact choice/reason and service-stamped
`model` actor/model/provider/step/call provenance. It is not `question.answer`.
Only an actual `questions.answer`/`answerDraft` user action resolves the wait,
and the user can select a different choice. Approval recommendations similarly
require exact-step `recommendationSource`; no old narration is substituted.
Advice comes from the original metered solver response, not another model
request. Retained documents label model advice separately from the user's
answer. No public command can supply a forged answer actor.

`sessions.create(projectId?, title?, overrides?)` resolves explicit controls
over `project.values.defaults`, `settings.startup.profile`,
`settings.startup.global` and factory values. `session.defaults` records sources
and observed revisions. Existing sessions do not inherit later changes. These
preferences do not weaken policy. Global preferences are intentionally shared;
profile/project/session values remain isolated.

### Immutable profiles

```ts
const created = await sdk.profiles.create("Work", "#557799");
const profile = await sdk.profiles.wait(created.id!);
const work = await sdk.profiles.open(profile.id);
try {
  const chat = await work.sessions.create();
  console.log(work.profileId, chat.id);
} finally {
  work.disconnect();
}
```

The original `sdk` and every existing `DraftEditor` keep their original
destination. `profileId` is also non-writable at runtime. Clients switching
scope must flush old draft editors, preserve/block unsaved local forms and
owned dictation, then explicitly dispose the old client. Switching does not
stop service-owned work or move model context, artifacts, accounts or approval
authority.

`connectMoguri({profileId})` selects an explicit scope; omission means actual
Default. HTTP uses `X-Moguri-Profile`; WebSocket authentication carries the same
immutable identity. Unknown/unready profiles fail explicitly, never fall back.
The CLI/TUI accept `--profile ID`, overriding the explicit
`MOGURI_PROFILE_ID` launch environment. One-shot CLI commands do not mutate
another client's active selection.

Global environment policy and configured global caps remain authoritative
across profile switching, source deletion and restart. `profiles.defaults(values, revision)`
and `profiles.globalBudget(limitOrNull, revision, true)` use root revisions from
`profiles.list()`. Profile `settings.reset` preserves shared global preferences
and hard policies. Restore global preferences explicitly with an empty
`profiles.defaults({}, revision)` action. Global accounting invalidation
contains an opaque sequence, never foreign ledger rows or prompt content.
See the [profile contract](architecture/profiles.md).

Writable Remote turns serialize by captured pinned SSH peer plus canonical
workspace, including across profiles with different Local mappings. A
foreign failed-root quarantine survives unloaded-profile restart until the
actual owner explicitly resumes after inspection. Distinct SSH roots remain
independent; pending read-only changes are not acknowledged lease release.

`settings.localModels` contains explicit endpoint IDs/names/URLs/auth methods
and declared model limits. Metadata discovery lists only configured advertised
IDs. Use `models.setToken`/`clearToken` for bearer credentials; no token belongs
in settings. `provider.connections` keeps Copilot and local status independent;
each model/call has actual provider/API-model provenance.

`settings.remote` holds a non-secret explicit SSH target, pinned public host key,
selected local identity path, private remote state directory, installed worker
argv, scoped-Copilot grant and remote-local endpoints. Projects separately set
`remotePath`. `remote.probe()` verifies the actual worker digest/runtime;
`remote.status()` reports current qualification. Model IDs carry their eligible
environments. `sessions.env()` preserves an eligible selection and clears an
incompatible model/options, never substitutes another provider.

`snapshot.executions` records owned run/target/root, cancellation, cursor and
actual/unconfirmed cleanup. `remote.reconcile(id)` reads existing receipts and
late accounting without replay. `remote.acknowledge(id, true)` records actual
user inspection, not proof of cleanup. Remote endpoint keys use
`remote.setToken`/`clearToken`, distinct from host-local keys. The installed
`moguri worker --stdio` entrypoint exposes the versioned SSH bridge; it never
starts a second local service. See the [transport contract](architecture/execution-transports.md)
for still-unqualified side-panel/extension capabilities.

`workspaces.files(sessionId, path)`, `workspaces.file(sessionId, path)`,
`workspaces.git(sessionId)` and `plans.read(sessionId)` resolve Remote sessions
through that pinned SSH worker and the project's explicit `remotePath`, not
through any Local path. Protected/denied paths, file bounds and Git filter/hook
suppression apply on the execution host. Target, root, env or policy changes
invalidate pending results; disconnects are errors, not empty views or fallback.
These are explicit user views, not implicit attachments or model context.
Remote `/plan` returns text in CLI/TUI, never a Local file-opener action.
Remote plan writes use the same owned worker without a model request.
Pass the exact reviewed binding as the fourth argument:

```ts
const plan = await sdk.plans.read(sessionId);
const saved = await sdk.plans.save(sessionId, editedText, plan.digest, plan.bindingDigest);
const retained = await sdk.artifacts.read(saved.id!);
```

`plans.saves(sessionId)`, `saveInfo(sessionId, saveId)` and
`stopSave(sessionId, saveId)` inspect/control actual operations. A thrown
partial error can mean bytes already changed; inspect before a new explicit
save. A repeated original command never replays its recorded intent after
restart. Local callers retain the three-argument form. See
[Remote plan saves](architecture/remote-plan-saves.md).

`attachments.file`/`image` capture selected content. `folderPreview`,
`githubPreview` and `sessionPreview` return exact source/size/exclusion/digest
data; the matching `folder`/`github`/`session` method needs the reviewed digest
and literal user confirmation. `attachments.read` checks the destination
session's grant before returning text or private image bytes. Source changes
require new preview; source-session deletion does not erase an independently
approved destination snapshot.

Use `sdk.command` for project/session creation, draft/queue changes, controls,
human approvals, archive/resume and allowed-env policy. These are the same
validated commands used by both clients.

### Project-free chats and reviewed configuration

`sessions.create()` or `sessions.create(null)` creates a real project-free chat.
Raw `session.create` also permits an omitted/null `projectId`. No workspace root,
attachments, commands, terminal or repository memory is available, and failure
quarantines only the affected general chat. Scope cannot be reassigned by a
navigation selection. Explicit global MCPs remain subject to normal approvals.

```ts
const general = await sdk.sessions.create(null);
const { preview } = await sdk.suggestions.preview(general.id!);
// Present preview.scope, sources and digest. No inference has occurred.
// After explicit source consent and selection of a model:
const analysis = await sdk.suggestions.generate(general.id!, preview.digest, false, true);
const settingsChat = await sdk.metachat.create(null, general.id, "Discuss Moguri settings.");
```

Project-free previews exclude project chats by default. Passing `allProjects:
true` requires an explicitly project-free source and matching reviewed digest;
generation does not silently widen scope. Metachat can read non-secret config
or create proposals through `moguri_config`, never apply, authenticate or grant
permissions. Optional ordinary evolution still starts off.

`configuration.propose(sessionId, spec)` creates a user-authored proposal;
model-created ones retain `actor: model`. Specs identify `global`, `project`,
`policy`, `repo-instructions` or `skill`, section/value/reason and optional
verified evidence IDs. `configuration.review(id)` returns the exact before/
after value and warning. Only after actual human review/risk acknowledgement,
call `configuration.decide(id, true, reviewed.proposal.contentDigest, true)`.
Reject with `false`. Status, base revision/digest and target validity are
rechecked at apply. Skills install disabled; repo writes are local and report
partial effects if their durable decision fails. Proposals survive origin-session
deletion in their independent target compartment.

`attention.acknowledge(ids)` marks shared items read; it never answers/approves.
Preferences are `settings.values.notifications`: `inApp: true`, `os: false`,
`previewContent: false` by default. Native OS delivery/navigation is an Electron
binding of service events, not a second notification state store.

### Held prompts, modes and retained plans

```ts
import { DraftEditor } from "moguri";

const session = sdk.getState().snapshot?.sessions.find((item) => item.id === sessionId);
if (!session) throw new Error("Choose a session.");
const editor = new DraftEditor(sdk, session.id, session.draft);
try {
  editor.edit("Review the generated change.");
  const held = await editor.send("queue", true); // No model call, even when idle.
  console.log(held.id);
} finally {
  editor.dispose();
}
await sdk.slash(sessionId, "/read-only", "cli");
const side = await sdk.sessions.spawn(sessionId, "side");
const plan = await sdk.plans.read(sessionId);
// A read-only session cannot save a plan or promote a question-only child.
// Native panel/copy results from slash() must be handled by the client binding.
```

Release a held prompt with `prompts.release(sessionId, messageId,
observedQueueRevision)` only after explicit user admission. A selected available
model, ready environment and policy are required then, not when holding text.
`/run ID` uses this same operation. Returning to agent mode is a safe-boundary
request; immediate restriction and model-declared tools are service-enforced.

Project settings use `projects.configuration` and
`projects.configure(projectId, settings, observedRevision)`.
`projects.sources` returns the actual instruction/MCP source and `mcpDigest`;
`projects.importMcp(projectId, observedRevision, true, reviewedDigest)` rejects
file changes after review and installs supported entries disabled.
Project MCP auth/token operations must include their bound session ID.
`projects.initialize` is an explicitly confirmed non-protected-branch push job,
not an implicit effect of reading settings. Inspect its terminal result:
partial or cancelled publication is not success.

Artifacts are independently encrypted in project/profile scope.
`plans.save`/`capture` retain a plan snapshot with unknown file authorship;
`plans.artifact` remains readable after session deletion. Source-session
deletion requires confirmation and an observed session revision.
Project removal refuses retained managed worktrees; remove them explicitly first.
It requires a reviewed artifact choice before forgetting project content/derived indexes and project
MCP credentials, never source files, external PRs or shared caches/models.
Archived retention is opt-in `settings.values.retention`; `retention.run`
honors that policy. Production retention uses the explicit OS-keychain backend;
generated embedders/tests may inject a 32-byte `retentionKey`, never hardcode a
real key or silently derive one from a path.

### Independent artifacts

```ts
const created = await sdk.artifacts.create(null, {
  projectId, kind: "decision", name: "Generated decision", text: "Explicit text.",
});
await sdk.artifacts.update(created.id!, { text: "Explicit revised text." }, 0);
const old = await sdk.artifacts.read(created.id!, 0);
const revisions = await sdk.artifacts.history(created.id!, 0, 20);
const source = await sdk.artifacts.source(sessionId, "message", messageId);
const answer = await sdk.artifacts.promote(sessionId, {
  sourceKind: "message", sourceId: messageId, kind: "answer",
  name: "Reviewed answer", expectedDigest: source.preview.digest,
});
const exported = await sdk.artifacts.export(answer.id!);
```

`create(sessionIdOrNull, document)` uses that session's explicit scope, or the
supplied project/profile scope with no invented conversation/filesystem root.
Promotion copies the exact canonical completed user/model message or terminal
tool result, preserving its real actor, source event, digest and outcome.
Later edits set `edited`, never relabel model text as a user answer.
Archive is `update(id, {status: "archived"}, observedRevision)`; restore uses
`active`. `delete(id, observedRevision, true)` forgets that artifact's grants
and all revisions, not other copies or source files. Reads/history reject deleted
IDs even when another artifact contains identical text.

`projectPreview(projectId)` binds the exact current set to a digest.
`projects.remove(projectId, true, observedRevision, choice)` accepts
`{action: "retain"|"delete"|"export", expectedDigest, exportedDigest?}`.
Export requires the exact `projectExport` digest and explicit client saving
before deletion; retain creates a new profile-owned revision. Concurrent edits
invalidate the choice. The explicit Node entrypoint exports
`saveArtifactExport(absoluteNewPath, export)`: private atomic new-file delivery,
digest verification and fsync, no overwrite or automatic app opening.

Text is bounded to 128 KiB UTF-8, history pages to 100 records, JSON exports to
8 MiB with no truncation.

Artifact create/update accepts nullable `folderId` and `workItemId`. Folders
belong to this profile; a work item must belong to the artifact's project.
These are versioned associations, not a filesystem path or model permission.

`artifacts.materializePreview(projectId, {workspaceId?, commitBranch?})` returns
the exact source-set/file/review digests, canonical root identity, destination,
policy revision and optional new local branch/base. Explicit
`artifacts.materialize(projectId, reviewDigest, sameOptions)` durably starts an
owned job before effects. Wait with `jobs.wait`, inspect the typed
`artifacts.materialization(jobId)` and request stop through `jobs.cancel`.
A timeout is not cancellation. Partial/interrupted jobs preserve source grants
and their original destination intent; restart never replays publication.

Copying writes one exact private history bundle under that selected Local
root's `artifacts/`. Optional commit uses a temporary index and a new
non-protected local branch, preserving checkout, index and unrelated edits,
with no push/signing/hooks/filters. `projects.remove` may use
`{action:"materialize", expectedDigest:setDigest, materializationId:completedJobId}`.
The service rechecks real bytes and any requested local commit before
forgetting source grants. Changed source/file/root/branch rejects deletion.
Remote/Sandbox publication is unavailable, not mapped to Local.

### Actual structured answers

`snapshot.questions` contains typed model clarifications and their real
status/provenance; `session.pendingQuestionId` identifies an active owner.
`questions.answer(id, text, observedRevision)` accepts only actual user input
for that live question/turn. It cannot set an actor, approve tools or answer
another turn. `questions.answerDraft(id, observedRevision)` consumes the exact
saved owning-session text atomically; flush a `DraftEditor` first. Attached
context is preserved and stale draft/question revisions reject the entire
operation.

Question routing respects explicit tool denials but does not ask for redundant
permission to ask a clarification. Worker cancellation stays non-blocking;
stop/restart cancels pending questions without manufacturing an answer.
`settings.values.artifacts.retainAnswers` defaults true as requested.
Answer event, independent artifact with model-question/user-answer sources,
draft clearing and command receipt commit together; failure rolls back all.
Disabling retention preserves canonical source events until their session
retention applies. Model/delegated-decision answers require their own future
policy/call provenance, never this actual-user endpoint.

### Estimated limits and independent accounting

Session controls accept `{kind:"limited", basis:"estimate", tokens?, usd?}` with
at least one positive limit. A finite control without explicit estimate policy
is rejected. `budgets.status(sessionId)` returns actual/held/incomplete totals,
effective session/profile caps and unavailable-unit diagnostics.
`budgets.policy(limitOrNull, observedRevision, true)` is a separate explicit
profile-policy action; settings/default resets never lift it.

USD admission requires a fresh model-specific
`settings.values.budgets.rates` entry with canonical `modelId`,
`inputUsdPerMillion`, `outputUsdPerMillion`, UTC `effectiveAt` date and
`source:"user-estimate"`. Default rates are empty, not Copilot zero prices.
The configured conservative input rate includes cache categories; provider
totals are never increased by adding those categories twice.

Reservation and `model.started` commit before the real worker is authorized.
The actual reduced output limit reaches maintained pi-ai. Complete reports
settle once; stop, lost frames and restart retain full unknown reservations.
Authenticated late SSH receipts can improve accounting without replaying work
or completing partial turns. Profile-owned entries survive session/project
retention. Historical unknown bounds/prices block affected finite units.

`budgets.dashboard({projectId?,folderId?,sessionId?,turnId?,providerId?,modelId?,role?,env?,range?,bucket?,offset?,limit?})`
returns complete matching totals, UTC periods/captured price history and paged
actual role/model groups. `range` is `{kind:"days",days:7|30|60|90|365}`,
`{kind:"year",year}`, `{kind:"custom",from:"YYYY-MM-DD",to:"YYYY-MM-DD"}`
(inclusive UTC dates), or `{kind:"all"}`/omitted. `bucket` is `day`, `week`
(Monday), `month` or `all`. Unknown historical request times are disclosed and
excluded from dated views, not treated as zero; All time includes them.

`budgets.calls({...sameScopeFilters,offset?,limit?})` returns bounded retained
current-accounting call pages, actual/owning turn, nullable categories, captured
rate and observed stream metadata. New/late reports can reorder pages; do not
sum pages to derive totals. Observed delivery rates exclude unqualified and
non-generative observations and are not GPU benchmarks. Absent cache details or
single-chunk timing stay unknown. Use the same filters via `/dashboard JSON`,
`/dashboard calls JSON` or CLI `budget dashboard|calls --filters JSON`.
Estimates, provider reports and bills are separate; no billed USD is invented.
Input reservation is estimated and provider charges can lag or exceed it.
A provider exceeding its forwarded output bound is partial/unqualified for
finite retry. A blocked request creates a deterministic retained checkpoint,
not a model answer or successful commit. Kupo wind-down and committed checkpoints
remain separate scheduler/Git qualification.

### Tool outcomes and retained size

`telemetry.operations({...sameScopeFilters,family?,actor?,name?,serverId?,outcome?,offset?,limit?})`
returns all matching totals/groups and a bounded attempt page. Families are
`tool` and `mcp`; actual actors are `model`, `external` or `unknown`.
MCP attempts are not added a second time as gateway/result jobs. The failure
rate denominator is completed + failed; denial, pending/running, stopped,
partial, unconfirmed and unknown outcomes have independent counts. No known
results means a null rate, not zero-percent failure.

The allowlisted ledger retains no arguments, paths, commands, prompts, output
or error text. Source deletion does not erase sanitized metadata. Startup can
import only retained evidence; coverage explicitly discloses unavailable
pre-upgrade deleted history. Missing start time or elapsed samples are unknown,
not zero. A late result does not turn its owning partial session into success.
Explicit user plan saves remain their own control-operation history.

`telemetry.storage()` returns current-profile sealed event-payload, encrypted
blob-grant and encrypted key bytes/counts in one read transaction. One content
digest can have multiple real encrypted grants. Physical/freed disk remain
null, and key presence is not a decryption/integrity audit. Structural payload
copies, metadata/receipts/tombstones, SQLite overhead/WAL, forgotten ciphertext,
worktrees/repositories, caches, weights, memory indexes and terminal buffers
are excluded. It accepts no date/project/model filters.

Use CLI `telemetry operations --filters JSON`, `telemetry storage`, or shared
`/dashboard operations JSON` and `/dashboard storage`. F7 and desktop Dashboard
expose the same SDK projections. See [the exact contract and prerequisite
measurements](architecture/operation-telemetry.md).

### Verified repository filters

`repositories.preview(sessionId)` reads the actual Local/worktree or pinned SSH
origin without GitHub access. Review its root, `lookupBoundary`, repository,
`bindingDigest` and observation `revision`.
`repositories.refresh(sessionId, bindingDigest, revision, true)` starts one
owned job; inspect `jobs.wait(id)` and `repositories.state(sessionId)`.
`repositories.clear(sessionId, revision, true)` affects future attribution,
not historical names, metadata or charges.

Public metadata uses the control-plane API without credentials; Local
`gh-cli` requires explicitly selected project access. Remote authenticated CLI
is unavailable, never a Local account fallback. Copilot credentials are not
reused. No network lookup occurs at model admission: configured calls recheck
their actual Git identity and capture previously verified metadata or remain
unassigned.

Budget/call/tool queries accept `repositoryId`, `organization` and
`visibility:"public"|"private"|"internal"|"open-source"`. Each result discloses
`repositoryCoverage` before those filters. `open-source` is only the documented
public-plus-detected-OSI category; missing license evidence stays unknown.
`entry.repository` is an immutable admission snapshot, not today's GitHub
state. Never sum filtered pages to infer cumulative charges.

CLI `repository` and shared `/repository` review/refresh/state/clear/stop
commands expose the same API; `/dashboard JSON` accepts the new filters.
See [repository attribution](architecture/repository-telemetry.md) for exact
scope, cancellation, privacy, licensing and recovery semantics.

### Managed Local roots

```ts
const intent = await sdk.workspaces.create(projectId, "moguri/generated-work", {
  baseRef: "main",
  // Optional issueId and verified-format prUrl retain change-set association.
});
const workspace = await sdk.workspaces.wait(intent.id!);
const created = await sdk.sessions.create(
  projectId, "Generated isolated work", { env: "Local" }, workspace.id,
);
const files = await sdk.workspaces.files(created.id!);
const file = await sdk.workspaces.file(created.id!, files.entries[0]!);
const changes = await sdk.workspaces.git(created.id!);
const registered = await sdk.workspaces.discover(projectId);
```

`snapshot.managedWorkspaces` and `changeSets` are authoritative projections.
`sessions.create` accepts an optional fourth workspace ID; `sessions.fromWork`
accepts an optional third ID. A fresh idle session may explicitly bind/unbind
with `workspaces.bind(sessionId, workspaceIdOrNull, observedRevision?)`.
No mapping from a Local checkout to a Remote/Sandbox path is inferred.

Worker tools, repository instructions, plans, terminals, context, MCP cwd,
cache installs and memory use the same root. Pass the optional workspace ID to
`memory.index/search/graph` and `cache.inspect/install` when operating outside a
session facade. Ordinary base-project callers retain their existing behavior.
Archive/deletion never removes a worktree or branch. Explicit removal requires
a clean, idle, unbound owned root and `remove(id, observedRevision, true)`.
Wait observes its job; aborting a wait is not cancelling the job. Use
`jobs.cancel(workspace.jobId)` for cancellation, then inspect partial outcomes.
`reconcile` verifies existing identity/absence without re-executing Git.
Discovery reports Git registrations, not new ownership or filesystem authority.
External worktree adoption and multi-candidate orchestration remain unavailable.

### Model context and thinking

`sessions.modelOptions(sessionId, options, observedRevision?)` stores optional
`contextWindow` and `thinkingEffort` alongside the session controls. The working
window cannot exceed the selected model's fixed maximum. It is enforced against
the maintained library's labeled context estimate and output/headroom sizing,
not represented as exact tokenization or a finite spend cap. Oversized estimates
stop before inference without silently dropping or compacting history.

Use the selected `provider.models[].thinkingLevels`, not a hardcoded effort
list. A transport may have reasoning but not expose configurable effort;
unsupported options fail explicitly. Omitting effort uses the model default.
`sessions.context(sessionId)` reads an estimate including saved draft,
instructions, tools and conversation without calling a model. The normalized
provider payload stays service-side.

Desktop puts these settings in the model-name popover. TUI uses
`/model-settings` to inspect, `/model-settings JSON` to apply and
`/model-settings reset` to restore defaults. CLI uses
`session model-settings options.json --session ID --revision N` and
`session context --session ID`. Changes require an idle session; running turns
retain their selected settings and every step records effective provenance.

To enable memory, clone `sdk.settings.get().values`, set `memory.enabled`, then
call `settings.update` with the observed revision. `memory.index(projectId)`
returns a job ID. Wait for a terminal job, inspect its status, and use
`mcp.readResult(jobId)` for the retained bounded result. Failure, partial work
and cancellation must not be interpreted as completion.

## Skills, scripts and plugins

Standard skills are `SKILL.md` files with YAML `name` and `description`, followed
by Markdown instructions. Imports start disabled and grant no permissions.
Enabled skills enter the protected prompt as identified project knowledge.
Model proposals retain their model actor and base digest. Human approval
installs disabled content; enabling it is a separate explicit action.

A version-1 plugin is a declarative skill bundle:

```json
{
  "schemaVersion": 1,
  "name": "example-conventions",
  "version": "1.0.0",
  "description": "Project conventions",
  "skills": [
    "---\nname: example-style\ndescription: Explicit result types\n---\nPrefer explicit result types at public boundaries."
  ]
}
```

Enable the plugin before any bundled skill. Disabling the owner prevents its
contents from entering context. Arbitrary JavaScript entrypoints, dependency
installation, marketplace updates and unattended self-modification are not
implemented.

Approved custom scripts are Node modules receiving JSON on stdin:
`{"arguments":{},"projectRoot":"/approved/project"}`. They emit bounded stdout,
must exit, and are exposed as `script.CAPABILITY_ID` through the internal MCP.
They are **unsandboxed Local host code**. Review the exact source, enable it,
then approve each call. The source digest is part of the discovered schema
fingerprint; an old approval cannot silently execute changed content.

## One native MCP

```bash
node bin/moguri.mjs mcp --session SESSION_ID
```

Configure that command as a stdio MCP in another client. It exposes only
`moguri_discover_mcps`, `moguri_find_tools`, `moguri_auth_status`,
`moguri_call_tool` and `moguri_read_result`. It cannot change settings,
credentials, permissions or answer its own approval. Calls wait for the human
in the bound idle session, then retain a paged result.

Backend MCP transports are stdio and Streamable HTTP, using no auth or a scoped
OS-keychain bearer credential or explicit OAuth. HTTPS is required except explicitly configured
loopback HTTP. Discovery
is bounded to 512 tools/64 pages, with 20 tools per SDK response. Tool schemas
and server versions are fingerprinted and rechecked at invocation. Credentials
are not forwarded through environment variables to stdio children.

Set HTTP `transport.auth` to `"oauth"`. `mcp.oauthBegin(serverId, sessionId?)`
returns the authorization ID; `mcp.oauthStatus(id)` exposes its ephemeral URL
and lifecycle. Open that URL only on explicit user action. `oauthCancel(id)`
settles a flow; `oauthClear(serverId, sessionId?)` removes its credential bundle.
`oauthClient(serverId, clientId, issuer, clientSecret?, sessionId?, redirectUri?)`
stores a registered client in the secret backend. Optional `redirectUri` must be
an exact fixed loopback callback registered with the issuer; no silent port
fallback. Do not put client secrets in settings or command-line arguments.

The official SDK performs S256 PKCE, issuer/resource discovery, registration,
exchange and refresh. Resource changes do not reuse another resource's key.
New grants require a durable connected decision before use. Cancel/expiry/
restart never replays a callback; revoked/failed refresh never retries a tool
or changes to anonymous/bearer auth. Project operations must include the bound
session ID, including outward auth-status queries.

The curated internal MCP exposes `grep_logs`, `fetch_page`, `search_memory` and
`memory_graph`. Page fetching requires approved HTTPS, pins the resolved public
destination, rejects private networks/unsafe redirects and bounds extraction.
Tool descriptions, annotations, output and model recommendations remain
untrusted data, never permission grants.
Project-free discovery/calls exclude workspace tools and approved project scripts.

## CLI entrypoints

`moguri --help` lists the session/project/queue/plan commands.
Examples: `moguri slash "/read-only" --session ID`,
`moguri session rename NAME --session ID`,
`moguri queue hold prompt.txt --session ID`,
`moguri project get ID`, and
`moguri project set ID settings.json --revision N`.
Project-free/engagement commands include `moguri session create`,
`moguri metachat [REQUEST] --session ID`,
`moguri suggestions preview --session ID`,
`moguri suggestions generate --session ID --digest SHA256`,
`moguri configuration review ID`,
`moguri configuration apply ID --digest SHA256 --acknowledge-config-risk`,
`moguri attention list` and `moguri attention read ID`.
Use `--all-projects` only after explicitly reviewing that wider source scope.
Destructive removal requires `--confirm-remove`; default publication requires
`--confirm-push`; repo MCP import requires `--confirm-review --digest SHA256`.
Queue mutations use their observed queue revision, not the session revision.

### Dependency cache and project tickets

```ts
const { plan } = await sdk.cache.inspect(projectId, "npm");
// Only after the user reviews the plan and accepts OSV metadata disclosure:
const preparation = await sdk.cache.prepare(projectId, "npm", plan.digest, true);
const result = await sdk.jobs.wait(preparation.id!);
if (result.status !== "completed") throw new Error(result.error ?? result.status);

const ticket = await sdk.issues.create(projectId, {
  title: "Add a generated feature", body: "", kind: "feature",
  phaseId: "backlog", pullRequestUrl: null,
});
await sdk.issues.move(ticket.id!, "in-progress", 0);
```

`cache.install` is a separate explicit action replacing `node_modules`, never
an automatic consequence of inspection/preparation. It repeats advisory checks,
uses private clean staging without project hooks/configuration, and rechecks the
lock before replacing the tree. npm requires an installed npm CLI; pnpm's native
launcher is pinned with Moguri. Only single-project npm lockfile 2/3 and pnpm
lockfile 9/public SHA-512 npm artifacts are qualified. Unsupported managers,
workspaces, Git/custom/private resolutions and required lifecycle scripts fail
explicitly. A clean advisory result is not a malware-free guarantee.

Boards are local, project-scoped and have no assignee. `issues.configure`
accepts `BoardConfig` plus its observed revision; occupied phases cannot be
removed. Linking a canonical GitHub PR permits bounded read-only observation
while Moguri runs, unless the board disables it. Choose the public API or an
explicit signed-in GitHub CLI account. A verified merge advances to
`mergedColumnId`; closed/unknown/failed checks and stale responses never do.

Linear is off by default. Enable one team in the board, store the user's
personal API key with `linear.setToken` and explicitly call `linear.import`.
Each page imports at most 50 tickets, preserves provenance and existing local
edits, and returns a retained `nextCursor`. No local issue is exported and no
assignee/person data is requested. OAuth/two-way unattended synchronization is
not implemented. Credentials are never event payloads, draft text or model input.

CLI examples:

```bash
moguri issues list PROJECT_ID
moguri issues create PROJECT_ID issue.json
moguri issues move ISSUE_ID in-progress --revision 0
moguri issues configure PROJECT_ID board.json --revision 0
moguri cache inspect PROJECT_ID npm
moguri cache prepare PROJECT_ID npm PLAN_SHA256 --accept-dependency-metadata
moguri cache install PROJECT_ID npm PLAN_SHA256 --accept-dependency-metadata
moguri linear import PROJECT_ID
```

`issue.json` has exactly `title`, `body`, `kind`, `phaseId` and nullable
`pullRequestUrl`. `board.json` has `columns`, `mergedColumnId`, `autoRefreshPrs`,
`githubAccess` and `linear: { enabled, teamId }`. Update/move/archive/configure
require the observed `--revision`. `linear token` reads piped stdin instead of
shell arguments; TUI `/linear token` uses a dedicated masked editor.

### Client lifecycle

`node bin/moguri.mjs --help` lists supported commands. A normally installed
package also supplies the `moguri` executable. `moguri status` exposes project
and session IDs without printing transcripts or connection credentials.
`config`, `prompt`, `memory`, `skills`, `plugins`, `mcp`, `agents`, `dictate`
and `service` are SDK adapters. A published desktop binary is supplied separately;
starting desktop from source requires the development Electron dependency.

The TUI's **Ctrl+G** exposes shared settings. Its JSON editor includes all
sections and rejects stale revisions. **Ctrl+Enter** explicitly acknowledges
prompt risk and saves; **Ctrl+R** restores; **Esc** discards that local editor.
See [setup](setup.md) for terminal commands, dictation and supported limitations.
