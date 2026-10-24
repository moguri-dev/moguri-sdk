# SendBox 0.2.3 requalification

Issue #17 explicitly reopened native integration for released 0.2.3. These
measurements are about that release, not the historical 0.2.1 failures.
They qualify the stated generated primitives, not public Sandbox readiness
or completion of the first milestone.
The [protocol-40 source requalification](#protocol-40-source-requalification)
below adds the actual shared SDK/client lifecycle. Historical protocol-36/37
receipts remain scoped to their original payloads and are not relabeled.

## Desktop launch environment

Finder-launched apps may omit `/usr/local/bin` and `/opt/homebrew/bin` from
`PATH`, even when Apple's `container` CLI is installed. The macOS adapter
appends these standard installation directories for its host-side release,
image, policy, guest inventory, launch and cleanup processes. Existing explicit
`PATH` order is preserved; only `PATH` and `HOME` are inherited by these native
host operations, not other host credentials.

The same environment reaches SendBox's own subprocesses. This does not change
the guest environment, grant network access, relax exact release/image pins,
source a shell startup file or select a different provider. Missing binaries
and unsuccessful cleanup remain errors. The actual adapter regression runs
qualification and verified guest teardown with Finder's minimal system `PATH`;
without explicit current native receipts it remains skipped, not a native pass.

The isolated protocol-50 compatibility build passes that actual Finder-PATH
guest/cleanup case in **1,465.76 ms**, and encrypted IPC with denied model access
and retained rollback in **2,968.82 ms**, using existing image
`sha256:517fba3d59a3be64c04166dff9de038168580ce67315c4de538503636e3680b0`.
Its worker/bridge pins are unchanged. This is model-free host-launch evidence,
not fresh provider-network qualification or qualification of a later protocol.

## Protocol-51 bootstrap and private qualification

The protocol-50 image above is not compatible with a protocol-51 service.
Its configuration remains valid JSON and passes the settings schema; the old
guest's initial bridge packet was the source of the generic protocol-schema
error. Rebuilding requires new actual image and bridge/worker pins, not editing
a protocol number or relabeling the historical image.

Native bootstrap now validates only the initial packet's bounded structural
shape before capturing the original host-signed guest ownership. The immutable
image, exact managed stage, foreground command, captured time window, native
session ID, plan digest and public signer must still agree. An exact protocol
check then refuses an older or newer guest before initialization, transport keys,
provider credentials or model access. Shared bridge init/info/envelope schemas
remain exact-version schemas. A refusal retains both the version mismatch and
any ownership-verification failure; no matching name or PID is adopted.

New create-only private intents carry format/version, probe identity, original
configuration digest, launch name and captured time bounds. A separate
create-only bootstrap-owner receipt records the observed protocol and verified
signed owner. These records precede initialization and support honest exact
cleanup, not replay or fresh permission. Old private intents are not rewritten,
inferred from current inventory, automatically reconciled or erased. Unconfirmed
original cleanup remains unconfirmed even when a new independent probe succeeds.

Sandbox user consoles still have no qualified transport. Their optional build
metadata must not resolve a restricted guest UID's login shell or block core
native-agent qualification. Local/SSH console discovery checks actual helper
bytes first and uses the configured `SHELL` or actual account shell; an expected
OS account-lookup failure produces an explicit console-unavailable diagnostic,
never a guessed `/bin/sh` or Local fallback. Unexpected lookup errors propagate.

Provider catalogue connection failures are distinct from bootstrap/build errors.
Diagnostics identify the endpoint and a bounded proxy CONNECT status when
available, without copying raw exceptions, credentials or headers. Actual
provider HTTP responses remain responses, not proxy refusals. Caller-owned
cancellation keeps its original reason. DNS aliases need exact user review;
neither error handling nor qualification adds host grants.

This repair reuses Node/Node-PTY and existing TypeBox/protocol helpers (MIT),
and the existing SendBox adapter (Apache-2.0), without a new dependency, domain
event, durable database schema or migration. The private intent format is
additive for new operations only. CLI/TUI, desktop and SDK retain one shared
readiness/error authority; no client-specific readiness or provider fallback
was added. Generated bootstrap, shell, catalogue, actual-guest cleanup and
restart/cancellation cases cover these boundaries.

### Protocol-51 current payload and reviewed network scope

The fresh no-cache arm64 image builds in **32,867.98 ms** with Node 26.12.0
and protocol 51. Installation, signed bundle, public key, release sequence and
trust-root pins remain the 0.2.3 values recorded below.

| Workload field | Actual immutable value |
| --- | --- |
| Image | `docker.io/library/moguri-worker@sha256:078095a44e5e1ffc2bedb93b89774eb49d519cae9f140e49655a2beabdeb4f52` |
| Worker SHA-256 | `35540ae6a293cb99786b16280dd5770ee955b410e3f0100699d2cac74cc18065` |
| Bridge SHA-256 | `dda52fb76a14fd5c8514c9f376edbb137179261ecf0004c3d2257a415668d048` |
| MCP worker SHA-256 | `3964c359c92a081c8cc9a99b1ae5813cd4c17b9238c6ca0915503636186dc9ae` |

| Gate against the stated image | Outcome |
| --- | --- |
| Historical protocol-50 image refusal | PASS negative regression, **8,444.59 ms**; original signed owner captured, precise version error, exact guest absent |
| Actual guest/worker/process controls and cleanup with Finder's minimal PATH | PASS, **1,505.91 ms**; no model call |
| Encrypted IPC, denied model admission and retained failed after-state despite rollback | PASS, **3,079.87 ms** |
| Fresh API-only cold provider scope | **FAIL**, **1,569.23 ms**; explicit network diagnostic and proxy CONNECT 403, not a passing gate |
| Fresh API plus separately user-reviewed exact CNAME | PASS, **2,038.55 ms**; credential-free metadata reachability and verified owned VM absence |

The controller's single approved-host CNAME observation returned
`glb-db52c2cf8be544.github.com`. The user explicitly approved adding only that
hostname to the proposed configuration alongside `api.githubcopilot.com`.
The passing generated probe preserves the original 2 CPU, 4,096 MiB memory,
8,192 MiB disk and Copilot-enabled scope. Its configuration digest is
`73de94b9e849a5286f6517495b13376a5770306beefd9638dad8b1bf8b11680c`.
This is not a built-in alias grant, a wildcard, permission to allow a future
different alias, or evidence of authenticated inference/model availability.
There were no personal credentials, paid calls or saved Default-profile changes.
The original failed private probe remains intact.

The native SDK fixture also verifies the exact currently offered six-tool
inventory, including the existing `task_progress` advice tool, rather than
using the stale five-tool assertion from before explicit model plans. This
does not enable native MCP/subagents, broaden workspace permissions or treat
a plan as acceptance.

## Protocol-41 detached-descendant source qualification

The owner explicitly selected qualified SendBox for sessions requiring a
complete descendant boundary. Protocol-41 source adds a model-free actual VM
fixture that double-forks, creates a new session/process group, and observes
the surviving leaf reparented away from its original middle process before
requesting stop. No host PID is inferred from that guest observation.

The fresh no-cache arm64 workload builds in **34,642.89 ms** with immutable
digest `sha256:7fdc6876dc2615f56baec381a0cf810f461edb3fb61292eb78c5744385d39d69`.
Its worker/bridge hashes are
`53282a0f4bffa822ed74ae9d22e934a6625d3030581b9b377d0c300bb5036553`
and `3e614daedb6a9043303ed3b1ad733a487782f29bdff77e4ffdf205810b5518dc`.
Every current payload file matches the receipt before native execution.
Existing root-owned released host/key/manifest pins below were reverified;
the user's ordinary Homebrew installation and unrelated workloads were not
modified or adopted.

The double-fork/setsid/reparenting case passes in **2,902.53 ms**, with
acknowledged stop, verified absence of the exact owned VM and **zero inference
calls**. All eight current native adapter/SDK/tool/cancellation/guest-loss/
controller-SIGKILL cases pass without skips in **31.53 s** against that image.
Their generated model receipts are not live-provider or billed-usage evidence.
VM absence establishes descendant containment, not successful source rollback,
model quality, permission, or prompt-injection resistance.

```sh
MOGURI_NATIVE_INSTALLATION=.native/sendbox-0.2.3/installation.json \
MOGURI_NATIVE_WORKLOAD="$WORKLOAD_QUALIFICATION_JSON" \
node --import tsx --test --test-concurrency=1 \
  tests/sandbox-containment.test.ts tests/sandbox-runtime.test.ts \
  tests/sandbox-service.test.ts tests/sandbox-recovery.test.ts
```

Missing explicit receipts skip those cases and are not qualification.
Old protocol-40 images remain historical; native Local/SSH process groups
still do not offer this guarantee. The new global Sandbox-only requirement
blocks new unqualified turns without selecting an Env/model or relabeling
already-running Local work. See [platform workflows](platform-workflows.md)
for cross-client controls and independently retained Git-root inspection.

## Release and runtime identity

The macOS arm64 archive was downloaded from the
[published release](https://github.com/mbianchidev/sendbox/releases/tag/v0.2.3).
Its adjacent checksum, GitHub asset digest and `gh attestation verify` agree.
With explicit user approval it was staged side-by-side in a new root-owned
`/opt/sendbox-0.2.3-macos-arm64` directory. The ordinary installed 0.2.1 CLI
was not replaced. No other project's processes or installation were changed.

| Subject | Verified value |
| --- | --- |
| Host | macOS 26.6 arm64; Apple Containerization 0.10.0 |
| Host CLI / signed guest | 0.2.3 / 0.2.3, aarch64 |
| Signed release sequence / trust root | 7 / `external-release-root` |
| Host archive SHA-256 | `ab9508dffa9f3299621248d6cff8efb8fd84b44556f630b6e343329ab1eafb3e` |
| Installed CLI SHA-256 | `2c0a6f0d01930037dc5b7d34f85dd9a58583ef2f93ac92dbf2f503691eee5484` |
| Signed manifest SHA-256 | `4465bb324c4753ac621e82bd2ca30a7bb6e4e071c8521da4f10a1eb99b719030` |
| Public release-key SHA-256 | `998a6a606edb6afa7f8db6ea64949e39acfec30f70bbfdfc37c47391e5b85a88` |
| Workload Node / protocol | 26.12.0 / 36 |
| No-cache workload build | 30,028.26 ms |
| Immutable workload digest | `sha256:2a7522caca6deb828f44fe16576a12bb35fd042f5be0d5a77511c55411e9ab54` |
| Worker SHA-256 | `a8d4f226ce545321bb6ff97b7bd832fa51cc7c91a5cb18d90d75a69e3080ea17` |

`scripts/sendbox-worker-spike.mjs` now binds the actual CLI version and signed
manifest's expected host/guest versions before VM launch. An optional exact
`version` in the reviewed installation descriptor must match too. A descriptor
claiming 0.2.2 initially qualified these 0.2.3 bytes, exposing the missing check;
it now fails before guest creation. The correct-version run records actual
release identities in its receipt. Workload Node/protocol, non-root UID,
NoNewPrivs, seccomp, empty effective capabilities, threads and workspace I/O
are checked inside the actual guest.

## Generated results

| Gate | Outcome and measurement |
| --- | --- |
| Owned foreground worker, generated provider, exact read/write | PASS, 5,401.80 ms; 3 model calls and 2 tool calls through actual guest fork/IPC and PTY frames |
| Large approved image | PASS, 3,151,914 image bytes in a 4,202,798-byte start frame |
| Cold provider endpoint with only `api.githubcopilot.com` allowed | FAIL: proxy CONNECT 403 and guest DNS EREFUSED; no credential or inference request |
| Header-only DNS diagnosis | Upstream A/AAAA replies arrived with rcode 0; this is not evidence of an upstream DNS outage |
| Explicit observed alias plus endpoint | PASS; credential-free HTTPS metadata and the generated worker exchange, 12,210.64 ms |
| Same network path with exact release-version binding | PASS, 9,279.59 ms, host/guest 0.2.3 and protocol 36 recorded |
| In-flight model stop | PASS, 264.93 ms; acknowledged `stopped`, owned worker stopped and VM absent |
| In-flight command stop | PASS, 1,262.77 ms; acknowledged **partial**, not completed or effect-free stopped |
| Control-channel loss | PASS, 257.34 ms; acknowledged **partial**, not a successful turn or provider-completion proof |
| Private post-failure results and source staging | PASS in all stop cases; signed before/after/audit evidence, changed-base and replaced-binding rejection, original source edits preserved |
| Reviewed source publication | Not exercised: every receipt records publication `none` |

The alias was the exact observed `glb-db52c2cf8be544.github.com`, allowed only
alongside `api.githubcopilot.com` in that generated fixture. No wildcard,
private-address grant, deny-rule removal or user's profile-policy change was
used. This is conditional evidence for that exact captured destination set,
not permission to discover/allow arbitrary aliases or hardcode it into
production. A changed provider endpoint or alias needs its own exact review.
The endpoint-only failure remains a failed gate, not a retrospectively passing
run. Generated guests were verified absent after every pass and failure.

## Reproduction and remaining boundary

Reuse maintained pi-ai and Node/Node-PTY (MIT), and the existing SendBox
(Apache-2.0) CLI adapter primitive. No new dependency or second agent loop was
added.

```bash
npm run build
npm run spike:worker-image
node --import tsx scripts/sendbox-worker-spike.mjs \
  --candidate .native/sendbox-0.2.3/installation.json \
  --workload "$WORKLOAD_QUALIFICATION_JSON" --turn
```

Use the actual emitted image qualification receipt, not a mutable tag or an
older protocol's image. Add `--network` to reproduce the endpoint-only cold
gate; `--network --observe-dns` captures generated DNS headers only. An
explicit `--copilot-cname EXACT_OBSERVED_HOST` tests one reviewed alias.
`--turn --stop model|command|control` tests offline cancellation and retention.
The installation descriptor binds canonical root-owned executable/key/bundle
paths, SHA-256 identities, trust root, minimum sequence and `version: "0.2.3"`.
Failed private diagnostics remain under ignored `.native/qualification/`.

At that protocol-36 primitive checkpoint, public Sandbox stayed unavailable.
Those probes did not implement or qualify
the SDK/controller-owned Sandbox lifecycle, complete ledger and permission
integration, real provider completion/late usage, actual controller SIGKILL
and guest-loss recovery, authenticated reconnect/no replay, or reviewed
publication back to source. They never use personal login state, real model
credentials, paid inference, a live source-checkout mount or a Local retry.
An SSH or Local result cannot be relabeled as a Sandbox pass.

## Protocol-37 SDK lifecycle source work

The later native adapter now extends those primitives through the actual
SDK/controller rather than claiming the original probe did so. Its generated
protocol-37 workload uses immutable image
`sha256:58c38dfb294aecbdf839a40b642108e785f04595cbfc045ababd018ccbc41a10`;
the no-cache build takes **32,646.05 ms**, with locked audited dependencies.
Installed release paths/hashes above remain unchanged.

The actual adapter verifies Linux/Node/worker/bridge/process controls and
signed plan/image/workspace/argv identity before provider access. The current
six-case sequence passes in **19.59 s**, including real service SIGKILL.
That loss produces signed `runtime_execution_failed`, failed finalization and
successful rollback, without a reported runtime exit. The reader keeps that
exit null; it never invents 0, 130 or a completed turn. Original encrypted
model-completion frames reconcile one 42-token generated receipt exactly once,
without adding completed model context or dispatching another request.

The ordinary SDK gate includes actual guest read/write tools, two Manual
approvals and three independently metered generated model calls. Native
changes leave the Local source untouched until a separate exact-user
publication, which preserves staged index bytes, HEAD and unrelated edits.
Project-free 51-line-plus pastes are read through the bounded encrypted
controller broker, not copied into the VM or uploaded wholesale.
Cancellation retains unknown model capacity and verified VM absence; a
rolled-back stage is refused before consuming the next draft.

These are actual native execution with generated provider responses, not live
provider completion, public compound/Max/wind-down or full client qualification.
Production readiness still requires the explicit pinned configuration and a
passing fresh provider-network scope. No user settings, alias grants, ordinary
0.2.1 installation or previous archive was replaced.

The subsequent client checkpoint qualifies actual TUI keys (**3.97 s**) and
hidden desktop setup/source review/guest tools/separate publication (**6.5 s**).
The desktop's default retained-data case cannot enable Sandbox; explicit saved
artifact/network review and actual verification still gate Env selection.
Actual guest termination during a model request (**3.42 s**) verifies native
absence and retains a partial outcome plus unknown paid capacity. Signed
runtime exit and CLI exit remain distinct, including an unreported runtime
failure. Source publication also survives actual controller SIGKILL before
copying or after one file, without replay when its original receipt is lost.

The refreshed client-checkpoint workload is
`sha256:b03ab376659754d5332cbab352ab3637bb8f6be9e7fc5ae1895a5be183c5e067`
from a **33,354.47 ms** no-cache audited build. Its actual worker and bridge
digests are respectively
`4af80251d09028eeb740d2dc4075cc77c0f24d32179e8c6b0e92163e5809607a`
and `80cc23d91fc4a04bd3c7a48b0edef66e3f643c2466fa8d37ad2570ce35125f0d`.
The full committed checkpoint passes 874 local checks, 58 hidden desktop cases
and packed-consumer verification. The older generated image remains an earlier
receipt, not silently relabeled as this payload.

## Protocol-40 source requalification

The final source worker is rebuilt from locked dependencies with the existing
`container build --no-cache` path. The build passes in **30,194.94 ms** with
zero audit findings. Rebuilding after the retained-effect correction verifies
every package/lock/worker/bridge/MCP payload hash unchanged against this exact
receipt. No prior image, installation, qualified archive or release is replaced.

| Subject | Exact current value |
| --- | --- |
| Workload Node / protocol | 26.12.0 / 40 |
| Immutable image | `docker.io/library/moguri-worker@sha256:6ee97e0ce2d8d318f5aa6aea5243d55dfbe5dad9d7d053e304b38d7d6440dafd` |
| Worker SHA-256 | `c8db9b6b13f48259cbce5600836a19acee56ae3efd348f82eeaae3321caf2fef` |
| Bridge SHA-256 | `88f10720a39c112fc4e58128f110360857caa04b98848660313e744faeed45d3` |
| MCP worker SHA-256 | `b79ffd866ccfc41259888085aed2e4396a5ddafd34d9d1106af5d29a7cec6bd4` |
| Host/guest release and trust | Unchanged 0.2.3, sequence 7 and `external-release-root` above |

Seven actual native test bodies pass in a combined **21.34 s**:

| Actual gate | Time |
| --- | --- |
| Pinned artifacts, real guest controls and verified exact owned VM absence | 1,449.25 ms |
| Encrypted real worker IPC, withheld access and signed failed after-state despite rollback | 2,930.60 ms |
| Shared SDK source review, guest model/read/write, Manual approvals, ledger and separate source publication | 3,916.43 ms |
| Project-free scoped long-paste paging through the authenticated controller broker | 3,256.79 ms |
| In-flight model cancellation, held unknown metering and replaced/rolled-back stage refusal | 3,215.08 ms |
| Actual guest loss, partial result and distinct CLI versus runtime exit | 3,168.75 ms |
| Actual controller SIGKILL and original late metering without another VM/model/context replay | 3,399.09 ms |

The same image passes the actual hidden desktop setup/private source review,
guest tools and separately accepted output publication in **6.2 s**.
All **64 hidden Electron workflows pass in 2.5 min**, including default
unready configuration, long-paste context, real SSH/PTYs, compound reviews,
reserved wind-down and Local Max. The actual packed external SDK install,
entrypoints, Node runtime/worker and CLI/shared decisions also pass with zero
consumer audit findings.

These are real native controls with generated provider responses, not live
Copilot/Jev entitlement, independent training, calibrated quality or billed
usage. Actual model output never approves staging/source/Git. Native
compound/Max/wind-down, consoles, MCP/memory, subagents/evolution and direct plan
write transports remain unqualified, never mapped to Local. Detached/reparented
Local/SSH process containment remains unproven; verified native VM absence is
a separate, narrower cleanup observation.

The previously failed endpoint-only cold-network gate stays failed.
No alias, broad egress, private-address allowance, personal credential,
user profile-policy change or controller model fallback was introduced.
Real provider use still requires its separately reviewed exact network scope.
This is source acceptance evidence, not a new app/SDK archive, release tag or
completed first milestone.
