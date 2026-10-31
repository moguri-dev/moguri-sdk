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
can authorize access. Manual, Guided, explicit Autopilot and read-only sessions
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

| Category | Examined authority | Remaining boundary |
| --- | --- | --- |
| AST01 Malicious Skills | Disabled imports, digest-bound skill loading, untrusted-content labels | No live-model resistance or publisher screening claim |
| AST02 Supply Chain Compromise | Commit-pinned bundle reads, exact review digests, disabled installation | Publisher signatures, transparency and revocation are not qualified |
| AST03 Over-Privileged Skills | Shared tool/root/mode policy and repaired file guard | No general per-skill permission or credential model |
| AST04 Insecure Metadata | Bounded core YAML, duplicate-key checks, typed bundle schemas | Unknown skill security declarations are not enforcement |
| AST05 Untrusted External Instructions | Reviewed skill sources, public-destination and website gates | No transitive instruction-chain inventory or behavioral assurance |
| AST06 Weak Isolation | Owned subprocesses, service authentication, declared containment limits | No new VM, external SSH host or whole-descendant isolation qualification |
| AST07 Update Drift | Fresh source digests, stored-blob checks, disabled bundle updates | Mutable upstream references are not durable publisher trust |
| AST08 Poor Scanning | Archive path/type/size/encoding/CRC validation | Structural validation is not malware or semantic scanning |
| AST09 No Governance | Profile-owned registry/history and explicit skill-use provenance | No enterprise governance or removal of already-consumed instructions |
| AST10 Cross-Platform Reuse | Moguri manifest/protocol validation and native filesystem boundaries | No translation of foreign-platform permission/signature declarations |

These are source-review observations and explicit gaps, not ten-category
assurance. Adding a scanner, identity infrastructure or general isolation
platform requires its own reviewed scope and qualification, not an implicit
extension of this repair.

## Generated evidence

`tests/file-policy.test.ts` uses generated roots and non-secret placeholders.
It covers request/rule aliases, literal boundaries, unchanged narrow grants,
macOS case/Unicode restrictions, protected filename variants, parent/leaf
symlinks, canonical source identity, actual SDK jobs in project/Home roots,
restart retention and owned Manual/read-only/Autopilot worker context.
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
