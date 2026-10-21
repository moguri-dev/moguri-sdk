# Typed context inputs

All attachment surfaces use the SDK/service's typed references and encrypted
content grants. They do not grant a model arbitrary host filesystem access or
create client-owned provider payloads. Explicit user selection is required;
bare `^`, `:`, `#`, `!` and `@` text remains literal.

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
