# Remote GitHub repository metadata

## Prerequisite and intended boundary

Reuse Node 26 (MIT), OpenSSH (BSD), the existing owned bounded program/framer,
TypeBox (MIT), GitHub CLI (MIT) and pinned `spdx-license-list` data (CC0-1.0). No new
dependency, provider/model call, personal authentication or credential transfer
is needed. The existing generated SSH spike passes in **141.53 ms**.
Sandbox stays paused.

The private prerequisite runs one exact read-only
`gh api --hostname github.com --method GET repos/OWNER/REPO` on the selected
SSH host. A separate generated HOME/PATH/account, exact cwd/argv witness and
TERM-resistant owned process make origin, response limits and control-loss
cleanup measurable. Only validated repository identity/owner/visibility/SPDX
fields cross back. Raw CLI stderr, unrelated response fields and credentials
never enter frames, events or jobs. Missing tools/accounts fail explicitly,
without another account or public lookup.
The initial cancellation fixture incorrectly used an asynchronous predicate
with the existing synchronous `waitFor` helper, which could inspect the
previous already-exited PID. It now waits for the actual hold-ready marker,
matches that PID to the fifth CLI attempt, proves it survives TERM and only
then loses the owned SSH client. The initial run is not cancellation evidence.
The corrected generated SSH/account/whitelist/control-loss prerequisite
passes in **3,253.37 ms**. The combined eight primitive/Git checks pass in
**3,536.74 ms**, with both type checks passing. The public SDK tests first
fail at the intended existing `repository_remote_auth` guard, not a fixture
or provider failure.

The development public slice now adds protocol-26 read/response validation,
immutable peer/root/build provenance in the existing repository observation,
a schema-25-preserving marker migration and the existing user-reviewed,
event-first refresh job. Listing/reviewing scope does not call
GitHub. Only explicit refresh may use the execution host's existing account.
Public lookup remains explicitly credential-free from the control plane;
Local authenticated lookup remains Local.

The SDK, shared `/repository`, actual TUI and desktop must identify the same
lookup boundary. An SSH disconnect or cancelled frontend is not proof that
the Remote process stopped. Missing cancellation/cleanup acknowledgement
remains partial, not a successful or falsely confirmed cancelled read. Changed
env/peer/root/configuration, stopped/deleted source, lost receipts and service
restart cannot retain a stale observation or replay an original job.
Existing historical attribution is not backfilled, refunded or rewritten.

Before delivery, cover malformed/mismatched/oversized/private responses,
account isolation, cancellation and connection loss, held source changes,
cross-profile ownership, migrations/rollback and real restart. Preserve all
Local/public repository and fixed/routed model provenance gates, then qualify
the exact installed SDK and actual packaged clients separately.

## Public implementation and current evidence

`repo.githubAccess: "gh-cli"` follows the explicitly selected session env.
`RepositoryPreview.lookupBoundary: "remote-gh-cli"` names the captured SSH
host's account, not the control-plane account. Preview and retained observation
include the original host/port/login/key fingerprint/root/worker digest.
Legacy Local/public observations remain valid without this optional metadata;
a Remote authenticated observation without its peer proof is rejected.
Migration 26 adds `remote_repository_schema` without rewriting old ciphertext,
keys, original command receipts or Local/Remote console identity.

The existing pinned bridge runs one strict repository-only query, with an
8-second program deadline and 2-MiB combined stdout/stderr ceiling, below the
outer query bound. It does not accept arbitrary endpoints, shell strings,
headers or credentials. The execution host validates and whitelists the
response before transfer; the controller validates it again against its current
Git binding before retention. A lost/aborted query leaves remote cleanup
unconfirmed and the job partial. No reconnect or program retry occurs.

SDK/CLI/shared `/repository` expose the same DTOs. Desktop shows captured
account/key before refresh and original observation host/root afterward.
Project settings disclose that linked-PR observation and client attachments
still use their existing control-plane boundary; they are not silently moved.
Tests deny a controller `gh` executable as well as public fetch, and use a
separate generated SSH HOME/PATH, so regressions cannot read personal accounts.

The initial backend gate passes **19/19 in 16,102.54 ms**, including
existing repository/model/retention contracts and generated Remote failure
paths. The expanded crash/migration gate initially had one fixture setup
failure because its Git helper requires `fixture.txt`; the missing generated
file is now created before initialization. The corrected two migration/actual
service-SIGKILL cases pass in **7,465.79 ms**. Interrupted and completed
operations retain their original receipts/facts without another CLI call.
Both actual TUI repository flows pass in **4,039.20 ms**. Five hidden desktop
Remote/telemetry workflows pass in **12.8 s**, including stale-env rejection.
Both type checks and the complete build pass. These are source results, not
qualification of an uninstalled 0.20 archive. The qualified 0.19 delivery
remains frozen; Sandbox and Remote repository memory remain unavailable.

The complete corrected source gate passes **558/558 in 394.59 s** and all
**39 hidden source desktop workflows in 1.4 min**. Source audit reports zero
vulnerabilities. The new compiled console broker and bridge are byte-identical
to qualified 0.19, preserving that independent version-1 ownership wire while
the agent bridge/database move to protocol 26. This byte comparison is not a
claim that arbitrary future helper builds are interchangeable.
