# Canonical native file access

## Authority and change contract

The service's existing tool policy, selected root, mode, writer leases and
native file guard remain authoritative. This security repair reuses Node's
path/filesystem primitives and the existing folder-policy matcher. No library,
dependency, capability API, event, durable field, permission grant or migration
is added. Saved rules and original tool arguments are not rewritten.
Protocol 82 history remains genuine; a matching protocol number does not
requalify changed worker or SSH bridge bytes.
The combined follow-up's new content-review state and current exact-byte
evidence belong to [protocol 83](content-review.md), not this repair's
historical protocol-82 measurements.

Tool requests and configured path prefixes normalize before matching. Requests
resolve relative to the exact selected root, including internal `..` and
root-reentry spellings. Outside paths and absolute aliases of another root fail
closed rather than acquiring native or automatic approval. Use relative paths
or the actual canonical absolute root, not a symlink/case alias of that root.
Prefix boundaries remain literal: denying `restricted` does not deny
`restricted-sibling`.

Denials and required reviews reuse the existing conservative macOS folder
comparison, including case folding and canonical Unicode normalization.
This intentionally remains restrictive on case-sensitive macOS volumes too.
Explicit allow rules do not acquire broader grants through case folding.
Other hosts keep their existing case-sensitive folder comparison. Controller
matching performs no filesystem lookup on behalf of Remote or Sandbox.

Native resolution checks the lexical and resolved root boundaries, every
parent component for symlinks, protected parent names and the final resolved
filename. Credential, control-state and Git metadata names remain protected
in every case on every host, consistent with the existing case-insensitive
search exclusions. Accepted macOS case/Unicode aliases return the actual
canonical file identity in source references, not a second invented source.
Missing destinations retain existing explicit create/CAS checks. A rejected
path cannot create a temporary write or change its target.

The same helpers serve native tools, context reads and Local/SSH workspace
views. SDK, CLI/TUI and desktop keep one service policy; no client-only filter
can authorize access. Manual, Guided, explicit Autonomous and read-only sessions
cannot bypass hard denials or protected paths. Cancellation, base-digest CAS,
truthful partial publication and restart retention keep their existing
mechanisms. This is not OS containment, protection from an already-authorized
arbitrary shell, a malicious host administrator or proof against every
concurrent filesystem mutation.

An already running service must be explicitly restarted to load repaired code.
Quit/reopen the matching app, or use the reviewed `moguri service restart`
flow; do not delete stored state. Original authenticated user terminals and
unknown accounting retain their established restart semantics. SSH and
Sandbox payloads need their own exact rebuilt digests and qualification;
neither an old receipt nor protocol 82 alone proves this repair is installed.

## OWASP source and review boundary

The requested references are the
[OWASP Agentic Skills Top 10 website](https://owasp.github.io/www-project-agentic-skills-top-10/)
and [repository](https://github.com/OWASP/www-project-agentic-skills-top-10),
observed on 2026-10-30 at
[`d6f7d7d0de314f52a83a85d1828e06ab096e595c`](https://github.com/OWASP/www-project-agentic-skills-top-10/commit/d6f7d7d0de314f52a83a85d1828e06ab096e595c)
(2026-08-12 16:27:33 UTC).
This is AST01-AST10, not the separate Agentic AI or LLM Top 10.
The source describes an OWASP Incubator project, Version 1.0 (2026 Edition),
with launch-preparation/public-review wording and a V1 whitepaper. It is not
treated here as a finalized certification or a set of npm advisories.

The review confirmed a pre-existing AST03 path-policy bypass: raw `./`, `..`
and case aliases could miss a denial and reach automatically permitted native
reads; case variants of protected filenames could also reach their contents.
The generated regression suite also covers the coupled internal-directory
symlink and canonical-source-identity cases. Repairs prevent those routes;
they do not claim that arbitrary skill instructions are trustworthy.

The later [protocol98 Local source/rewind follow-up](skills-and-rewind.md)
and the protocol-112 #45 follow-up add the following executable controls
against the same source revision, which was rechecked upstream on 2026-11-17
and is unchanged at `d6f7d7d`. These are not ten newly discovered
vulnerabilities, a certification or a claim of zero risk.

| Category | Current Local control and generated evidence | Remaining boundary |
| --- | --- | --- |
| AST01 Malicious Skills | Explicit admission for archives; read-only `trusted-source` auto-admission for skills from a folder or registry entry the user enabled (#70, a deliberate relaxation: trusted grants don't narrow tools, so every tool call keeps the user's normal policy). Protocol 112 refuses auto-admission when a skill contains invisible or bidirectional control characters and appends a service advisory listing indicator findings to every load. `owasp-ast.test.ts` drives generated models that load a malicious trusted skill and then try a hard-denied download-and-run command, a protected credential read and self-approval, in Autonomous and Manual: nothing runs, no setting, autonomy or answer changes, and the Manual request waits for the actual user | Generated models only: live-model resistance testing is excluded (user sign-off, 2026-11-17). No malicious-intent classifier; in Autonomous a trusted skill's instructions are bounded only by hard policy, not by the skill grant |
| AST02 Supply Chain Compromise | Exact source/version/package inventory, user-pinned Ed25519 artifact evidence, explicit unverified Local acknowledgement. Protocol 112 adds per-profile saved publisher keys and permanent key or exact-version blocks, checked at admission, every load and before every later effect of a consumed grant | No external PKI or transparency log (excluded with user sign-off, 2026-11-17); blocks are per profile, not a global revocation feed |
| AST03 Over-Privileged Skills | Per-admission native-file-only/literal-path restrictions intersect current canonical root/mode/policy; pending approval revocation is rechecked before dispatch | No skill can grant commands, network, credentials, authentication or hard-policy exceptions. Trusted-folder grants keep the normal policy instead of narrowing it (#70) |
| AST04 Insecure Metadata | Strict documented version1 Local declarations reject unknown fields, aliases, duplicate keys, invisible metadata, ambiguous versions and foreign compatibility | No silent foreign permission/signature/scanner translation |
| AST05 Untrusted External Instructions | Complete supported static package, exact relative dependency hashes, disclosed external references/exclusions; missing/oversized/binary sources fail, not truncate. Protocol 112 indicator rules flag download-and-execute, run-time installs and instructions fetched from URLs in skills and scripts; for scripts, those findings stop an agent's "safe" verdict from running them unless the actual user forces the exact source or explicitly accepts that risk in Settings / Scripts | Transitive downloads are flagged, not fetched or inspected; external references are not pinned. Pattern rules can miss obfuscated fetches |
| AST06 Weak Isolation | Existing service authentication/root leases remain; source grants prohibit script/command/install effects and cannot change Env. Complete reviewed sources run in Sandbox only against the exact owned private stage and guest root, with guest-only public-source reads ([contract](content-review.md#reviewed-sandbox-script-change-contract)), qualified (#66) on the current approved worker image ([final qualification](milestone-combination-matrix.md#final-qualification-2026-11-15)). The allowed-environments policy can require Sandbox for all new turns. Remote skills (D42) bind the pinned SSH peer and canonical remote root; their exact admitted package is copied to a digest-named 0700 cache, re-verified before each command that runs from it, and its scripts still need normal command approval | Explicit exclusion (user sign-off, 2026-11-17): Local is host execution by design and has no whole-descendant isolation; so is SSH. Remote reviewed scripts (`review_script`/`run_script`) stay unsupported and fail without Local fallback. A changed image needs its own qualification; qualification never authorizes a script without its own review |
| AST07 Update Drift | Source/configuration/digest checks, immutable artifacts, expiry and monotonic revocation at future use; changed inventory/configuration and stale reviews fail. Blocking one exact version digest stops it everywhere in the profile | Mutable upstream HEAD/repository labels are not durable publisher identity; no automatic trust transfer |
| AST08 Poor Scanning | Exact archive path/type/size/UTF-8/CRC and supported metadata checks. Protocol 112 adds a versioned deterministic indicator scanner over every inspected skill file and the complete reviewed script (code and instruction layers, normalized for zero-width padding, never truncated); findings are shown in reviews and to the model and never approve anything | Pattern matching only: no malware signatures or semantic analysis; binary/omitted files are not scanned. A clean scan proves nothing |
| AST09 No Governance | Service-owned audit/admit/revoke/disable, publisher keys and blocks through SDK, CLI/TUI and desktop; inherited context and rewind preserve source revocation and independent budgets | Already-consumed instructions/running effects cannot be retracted; no enterprise-governance certification |
| AST10 Cross-Platform Reuse | Agent Skills frontmatter is read as informational text; only the explicit `moguri` block and actual current profile/root carry semantics; unsupported Env (Sandbox skills) fails without fallback and foreign security metadata never becomes a grant. Remote sessions reuse the same admission and blocks over SSH ([Remote skill packages](skills-and-rewind.md#remote-skill-packages-protocol-112)) | No generic cross-harness permission portability; Remote runs only the admitted package's own files, never other unreviewed scripts |

These are source-review observations and explicit gaps, not ten-category
assurance. The four exclusions above (live-model testing, transparency log/PKI,
Local whole-descendant isolation, malware/semantic scanning beyond
deterministic indicators) were proposed with concrete options and signed off by
the project owner on 2026-11-17; they stay open for a separate reviewed scope.

### Protocol-112 #45 evidence

`tests/owasp-ast.test.ts` (14 cases, generated fixtures only) covers every
indicator rule (v2) plus benign negatives, zero-width and line-continuation
normalization, emoji, keycap, Persian and CJK-variant characters and RTL marks
that stay quiet, smuggled joiner and variation-selector runs that don't, bounded
locations,
linear scanning of adversarial 512 KiB lines and matches across window edges;
the trusted-folder hidden-character refusal and explicit admission; the two
AST01 generated-model cases above; saved keys (wrong signature, unknown
fingerprint, duplicate, non-Ed25519), key and version blocks stopping consumed
grants, re-pasted keys and re-saves; blocks surviving a service restart; the script indicator gate with actual-user
force and with explicit risk acceptance (which also bumps the permission
revision); and the schema-112 upgrade, missing, premature and relabelled-history
cases. The scanner and its gates add no dependency and run only in the
service. Worker and bridge bundles change only through the shared protocol-112
constant, so Sandbox needs a worker image rebuilt for protocol 112 like any
protocol bump; no new native qualification is claimed here.

## Generated evidence

`tests/file-policy.test.ts` uses generated roots and non-secret placeholders.
It covers request/rule aliases, literal boundaries, unchanged narrow grants,
macOS case/Unicode restrictions, protected filename variants, parent/leaf
symlinks, canonical source identity, actual SDK jobs in project/Home roots,
restart retention and owned Manual/read-only/Autonomous worker context.
`tests/remote-workspace.test.ts` additionally exercises protected case variants
and internal directory aliases through the actual pinned loopback SSH bridge,
without Local fallback or model calls.

Existing file/permission suites retain cancellation-before/after-publication,
failed persistence, writer/root races, profile isolation, stale CAS and
restart checks. Fixtures never access personal credential files, accounts or
paid inference. Live publisher reputation, OS isolation and external service
entitlement are not inferred from these generated checks.

The eight new file-policy cases passed in **2.97 s**, including actual owned
workers and a genuine service close/reopen. The seven SSH workspace cases
passed against freshly built protocol-82 bytes, including the new protected
case and internal-directory-alias checks. Observed SHA-256 identities:

| Payload | SHA-256 |
| --- | --- |
| `dist/worker.mjs` | `ca7b3360b9436892d9a2eac7cd22852f9a05bae3619dc67ed8e193397bf72472` |
| `dist/remote-bridge.mjs` | `26888388248247e5bb9911c1ec4deaf62b7f5c93c87e1da940d681620e2cc2a1` |

These are this repair's generated Local/loopback SSH evidence, not inherited
82 receipts, physical SendBox qualification, or approval of later changed
payloads. The [final combined qualification](content-review.md#final-generated-qualification)
records fresh Local/SSH results for the changed protocol-83 worker and bridge.
