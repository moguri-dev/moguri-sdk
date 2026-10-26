# Session approvals and GitHub workflow entry points

## Change contract

This slice reuses Node.js (MIT), TypeBox (MIT), React/OpenTUI (MIT), Git
(GPL-2.0), the GitHub CLI (MIT), and Moguri's SDK, event store, scoped secret
backends and existing reviewed GitHub operation lifecycle. No new dependency,
provider framework, shell parser or credential-sharing mechanism is needed.

macOS Local service startup uses a Node-only executable-path helper. It
preserves inherited precedence and appends
only missing standard Homebrew locations, reusing the native-host path list.
Owned programs inherit that Local service environment. Generic process launch,
direct in-process SDK runtimes and Remote peer PATH remain unchanged, so missing
tools on a selected SSH host cannot acquire another executable.
Explicit program environments and absolute executable selections remain exact;
there is no shell-profile execution, executable scan, alternate account,
credential forwarding or automatic CLI installation. Other platforms retain
their original lookup. This launch correction adds no dependency, event,
durable schema or protocol and leaves service restart ownership and Remote
credential boundaries unchanged. Generated service-startup, exact-selection,
explicit-exclusion and cancellation tests cover the behavior.

The Finder-launch follow-up passes type checks and the production build,
**118 related service/process/GitHub/SSH checks with three unqualified native
skips**, **13 hidden desktop flows**, and the independently installed SDK with
all **12 worker continuation probes**. Root and external-consumer audits remain
clean. Missing CLI tools on an SSH peer still produce the original unavailable
error rather than discovering a different executable. A Local version-only
probe confirms the installed Homebrew `gh` starts with the corrected startup
environment, without authentication or a GitHub request. The actual packaged
Node, SDK and matching compiled runtime also pass a generated minimal-PATH
service launch while preserving bundle provenance and environment isolation.
These are focused
follow-up results, not a new full-suite run or personal-account qualification.

Remembered approvals are actual-user settings, scoped to one session, one
project or every project in the current profile. Exact commands, conservative
command families and exact schema/configuration-bound MCP tools are separate
targets. Approval and its remembered setting must be retained atomically.
Models, plugins, command output and structured answers cannot create grants.
Hard denials, read-only modes, environment restrictions, root ownership and
budget limits remain authoritative.

Selecting Autopilot explicitly delegates tool approvals for subsequent turns.
Autopilot Max has the same automatic tool permission behavior and adds the
existing bounded, metered System One-compatible decision layer. It does not
turn a technical recommendation into a user answer, enable an unqualified
decision transport or silently substitute another model.

GitHub repository discovery is an explicit authenticated controller-side read,
independent of Copilot login and the private updater PAT. Repository pickers
prioritize the signed-in user's and organizations' repositories. Public search
is a separate explicit source. Pagination, exact account identity and failure
remain visible. Importing never authenticates, overwrites an existing
destination or executes repository hooks.

Project-specific PR/issue pickers and detail views reuse bounded typed reads.
Writes keep the existing exact preview, explicit confirmation, durable
pre-dispatch intent, independently retained result and no-replay behavior.
Starting from a GitHub item retains its explicit source and draft without
starting inference or changing the checkout. Desktop and TUI consume the same
SDK capabilities.

Protocol/schema 61 preserves existing events and settings. Older grants
are not inferred, and old autonomy selections are not silently upgraded into
broader permission. New automatic approvals require the retained
`controls.automaticApprovals` marker and record an `autonomy` actor.
The service supplies the solver's actual automatic-approval guidance before
prompt capture, context sizing and budget admission, without modifying saved
system prompts or adding unsized worker-only context.
`Session.githubSource` retains the original canonical item/account/digest;
relinking clears its current attribution, not its original event.
The source digest also binds profile/project/workspace, canonical root device
and inode, configuration and hard-policy epochs. Replacing a checkout at the
same path cannot reuse its old review. Publication editors survive destination
or policy changes and require explicit destination reload before another
preview; no input is silently discarded or copied into a different root.

After actual owned work quiesces, ordinary service shutdown also closes its
own HTTP connections. An incomplete client body cannot keep a closed window's
service registry/lock alive. Closing transport is not command success, cleanup
proof or permission to replay an unacknowledged write.

Adding a grant alongside its exact actual-user answer advances settings CAS
but does not revoke the unchanged active solver policy. Revocation and ordinary
permission edits still advance the permission epoch and invalidate pending
authority. Remote MCP keeps a digest of every non-remembered setting plus the
actual permission epoch, peer, resource, root, helper and project/mode policy.
Only the additive grant's settings-CAS increment is excluded from that
transport digest. Legacy intents without this optional digest retain their
original revision-bound verification. Remembered Remote tools bind the actual
underlying tool schema, not an ephemeral catalogue wrapper, and still require
fresh scoped discovery after restart. No access-forwarding grant is created.

Schema 61 retains the main-line workspace-experience schema 59 and reviewed
session-navigation schema 60. The exact earlier approval-development schema
59 is recognized only by its distinct retained workflow marker and absence
of main-line/future markers; it atomically adds both main-line markers and
the new convergence marker. Ambiguous/corrupt lineage is never repaired or
inferred from a version number. No ciphertext or existing consent is rewritten.

## Prerequisite measurements

Before implementation, `npm run spike` passed all six available generated
groups on macOS arm64: provider cancellation 31.68 ms; SQLite append p95
0.058 ms and rebuild 0.516 ms; owned PTY cancellation 151.32 ms with zero
survivors; TUI updates 17.29 ms; hidden Electron startup 201.14 ms, 445.23 MiB
and 12.09 ms per frame; 2,000-file search/Git 0.935/5.867 ms.

After integrating the main-line workspace/navigation changes and before the
protocol-61 convergence, all six prerequisite groups passed again: provider
cancellation 32.61 ms; SQLite append p95 0.065 ms and rebuild 0.499 ms; owned
PTY cancellation 152.84 ms with zero survivors; TUI updates 17.88 ms; hidden
Electron startup 171.71 ms, 446.27 MiB and 8.04 ms per frame; 2,000-file
search/Git 0.867/5.950 ms. The same separately listed live/native gates remain
unqualified.

Before integrating remembered Remote MCP approvals, the generated
`npm run spike:remote` passed in 141.29 ms with one actual loopback SSH-worker
inference request, a pinned host identity and no personal account. SSH is not
SendBox containment or external Linux-host qualification.

Live inference, Rust/Linux supervision, notarization, physical native
SendBox, multi-model quality, live Jev, personal SSH and the original wider
milestone gates remain unqualified. The generated probe does not establish
those capabilities. Dependency restoration and audit reported no advisories.

## Required evidence

Generated tests cover automatic approvals and hard denials, conservative
family matching, scope/profile/configuration isolation, concurrent and stale
answers, revocation, cancellation and restart persistence. GitHub tests cover
identity changes, credential-free repository ordering/pagination, exact
project item ownership, original write receipts and source-bound session
creation. Hidden Electron checks exercise repository/item dropdowns, retained
approvals, PR/issue details and creation. SDK packaging verifies browser-safe
entry points and an independently installed consumer.

## Integrated qualification

Runtime, SDK and native-client source is `9a1054e`, including main's workspace
and navigation changes. The generated private-CLI fixture correction is
`babe876`; the desktop fixture now exercises Max's actual technical-answer
layer in `7c291c2`, not the intentionally removed new-mode tool-review gate.
No production source changed during these final runs.

| Check | Result |
| --- | --- |
| Type checks and production build | PASS |
| Complete Node/service/worker/CLI/native-TUI suite | 1,482 passed, 14 platform/native skips, zero failures; 1,496 total / 1,161,821.57 ms |
| Complete hidden Electron suite | 196 passed, three packaged/physical-native skips, zero failures; 199 total / 6.2 minutes |
| Independently packed external SDK | All entrypoints/declarations, approved installation, runtime/client flows and all 12 installed-worker continuation probes pass |
| Root and independently installed consumer audits | Zero vulnerabilities |

Coverage includes exact account/root replacement rejection, real GitHub
publication receipts using generated responses, concurrent approval answers,
Local/SSH MCP grants and revocation, uninterrupted routed-solver continuation,
actual service restart, both schema-59 lineages, interrupted migration rollback,
preserved publication edits and quiesced HTTP shutdown. Tests use generated
data, owned loopback servers and hidden windows, never personal authorization,
real GitHub mutations, a personal terminal or paid model access.

Known non-blocking notices remain: experimental OpenTUI FFI, the lazy Ghostty
bundle-size warning, and deprecated transitive `whatwg-encoding` and
`node-domexception` packages in the packed consumer. The install-script notice
is followed by explicit archive approval and rebuild; no unapproved lifecycle
script runs. These results do not qualify dedicated Jev, Remote/native Max,
external Linux hosts, physical SendBox containment or notarized release
artifacts. CI remains main-push-only; no PR or working-branch trigger was added.
