# SendBox 0.2.3 requalification

Issue #17 explicitly reopened native integration for released 0.2.3. These
measurements are about that release, not the historical 0.2.1 failures.
They qualify the stated generated primitives, not public Sandbox readiness
or completion of the first milestone.

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

Public Sandbox stays unavailable. These probes do not implement or qualify
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
