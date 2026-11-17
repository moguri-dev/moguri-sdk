# Repository trust, isolated tasks and recoverable output

## Authority and reuse

These are Moguri product defaults, not instructions only for an external coding
agent. Reuse Node 26 filesystem/crypto primitives, TypeBox, React and the
existing SDK/event store (MIT), `shell-quote` (MIT), and system Git
(GPL-2.0 executable). No dependency or hidden model call is required.

Repository trust is an explicit actual-user decision about an exact existing
repository snapshot. It is not model advice, a permission grant, OS isolation
or a malware guarantee. A model, script, plugin, settings suggestion or Git
commit cannot enlarge its own trust baseline. New or changed scripts,
generated helpers, downloads and changed dependency inputs remain outside it.
Third-party package/lifecycle code does not become trusted repository code.
Hard tool/command denials, folder restrictions, read-only mode, environment
policy and managed-install isolation remain authoritative.

Trust binds the profile/project, actual repository identity, reviewed version
and exact source digests. Execution rechecks the actual session/worktree and
current bytes. Revocation, stale review, directory replacement, source drift,
dependency drift and persistence failure fail explicitly, without choosing
another checkout or recording an execution that did not start.

`repository.trust_recorded` retains the exact actual-user baseline/revision and
revocation in the project compartment. `repository.script_reserved` retains
each original turn/step/call, root, source and input digest before effects.
The step comes from the actual active solver or original pending approval,
never whichever auxiliary model happened to start most recently.
Both baseline and original executed source digests enter encrypted retention
references in that event transaction; a process-local blob alone is not
authority. Session deletion removes its attempts, not the independent project
baseline. A different profile cannot adopt the same physical repository's trust.

The preview includes eligible existing regular tracked scripts, exact Local
and Git-common directory identities, HEAD, exclusions and dependency inputs.
No more than 20,000 tracked paths, 64 MiB total script source, 512 KiB per
complete UTF-8 entrypoint or 2 MiB metadata are accepted. Limits fail explicitly,
not with a trusted prefix. Private/package-owned paths and symlinks are
excluded. The latest exact retained unsafe assessment remains outside trust
and requires its own separate force, even if it appeared after baseline
approval. No model provenance or safe review is fabricated.

Trusted calls use `run_script` with path/interpreter/args; the service supplies
the private trust authority after live validation. The reviewed variant keeps
its original model review and one-attempt rules. Both reuse private-FD source
execution, root sentinels, normal approvals and known-group cleanup. Supported
Node TypeScript entrypoints use Node's explicit stripping format, not a new
downloaded runtime. This does not claim arbitrary transitive import,
package-manager or child-process confinement.

## Worktree and pull-request defaults

New Local Git project tasks use the existing managed-worktree intent/job/root
machinery. The original checkout, index, uncommitted changes and branch remain
untouched. No model or writer starts against a creating or partial workspace.
Creation is retained before effects; failed/cancelled/restarted work is not
replayed, force-deleted or silently rebound to the original repository.
Existing conversations and explicit compatible workspace choices are not moved.
Non-Git folders and unqualified transports must describe their real boundary,
not claim a Git worktree or fall back from a protected environment.

`workspaceOrigin` records default versus explicit worktree/checkout choices,
without retroactively relabelling legacy folders. Source-bound preparation
permits draft/control changes and ordinary queue intake, never inference or
console effects against the unready root. New automatic worktrees are qualified
for one Local Git project only. New Local groups with Git members require that
each member explicitly opts into attached checkout; otherwise they fail clearly,
without adding the deferred multi-repository orchestrator.

For repository code changes, the default completion target is a draft PR unless
the actual user opts out or the task clearly makes no repository changes.
First-party workflow guidance is included before capture, context sizing and
budget admission. It never rewrites saved system prompts or grants push,
authentication, rebase or merge permission. Existing source-bound PRs are reused
without duplicate or implicitly stacked publication. Missing permissions,
credentials or transport qualification are reported, not called completion.

## Screenshots and installers

Two more project preferences shape the agent's guidance in the same
repository-workflow block. Both are guidance, not permissions: commands still
need their normal approvals, and hard denials and budgets stay authoritative.

- `repo.screenshots` (default `ui-changes`): when a change affects anything a
  person sees, the agent captures each affected screen after the change, and
  before it when practical, with `take_screenshot` (Browser pane) or the
  `playwright` tool, and includes the images in its final response. `off`
  limits screenshots to explicit requests.
- `repo.installers` (`build` or `skip`; unset means Moguri still asks) and
  `repo.installerCommand`: with `build`, the agent runs that command once as the
  final step of a task that changed the repository, after checks pass, and
  reports the generated installer's path or the failed build. Otherwise it
  doesn't build installers unless asked.

`project.installers` is a read-only query that lists commands in the project's
root `package.json` scripts and `Makefile` targets that look like installer
builds (electron-builder, electron-forge make, Tauri, `hdiutil`, `create-dmg`,
`pkgbuild`, MSI/AppImage tooling, or names such as `package:mac` and `dmg`),
using the project's package runner. It never follows a linked manifest or runs
anything. While `repo.installers` is unset and a candidate exists, the desktop
asks once in a finished session of that project: **Build at the end** saves
`build` with the chosen command, **Don't build** saves `skip`, and **Not now**
hides the card for that session only. Project settings shows and changes the
same values. Protocol 109 lineage rejects these fields in older history.

## Partial results

An original tool result remains failed/partial even if the agent can continue.
A qualified native executor may report confirmed known-process cleanup for a
clipped or otherwise partial observation. That permits ordinary subsequent
reasoning/tools under unchanged policy, not replay of the original operation.
Untrusted tool text or MCP annotations cannot provide this internal proof.

Genuinely uncertain effects or cleanup retain their owner, accounting and
quarantine. The solver may inspect results and ask questions in an enforced
read-only recovery boundary instead of ending merely because one tool returned
partial. Further writes remain fenced until real inspection/settlement.
Cancellation still stops owned work; incomplete acknowledgement, exhausted
budgets, unknown model accounting and actual control loss remain hard gates.

Project-free Home writer quarantine is broader than known-process cleanup:
that original uncertainty still enters read-only recovery even when the
specific native process group stopped. The control-plane acknowledgement
informs the worker of recovery, and authoritative final settlement cannot
upgrade that unfinished recovery to completed/successfully cancelled.

## Inbox

Search and type/read-state filters select authoritative notifications without
acknowledging, answering, approving or deleting them. Search uses only the
notification's actual session and original referenced public source. Legacy
missing provenance remains unavailable rather than becoming the latest message
from an unrelated turn. Filter state is presentation-only and resets across
profiles; SDK, desktop and terminal clients share the same selection helpers.

## Generated prerequisites, 2026-11-10

Before feature integration, the repeated macOS arm64 foundation checks passed:
provider streaming 1,095.55 ms, cancellation 31.60 ms; 1,000-event WAL append
p95 0.061 ms, rebuild 0.480 ms; nested PTY cancellation 151.87 ms with zero known
survivors; OpenTUI 16.86 ms/update; hidden Electron cold start 170.73 ms,
444.94 MiB and 8.27 ms scroll frame; 2,000-file search 0.953 ms and Git status
5.73 ms. The isolated Git-worktree primitive passed in 79.30 ms, including
locked/dirty removal refusal and preserved checkout/index/branch.

The spike separately reports missing live-provider, Rust/Linux, signed release,
physical SendBox, external SSH and live decision qualifications. Historical
initial-checkpoint unsupported-feature messages are not a current platform
inventory or permission to bypass its later qualified gates.

Durable additions require a numbered atomic migration and unchanged ciphertext,
receipts, drafts, roots and accounting. Acceptance includes real worktree writes,
base preservation, trust/revocation/drift, concurrent clients, failed persistence,
partial-result continuation, cancellation/restart/no replay, actual filtered
Inbox interaction and an independently packed SDK consumer.

## Follow-up verification and remaining gates

The final type checks and production build passed. The affected source
selection passed 292 checks with one existing native-TUI qualification skip.
After binding trust to the exact original solver/approval step, all 26 focused
trust, file-recovery and migration checks passed again. The affected hidden
Electron selection passed all 46 checks, including real factory worktree
creation/console ownership, keyboard trust/revocation, Inbox filters, existing
script approvals, startup, settings and inline/fenced copy behavior.

The independently installed packed SDK passed browser-safe imports/types,
actual runtime/worker/CLI/shared-TUI behavior, trust/revocation, default-worktree
and notification-filter APIs, original-owner restart, generated SSH and all 12
acknowledged-role probes. Root and independently installed dependency audits
reported zero vulnerabilities. Existing Vite chunk-size, experimental FFI and
upstream package-deprecation warnings remain.

No tests were removed. The partial-file regression now requires a metered
read-only recovery step instead of the intentionally removed blanket stop:
one original write remains partial, no write is replayed, quarantine persists
and all three generated model calls/126 reported tokens are counted. Git/PR/
candidate qualifiers that specifically examine an original checkout now choose
it explicitly; genuine legacy-root fixtures generate original events before
effects rather than stripping current worktree intent.

The exhaustive Node/Local-SSH matrix and complete Electron suite from the
earlier desktop cut were not rerun for this follow-up. Their original scope
and the corrected denial-label failures remain recorded in
[content review](content-review.md); targeted results are not a claim that the
whole suite was rerun. Main-only CI is unchanged. Generated checks do not
qualify physical SendBox, external Linux, signed/notarized distribution, live
provider entitlement or unqualified automatic multi-repository worktrees.
