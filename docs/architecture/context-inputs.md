# Typed context inputs

All attachment surfaces use the SDK/service's typed references and encrypted
content grants. They do not grant a model arbitrary host filesystem access or
create client-owned provider payloads. Explicit user selection is required;
bare `^`, `:`, `#` and `@` text remains literal. A leading `!` is a shell line for
the chat's user console, never a context input (see
[shell lines](terminal-reattachment.md#shell-lines-from-the-composer)).

Protocol 43 adds [first-class PDF/DOCX/XLSX documents](document-attachments.md)
through this same pipeline. It retains both original and extracted snapshots
under the existing encrypted session/profile grants. Source/text files and
images keep their existing shapes and behavior. Models receive descriptors and
approved bounded list/read/search tools, never whole-document prompt expansion.
Extraction runs locally in restricted resource-bounded processes. PDF page,
DOCX paragraph/heading/table and XLSX sheet/cell/cache/inert-formula provenance,
explicit OCR/format limitations and exact failure/cancellation behavior are
defined in the linked contract.

## Reuse and qualification

Reuse the existing scoped file reader, TypeBox, ignore (MIT), digest-addressed
encrypted blobs and maintained pi-ai image-content transport. Sharp 0.35.5
(Apache-2.0, bundled libvips notices) validates/normalizes locally, never through
a conversion service. A generated 16-by-12 PNG, bounded native decode,
normalization and malformed-image rejection passed in 2.17 ms. Tests never read
personal images or the real clipboard.

## Sources and boundaries

- Project text keeps its legacy `project_file` shape and selected workspace.
- Explicit client text/image paths use canonical, regular non-symlink files;
  protected credentials and configured source-folder denials still apply.
- Clipboard images are decoded with input-byte/pixel limits and normalized
  without embedded metadata. A project-free chat may receive an explicitly
  selected image/file, but still cannot infer a workspace root or run file tools.
- Folder previews expose the exact bounded file set, exclusions, byte count and
  reviewed digest and actual env/model/SSH destination. Confirmation rechecks
  source and destination; a model/env/target change requires fresh review.
- GitHub issue/PR snapshots use the user's explicitly chosen public/authorized
  integration, identify repo/number/type and keep a bounded immutable revision.
  Attaching never checks out, resumes, edits, closes or publishes anything.
- Session previews use only authorized public transcript content in the active
  profile, including explicitly selected archived context. They never forward
  private continuation payloads or control the source session.

Descriptors retain provenance and content digests, not image bytes or source
credentials. Snapshot grants are bound to the destination session and survive
source edits; deleting the destination erases its grant normally. Remote and
Sandbox receive only approved content, never a host home-directory mount.

## Admission and recovery

Issue #17 adds `paste_file` snapshots for more than 50 logical lines; CRLF is
one delimiter, CR and LF are also supported, and a trailing delimiter creates
an empty final line. Exact UTF-8 bytes, including line endings, stay encrypted
under the destination session's existing retention grant. The 128 KiB text-file,
16-attachment and 12 MiB aggregate limits apply. Oversized/invalid text or failed
persistence preserves the complete draft. No source checkout is modified.
Shared send and queue editing perform capture in the same atomic transaction
as consumption, so SDK callers cannot bypass it through a plain text draft.
Context preview sizes that pending descriptor and its available file tool using
the same calculation, without retaining a blob/grant, consuming the draft or
calling a model. It does not misleadingly count the whole pending paste as the
request body.
Protocol/schema 36 adds the attachment discriminator and optional queue-edit
attachments without rewriting prior events, receipts, ciphertexts or settings.

The scoped file namespace is `moguri-attachment/ID.txt`, not a host path or a
mount. Model context must contain only its descriptor. The existing `read_file`
tool obtains bounded exact UTF-8 pages or literal searches through the owning
worker's authenticated control-plane broker, subject to exact tool approval.
This deliberately discloses the controller snapshot boundary on both Local
and core SSH; it does not claim a remote filesystem mount or Local fallback.
Unsent drafts, other sessions/profiles and arbitrary names cannot be read.
Sandbox admission remains blocked until its separately qualified transport can
carry those same owned frames. Only explicit reads may reveal file sections
to the selected model. The existing MIT-licensed SDK, worker, TypeBox and Node
primitives are reused without dependencies or additional model calls.
An explicit user-created child/side context copy retains its own exact file
grants in `session.created.pasteFiles`; deleting its source cannot erase those
copies. It still needs separate file-tool approval. Tool-less model-created
subagents fail explicitly when scoped files would be inaccessible, rather than
receiving unreadable filenames or an automatic whole-file prompt expansion.
Settings-only metachat likewise blocks scoped-file turn admission with an
actionable diagnostic and preserves the draft/held queue. It never widens its
tool set or silently supplies the whole file as a workaround.

Unsupported image models block admission and preserve the complete draft/queue;
images are never silently dropped, captioned remotely or sent to another model.
Folder/reference preview is not inference. A stale preview, credential failure,
unsupported file or partial capture has an explicit error and does not overwrite
the draft. TUI/CLI expose paths and structured previews when clipboard-image
capture is unavailable.

Conversation text retains its 1 MiB bound separately from approved binary image
data. Total serialized model context is capped at 16 MiB. Generated noise pixels
prove a normalized image above 1 MiB reaches an actual image-capable worker;
binary payloads are not misclassified as text, dropped or remotely captioned.
Remote receives only captured pixels/content over its authenticated channel,
not an absolute client-side source path or host folder mount.

Durable schema evolution preserves legacy text attachments and existing
identities/grants. Tests cover malformed/oversized images, source races,
symlinks/protected paths, ignore rules, cross-session authorization, stale
previews, unsupported models, deletion, migration and restart.

## Desktop interaction revision

Protocol/database 44 keeps source selection in the SDK/service.
The desktop attachment menu has five entries: project file or folder (`@`),
issue/PR or GitHub file (`#`, or `@owner/repo/path`), session (`:`), local file
(`^`) and local folder (`^/absolute/path/`). Documents and images use the same
local-file picker. Bare shortcuts remain literal until explicit selection.
Local project identifiers contain only ASCII letters, digits, hyphens and
underscores; ambiguous project/repository references must not guess a source.

Clickable attachment chips inspect the retained encrypted snapshot, not a
fresh read of the original. Removing draft context never edits a sent message
or controls its source. Session drops fetch a destination-bound snapshot before
confirmation. An explicit profile preference can suppress subsequent session
attachment dialogs, but not digest/revision checks, source isolation, or model
admission rules. Other aggregate sources still require exact review.

React, Electron, TypeBox, Ghostty, Node-PTY and the existing encrypted store
(MIT) are reused. New settings and sibling-session order are durable,
optimistically revised service data shared by every client. The additive
migration preserves schema-43 ciphertext, receipts and existing grants.
Generated fixtures cover shortcut resolution, previews/removal, drag/drop,
source/destination races, settings persistence, cancellation and restart.

Before implementation on 2026-10-24, the provider, store, PTY, OpenTUI, Electron
and filesystem baseline spikes passed: generated OAuth cancellation 31.70 ms,
SQLite append p95 0.060 ms, nested PTY cancellation 151.83 ms with no observed
survivor, OpenTUI update 17.12 ms, hidden Electron cold start 203.37 ms / 449.73
MiB / scroll frame 12.89 ms, and 2,000-file search/Git status 0.97/6.15 ms.
The vector/MCP primitives passed (500 vector rows in 6.20 ms). Retention
compartments passed (500 events, 250 independently retained artifacts, 137.90
ms), and real hidden-Electron Ghostty input passed (423,045-byte WASM, 25.90
ms). The pinned speech CLI's version/help passed without weights or microphone
access. These are generated-fixture prerequisite results, not live inference,
real microphone, Linux, SendBox, signing or release qualification.
The baseline's live-provider, Rust/Linux, signed-packaging, physical SendBox/SSH,
live kupo/System One and full-model-pool groups remain FAIL/unavailable. This
interaction change does not relabel those historical release/milestone gates.

The post-dependency-patch rerun passed the same six baseline primitives:
generated cancellation 31.01 ms, SQLite append p95 0.056 ms, PTY cancellation
151.77 ms with no observed survivor, OpenTUI update 16.91 ms, Electron cold
start 184.54 ms / 445.14 MiB / scroll 8.28 ms, and filesystem/Git status
0.98/6.26 ms. The unavailable baseline groups retained their explicit FAIL
results. Root `npm ci` emitted neither reported deprecation warning, and the
moderate-or-higher dependency audit reported zero vulnerabilities.

Legacy recovery fixtures remove the schema-44 marker when constructing genuine
pre-44 databases. Eleven older hand-built fixtures initially retained that
future marker while lowering `user_version`; correcting their setup preserves
the original strict migration, rollback, ciphertext/key/receipt and missing
telemetry assertions. All 13 targeted schema/recovery cases pass. Production
migrations still reject inconsistent markers rather than silently ignoring
them or requiring a state reset.

The actual packed external SDK passes safe project identifiers, exact Local
source resolution, same-profile attachment grants, complete atomic sibling
order and shared TUI commands. Its generated Local broker also proves a
null-session/project global console at the canonical data root remains usable
after source-session deletion through SDK, CLI and TUI, without a model call.
Root-install warning fixes are separately scoped from npm's non-inheritance of
dependency overrides; external-host configuration is documented in the SDK guide.

The [final protocol-44 source acceptance](../setup.md#protocol-44-source-qualification)
records the complete clean unit/native-TUI and hidden Electron runs, exact skips
and packed-consumer results. Real microphone/ASR and unqualified native/release
gates remain separate.
