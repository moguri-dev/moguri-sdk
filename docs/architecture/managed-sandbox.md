# App-managed Sandbox

This checkpoint replaces developer-facing setup and mandatory per-turn source
previews with a reviewed, app-managed native configuration. It does not weaken
the user-only Env policy, tool approvals, budgets or original guest ownership.
The local service remains the authority for desktop, TUI, CLI and SDK clients.

## Prerequisite measurements

The generated distribution spike uses the exact public SendBox 0.2.3 arm64
archive, freshly verified against SHA-256
`ab9508dffa9f3299621248d6cff8efb8fd84b44556f630b6e343329ab1eafb3e`
and its GitHub attestation. No personal model credential, inference, admin
dialog, real profile change or unrelated guest is involved.

| Primitive | Actual result before feature integration |
| --- | --- |
| Bundled user-owned CLI identity/version | PASS, exact release binary/manifest/key hashes |
| User-owned guest bundle | FAIL as required: released signed guest artifacts require UID/GID 0; no owner-check relaxation |
| OCI image export/import | PASS, 420,864,000-byte archive, 838.02 ms; exact original digest retained without removing any shared image |
| Bundled CLI with already reviewed root-owned guest | PASS, Linux Node 26.12.0, actual Node-PTY, non-root/NNP/seccomp/capability controls, signed after-state and exact VM absence, 1,138 ms |
| Versioned macOS component package | PASS, 16,381,455 bytes, root-owned BOM, no installation scripts; package creation/inspection only, not a privileged-install claim |
| Existing manual source capture with 201 files | FAIL as expected: the 200-file/2-MiB text-preview boundary cannot implement automatic project snapshots |
| Prepared Copilot endpoint under canonical API-only scope | FAIL before inference; `api.individual.githubcopilot.com` currently aliases `api.githubcopilot.com`, whose next alias is separately resolved |

The combined positive/expected-negative spike completes in **3,315.87 ms**.
Its earlier failures remain retained, including root-ownership refusal and an
ambiguous empty after-state; a unique generated witness makes signed after-state
binding verifiable rather than treating ambiguity as success.

`npm run spike` also ran the existing foundation: generated provider transport,
SQLite/event and UI/process/filesystem baselines pass. Its unavailable live
Copilot/ds4, Rust/Linux, notarization, configured decision/multi-model/SSH and
historical first-checkpoint gates remain failed, not relabeled as this native
qualification. No live login or unrelated roadmap capability is inferred.

```sh
node --import tsx scripts/managed-sandbox-spike.mjs \
  --workload /absolute/path/to/current/qualification.json \
  --archive /absolute/path/to/pinned/sendbox-0.2.3-macos-arm64.tar.gz \
  --installation /absolute/path/to/reviewed/root-owned/installation.json
```

## Distribution and installation

The macOS app carries a compatible immutable OCI worker archive, including
Moguri's compiled worker/bridge, Linux Node and locked native dependencies.
It also carries the pinned public SendBox 0.2.3 release and a no-script component
installer. A bounded distribution descriptor binds protocol, actual worker
bytes, OCI index/archive hashes, vendor archive, CLI/key/manifest and installer
hashes. Source/embedded runtimes can explicitly supply this same descriptor;
missing bundled artifacts are an explicit setup limitation, not a mutable pull.

The primary Settings flow shows these actual defaults and requires review and
approval, not JSON authoring, a developer build or a SHA command. A matching
explicitly configured root-owned installation can be reused after verification.
Fresh installation uses `/opt/moguri/sendbox/<version>` side by side and requests
the user's administrator approval. Existing Homebrew/other SendBox installations
are not overwritten. The service never types a password or approves OS dialogs.

Only a reviewed no-script package may reach the privileged installer. Copy it
to a new root-private exact operation directory, verify its reviewed digest there,
then invoke the system installer. Do not execute a user-writable Node/helper as
root. Reverify the actual installed CLI, signed guest manifest/artifact ownership,
key and exact version before activation. Missing or changed bytes, cancelled
authorization, lost completion and interrupted image import stay explicit;
original intent is retained and no installation is replayed on restart.

Public-release checks use only the fixed public SendBox repository, no Copilot,
CLI or private updater token. Automatic checks run at startup and every four
hours when enabled; manual checks use the same API. The selected runtime version
is never silently changed. New archive/asset hashes, signed guest release,
root/sequence and compatible current worker are reviewed before installation.
Keep previous version directories and active executions intact. A new version
or trust root is not authorized merely by its presence in a release feed.

## Automatic workspaces

One explicit managed-setup approval enables automatic private workspaces.
Existing manually pinned settings retain their original narrow semantics until
the user opts into managed operation. Advanced exact-path preparation remains
available but is not a prerequisite in the managed chat flow.

Before an owned turn's worker can launch, the service prepares or verifies its
Moguri-owned private stage. Project-free chats get an empty root-less stage.
Project sessions snapshot their actual bound Local project/worktree, never a
base-checkout fallback. Respect protected paths, nested ignore rules, symlinks
and folder policy. Use bounded regular-file metadata/copies rather than expanding
the reviewed text/context API or silently truncating a project. Large/binary
files do not become model context merely by being present in a private workspace.

Never mount the live source: SendBox rollback can replace the mounted directory.
Preserve original file digests/modes, private stage identity and independently
retained actual results. Reuse a valid private workspace across successful turns.
After rollback, preserve retained work and rebind only from verified original
snapshot evidence; unknown or incomplete work must stop rather than disappear.
Source publication remains a separate exact byte/base/policy-checked action.

Preparation belongs to the actual turn, not a fabricated user file-review.
Stop, profile/session removal and shutdown must abort it before worker admission.
Changing root, policy, settings, mode or ownership while copying cannot admit a
stale stage. Restart retains partial intent and holds queued prompts without
replaying copying, model calls or effects. No model budget is consumed by setup.

## Provider and tool networking

The screenshots' website prompts failed at provider admission, before either
website was contacted. Resolve the actual prepared provider HTTPS resource
before launching a managed guest. Do not assume every Copilot account uses
`api.githubcopilot.com`; configured hosted provider endpoints use their own
actual transport. Controller loopback endpoints are not guest endpoints.

Managed setup explicitly authorizes automatic selected-provider endpoints and
their bounded public DNS CNAME chains. Resolve only actual admitted provider
resources, never names supplied by model text. Reject malformed credentials,
wildcards, IP/private/metadata destinations, cycles and excessive chains; do not
override a deny policy. Capture the effective exact scope with its original
execution and recheck the provider before handing over any credential. A changed
endpoint/alias during a turn cannot launch another guest, replay a paid role or
silently broaden its already installed policy.

Default tool egress includes `github.com` and `api.github.com`; unrelated
`google.com` stays denied. Provider aliases are not a general wildcard or approval
for web/MCP/browser features without a qualified native transport. Show effective
provider hosts separately from manually configured tool destinations.

## Shared schema, ownership and verification

Use an additive protocol/database migration, versioned setup-operation records,
managed settings and captured network/preparation provenance. Preserve existing
events, encrypted grants, command receipts and manual configurations. Old
executions retain their original exact policy; settings changes never rewrite
their charges, destinations or signed guest. New blob references must receive
their owning encrypted retention grants in the same event transaction.

Reuse Node, maintained pi-ai, Node-PTY and TypeBox (MIT), existing ignore rules
(MIT), SendBox (Apache-2.0), system package tools and maintained node-tar
(BlueOak-1.0.0). Do not add another worker loop, VT renderer or custom TAR parser.
Cross-client tests cover migration/reopen, pre-admission cancellation/races,
stale/changed source and binary bounds, refused aliases/private addresses,
actual allowed GitHub/denied Google egress, wrong artifact/package identity,
cancelled/lost install, no replay, root-owned guest checks and packaged cold
setup with generated fixtures. Actual administrator interaction stays manual.
