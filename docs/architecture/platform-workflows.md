# Reviewed platform workflows

The owner-requested protocol/database **41** extension adds tiered knowledge,
lifecycle hooks, repository-backed catalogs, reviewed Git/GitHub and Linear
workflows, and scoped dependency caching. These are shared service/SDK
capabilities, not separate client stores or a claim that the first milestone,
all environments, or the remaining roadmap are complete.

The owner selected a repository-backed catalog with reviewed installs, not a
hosted marketplace. Cache scope is npm/pnpm, Python, Rust/Cargo and Go; C# is
deferred and Yarn is not added. Whole-descendant containment requires a
qualified SendBox boundary. Ordinary Local/SSH retains its disclosed
process-group limitation rather than being renamed as fully contained.

## Reuse and qualification

Reuse Node crypto/SQLite/process APIs, React, TypeBox and Node-PTY (MIT),
semver (ISC), existing keychain, event/retention, worker, budget, folder-policy
and SDK transports. No second model loop, native terminal renderer, privileged
macOS tracker, connector service or hosted account is introduced.

Fresh generated prerequisite measurements on macOS arm64:

| Primitive | Result |
| --- | --- |
| Intercepted Copilot device/discovery/streaming/cancellation | PASS, 1,079.07 ms; six generated HTTP requests, cancellation 31.36 ms |
| 1,000 SQLite appends, crash rollback and rebuild | PASS, 84.16 ms; append p95 0.062 ms, rebuild 0.607 ms |
| Known PTY group cancellation | PASS, 151.99 ms; zero known group survivors, not detached-descendant proof |
| Native TUI | PASS, 60 updates averaging 16.97 ms |
| Hidden Electron shell | PASS, startup 177.68 ms, 449.83 MiB, scroll frames 8.08 ms |
| Bounded 2,000-file/Git baseline | PASS, listing 0.981 ms, Git status 5.92 ms |
| Existing generated npm/pnpm archive/mirror spike | PASS, 816.57 ms, 686-byte archive; tampering rejected and no lifecycle script |
| Retention/Ghostty prerequisites | PASS, 500 events/250 independent artifacts in 127.57 ms; actual WASM primitive 25.5 ms |

The baseline spike's historical unavailable-service messages are not fresh
qualification of every later transport. Actual installed SendBox reports
0.2.3 and Apple Containerization 0.10.0; executable presence alone is not
readiness. Old protocol-40 workload receipts cannot qualify protocol 41.
No personal login, paid inference, real microphone, ambient registry credential
or unrelated project's processes are used.

Git/gh licensing, wire/version/cancellation gates and exact operations are in
[GitHub workflows](github-workflows.md). Linear's team/account/remote-version
and two-way ticket contract is in [Linear workflows](linear-workflows.md).
Private/workspace/native-manager cache admission is in
[dependency cache scopes](dependency-cache-scopes.md).

## Sky, Terra and Glacier

`knowledge.save` accepts either an exact Sky session/lifetime or a Terra
project and optional local work item. A project-free Sky note keeps a null
project; it cannot acquire an unrelated repository. Each note has its own
encryption compartment, immutable owner, revision and SHA-256 content digest.
Sky with `lifetime: "turn"` binds the actual current turn, not queued text or a
future guessed turn. That owning turn's terminal event expires it atomically.
Session-lifetime Sky expires on archival/deletion. Project removal expires
Sky/Terra, not profile-wide Glacier.

Promotion is a separate actual-user command binding exact source revision
and digest, a title and explicitly reviewed text. Only project-bound Sky can
promote to the same project's Terra. Sky/Terra can promote a reviewed summary
to Glacier with independent profile-wide retention. A summary is bounded to
8,000 characters and cannot exceed its source's UTF-8 bytes. This is a
mechanical bound and human review, not a claim of semantic compression quality.
No model is called, source content is not silently truncated, and the original
note is not replaced. The new record retains source identity/digest and the
actual user promotion actor; provenance is not permission.

`knowledge.list`, `read`, `history`, `version`, `rollback` and `forget` use the
same immutable profile. Listing/search is bounded lexical matching, not a
semantic-model claim. A rollback must name retained bytes of that exact note
and creates a new revision. Edits cannot change lifetime, project or work item.
Explicit forgetting revokes that note's compartment and retained revisions,
not another note or independently promoted copy. This does not claim physical
disk reclamation.

`memory.useTieredContext` is a new separate optional preference, **off** for
both factory defaults and existing state. It also requires `memory.enabled`.
The existing source-index `useInContext` consent does not enable it. When
selected, the service supplies bounded, escaped untrusted note data with
original owners/digests and an omitted-note count. Notes never become system
authority, tool approval, a user answer, or an executable instruction.

Desktop uses **Settings / Knowledge tiers** and the separate **Repository
memory** context opt-in. Shared terminal commands:

```text
/knowledge list Sky
/knowledge save {"tier":"Sky","lifetime":"session","title":"Observation","text":"Reviewed temporary observation."}
/knowledge save {"tier":"Terra","title":"Convention","text":"Reviewed project convention."}
/knowledge read NOTE_ID
/knowledge history NOTE_ID
/knowledge version NOTE_ID CONTENT_SHA
/knowledge promote NOTE_ID REV SOURCE_SHA confirm-promote {"tier":"Glacier","title":"Convention","text":"Reviewed convention."}
/knowledge rollback NOTE_ID REV CONTENT_SHA confirm-rollback
/knowledge forget NOTE_ID REV confirm-forget
```

The selected session supplies only its own explicit Sky/project identity in
slash commands; JSON cannot override it. Dedicated CLI inputs instead contain
the complete typed owners in a reviewed JSON file:

```sh
moguri knowledge save NOTE.json
moguri knowledge promote NOTE_ID SUMMARY.json --revision 0 --digest SOURCE_SHA --confirm-review
moguri knowledge forget NOTE_ID --revision 0 --confirm-remove
```

## Lifecycle hooks

Version-1 hook definitions declare `name`, `description`, `trigger`,
`command`, and `timeoutMs` (1,000 to 60,000). Qualified triggers are
`turn.start` and `turn.end`; no other trigger is silently ignored.
Imports and model proposals are **disabled**. Evolution remains opt-in and
can propose a hook, skill, script or memory only for actual human review.
Proposal approval cannot detach a plugin-owned capability or grant a tool.

An enabled start hook executes through the existing worker/tool approval path
before model admission, so a pending or denied hook creates no fake
`model.started`, model reservation or free model usage. End hooks run after
ordinary successful solver completion, not on cancellation, failed cleanup,
metadata-only wind-down, private roles, compaction, read-only/side chats or
public tool-less compound roles. The control plane verifies ordering and
completion rather than trusting a worker to skip a required hook.

Every request binds the original hook ID/revision/digest, exact command,
trigger, root and owning turn. Current mode/folder/hard denials and native/SSH
scope still win. Manual/Guided needs an actual approval unless an exact
command delegation exists. If Max's additional delegated-tool review is
configured, a hook with no solver decision source stays human-reviewed
instead of manufacturing model provenance. Hook output is retained with its
`user-configured-hook` actor in the event trace, never injected into model
history or terminal input/output receipts.

Failure, denial or missing result acknowledgement stops continuation.
Cancellation propagates through the same worker and process/VM boundary.
Native process-group uncertainty remains partial; no detached descendant is
claimed stopped solely from group exit. Hook/bundle replacement, rollback
and state changes wait until project turns settle. Nothing replays on
restart. Enabling is not an approval to run Git, authenticate, change policy
or modify Moguri.

Desktop exposes **Lifecycle hooks**, exact content review and separate enable
controls. `/hooks import DEFINITION_JSON` imports disabled;
`/capability view ID`, `history ID`, `version ID SHA`,
`enable/disable ID REV confirm-state` and
`rollback ID REV SHA confirm-rollback` inspect/control actual retained content.
Dedicated CLI uses `hooks import DEFINITION.json --project ID
--confirm-review`. A selected enabled skill can be inserted into an exact
saved draft through `capability use ID --session ID --digest SHA`; this does
not send, consume held prompts, or grant permissions.

## Repository-backed marketplace

Catalogs are version-1 JSON files in a registered repository. The user chooses
the source project, full immutable commit SHA, relative catalog path,
destination project, and exact package name/version. The service reads only
that committed regular Git object with bounded output. It never clones,
fetches, checks out a branch, follows a catalog symlink, reads an ambient
credential, runs installation code, or assumes that a mutable tag/working tree
is the reviewed source.

A catalog's `packages` are complete inline manifests:

```json
{
  "schemaVersion": 1,
  "packages": [{
    "schemaVersion": 1,
    "name": "project-checks",
    "version": "1.0.0",
    "description": "Reviewed project checks",
    "license": "MIT",
    "minimumProtocol": 41,
    "maximumProtocol": 41,
    "skills": [],
    "scripts": [],
    "hooks": [{
      "schemaVersion": 1,
      "name": "before-turn",
      "description": "Reviewed preflight",
      "trigger": "turn.start",
      "command": "printf 'project check\\n'",
      "timeoutMs": 1000
    }]
  }]
}
```

Skills contain standard inline `SKILL.md` front matter/content; scripts contain
`name`, `description` and reviewed JavaScript `content` for the existing
permissioned MCP script path. These are inspectable bundles, not arbitrary
plugin entrypoints. Version/protocol compatibility, duplicate kind/names,
complete bundle size (64 KiB), source/destination root identities, policy,
catalog bytes and all installed revisions enter review.

`marketplace.catalog` browses metadata without installing;
`marketplace.preview` shows the complete selected bundle and original source.
`marketplace.install` requires that exact preview digest and actual-user
confirmation. The plugin and all children commit atomically **disabled**.
Updates reuse original identities, disable replaced children and mark removed
ones retired; retired children cannot be re-enabled independently. Bundle
rollback restores its complete retained manifest/children, also disabled.
Enabling, prompt/script preparation and hook admission recheck protocol
compatibility. Legacy skill-only bundle rollback fails explicitly instead of
guessing missing child history. Declared license metadata is not a legal,
malware-free or quality certification.

Desktop provides **Marketplace** catalog browsing, exact source/bundle review,
separate installation and capability/version controls. Shared commands:

```text
/marketplace catalog {"sourceProjectId":"SOURCE_ID","commit":"FULL_COMMIT_SHA","path":"moguri-marketplace.json"}
/marketplace preview {"sourceProjectId":"SOURCE_ID","commit":"FULL_COMMIT_SHA","path":"moguri-marketplace.json","packageName":"project-checks","version":"1.0.0"}
/marketplace install REVIEW_SHA confirm-install INPUT_JSON
```

CLI: `marketplace catalog SOURCE.json`, `preview INPUT.json`, then
`install INPUT.json --digest REVIEW_SHA --confirm-review`. The CLI JSON includes
the explicit destination `projectId`.

## Whole-descendant containment

`containment.status()` distinguishes known process groups from an actual
qualified VM boundary. `containment.requireSandbox(true)` is an explicit
global allowed-env change to `["Sandbox"]`; it neither changes a session's
selected Env nor qualifies missing artifacts, chooses a model or starts work.
Factory defaults stay Local, model unset, Manual and Unlimited.

The existing authoritative policy blocks every new non-Sandbox turn,
including queued/child/restarted work. Already-running Local work retains its
recorded finishing exception and is not falsely relabeled contained.
Sandbox requires exact current release/image/worker/bridge qualification.
The actual owned VM must be verified absent before complete descendant
cleanup is recorded. CLI exit, a process scan, an inherited environment
marker or a remembered PID cannot establish it. VM containment is not
permission, successful source rollback, or protection from prompt injection.
User console/native side-panel limitations remain explicit.

Apple's [Darwin event header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event.h)
states that `NOTE_TRACK`, `NOTE_TRACKERR` and `NOTE_CHILD` have not been
supported since macOS 10.5. Polling descendants, comparing command names or
killing a reused PID is not substituted for that missing native guarantee.
No Endpoint Security entitlement, privileged helper or unrelated VM is
silently adopted.

Desktop's Guardrails selector has an explicit **Require qualified SendBox for
whole-session containment** choice. CLI `containment require-sandbox
--confirm-review` and shared `/containment require-sandbox confirm-policy`
perform the same user-only change; `status` never launches a VM.

## Persistence and acceptance

Migration 41 is additive: prior ciphertext, immutable events, receipts,
profiles, context, defaults and original terminal owners are not rewritten.
New knowledge events grant content through `EventStore.references()` in
their same transaction. GitHub/Linear operation intent, original documents,
job lifecycle and results use each operation's independent retention owner.
Cancellation records are retained before abort; lost responses may be partial,
never an excuse to retry a remote write. Interrupted recovery never repeats
Git, Linear, installs, hooks or a model.

Acceptance uses generated fixtures for exact catalog objects and changed
revisions, note lifetime/retention/rollback and injection opt-in, actual hook
approval/denial/cancellation, command/no-replay and migration/restart behavior,
real CLI and native TUI interaction, hidden Electron and an installed packed
SDK consumer. Native double-fork/setsid coverage requires a fresh current
workload receipt, not a skipped test or the old protocol-40 image.

### Protocol-41 source qualification

The exact current no-cache Linux arm64 image builds in **34,642.89 ms**:
`sha256:7fdc6876dc2615f56baec381a0cf810f461edb3fb61292eb78c5744385d39d69`.
Worker and bridge SHA-256 are respectively
`53282a0f4bffa822ed74ae9d22e934a6625d3030581b9b377d0c300bb5036553`
and `3e614daedb6a9043303ed3b1ad733a487782f29bdff77e4ffdf205810b5518dc`.
Every receipt file hash was compared with the current source build before
native execution. Root-owned SendBox 0.2.3 CLI/key/manifest hashes match the
previous independently verified release pins; no installation was replaced.

All **8 actual native cases pass with no skips in 31.53 s**. The new real
double-fork fixture observes a living child with its own session/process group
and a parent different from its original middle process, then verifies that
the exact owned VM is absent after acknowledged stop. This takes **2,902.53 ms**
including qualification, with **zero inference calls**. It never identifies
or kills host processes from a reported PID. The same image also passes actual
SDK guest tools/Manual approvals, project-free scoped paste, requested model
stop, guest loss, real controller SIGKILL and late metering without replay.
Process containment is qualified at that VM boundary, not for native Local/SSH
or as successful source rollback.

Fresh types/production build and the installed packed root/React/Node/MCP
consumer pass, including actual installed tier expiry/promotion, disabled
catalog/hooks, real exact Git tag creation, unchanged source index/HEAD and
independent results after source deletion. Source and external-consumer audits
report zero vulnerabilities. Three hidden desktop platform workflows and the
new actual native TUI/CLI paths pass. Full-source regression evidence is
recorded separately in setup after its complete run.

Initial targeted checks caught a symbolic-HEAD test input that the exact-ref
contract correctly rejects, an absent optional revision in a Git admission
response, noncanonical macOS temporary-path expectations, missing original
session tags on parent cancellation events, option text contaminating select
labels, and a Linear remount discarding independent receipt reads after source
deletion. Inputs/assertions were corrected where appropriate; lifecycle scope,
accessible labels and mutable-review scope fencing were fixed without weakening
authority. The first packed consumer run found duplicate local variable names
in its new typed fixture; its lexical scope was corrected before the pass.
Existing npm deprecation/script-review notices, experimental OpenTUI FFI and
the lazy Ghostty bundle-size warning remain nonfatal.

The first complete sweep passed **1,041 of 1,044 cases in 899.09 s** and
failed three existing no-source-probe guards. The new physical-alias cache
busy check unnecessarily called the Local project resolver even with no
install lease, including during root-less owned-role recovery. The correction
uses only retained project/workspace path metadata and does no filesystem
resolution. All 26 affected candidate/owned-role SIGKILL/cache cases pass,
without weakening the original guards. A dedicated regression also covers
active physical aliases with a poisoned resolver. That failed sweep is not
reported as a full pass; the corrected source receives a complete rerun.
