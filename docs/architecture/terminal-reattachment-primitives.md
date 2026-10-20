# Restart-safe user terminal prerequisites

## Audited boundary

At the protocol-22 prerequisite checkpoint, the public service owned `node-pty` directly. Graceful close
stops known groups; restart records unconfirmed terminal metadata, cannot
reattach a prior PTY, never launches a replacement and never replays input.
Local Ghostty is interactive, but that is not restart reattachment.

The candidate below is a **private generated prerequisite**, not an enabled
application capability or complete supervisor/containment implementation.
The production terminal API/retention model is unchanged.

## Reused implementation

Reuse the existing `TerminalManager` (Node-PTY), process-group stop helper,
UTF-8/JSON framing, Node crypto/net/process primitives and future Ghostty/SDK
surfaces. Node and Node-PTY are MIT-licensed. No new dependency, VT parser,
provider call, workflow database or personal shell is introduced.

The private broker runs the actual existing PTY engine in its own generated
Node process. An owning controller communicates through a private Unix socket.
Fresh per-connection HMAC possession proofs bind both peers to one scope
digest; the key is delivered through owned bootstrap IPC, not argv, a file,
terminal output or a model. The runtime directory/socket are owner-only.
This tested a generated in-memory key, **not production secret-backend storage**.
The later [protocol-23 integration](terminal-reattachment.md) is documented
separately; this record is not backdated application/package qualification.

The existing JSON framer gains an optional validated lower byte ceiling;
the default worker ceiling/behavior stays unchanged. The prototype uses
512-KiB control frames and the existing 128-KiB volatile PTY buffer. Output
pages remain bounded, with explicit lost-prefix offsets and no transcript.

## Measured result

`node --import tsx --test tests/terminal-reattachment-primitives.test.ts tests/worker-wire.test.ts`
passes **13 checks in 2,599.28 ms** on this macOS arm64/Node 26.11.1 host.
These are seven real PTY/broker cases and six unchanged worker-framing cases.
Both type checks pass.

- A real owning-controller **SIGKILL** leaves the same broker and PTY PIDs
  alive. A new authenticated controller reads prior volatile output and sends
  new input. Exactly one generated program launch is observed. The measured
  startup/crash/reconnect case completes in **306.68 ms**, excluding cleanup.
- Wrong key or scope is rejected without terminal bytes. Only the private
  socket exists in the runtime directory; no key/transcript is written.
- An unauthenticated oversized frame closes before the separate two-second
  idle timeout; the explicit acceptance bound is **under 1.5 s**. The actual
  PTY remains running. The smaller ceiling preserves default worker tests.
- A deliberately held real input acknowledgement is lost to controller
  SIGKILL. Its pending call fails as unconfirmed. Reconnect observes accepted
  bytes exactly once and does not resend them.
- Actual large UTF-8 output loses its prefix explicitly and stays within
  128 KiB. Bounded pages reconstruct only the retained window, not a transcript.
- Resize reaches the actual TTY/program. Exact owned-group stop is
  acknowledged, with the existing explicit detached-descendant disclaimer.
- Broker SIGKILL is a failed/unconfirmed control outcome, not another shell,
  an empty-success reply or input replay.

Every fixture uses a generated Node echo program, never a personal login shell,
startup files, microphone, credential, paid endpoint or Sandbox. Cleanup uses
authenticated disposal or exact known PIDs verified against a unique generated
scope/program marker, never process-name killing or unrelated Porto processes.
Directories are removed only after confirmed fixture teardown.

## Failed assumptions retained

The initial missing-module/type checks were corrected before qualification.
The first native run passed 4/5: its buffer assertion assumed a single bounded
page contained the entire retained window. It now reads the next advertised
offset, without enlarging the API limit or making the buffer durable.
The first framing extension passed 12/13: the unauthenticated test socket was
paused and did not consume its challenge/EOF, so its close assertion timed out.
The corrected test drains only challenge bytes and proves rejection precedes
the idle timeout. Neither failure justified a replacement PTY or input replay.

## Application obligations established by this spike

The later application integration must satisfy these requirements:

- Retain typed exact terminal intent **before** spawning a broker/PTY, and
  preserve original-command idempotency across receipt loss/restart.
- Bind profile/session/workspace/root identity, process/build/protocol,
  private endpoint and actual cleanup provenance in the event authority.
  Use an explicit scoped secret backend; never persist auth keys or terminal
  input/output in events, receipts, model context or ad-hoc plaintext files.
- Recovery may inspect/authenticate only an existing matching broker. Missing,
  corrupt, changed, orphaned or incompatible metadata is unconfirmed, not
  permission to spawn, migrate roots or replay input.
- Preserve user PTYs only across an **explicit service restart** or actual
  controller loss. Ordinary service stop/runtime disposal and explicit terminal
  close retain their owned-stop semantics. Closing a UI panel remains detach,
  not process stop. Do not turn this into general agent background execution.
- Prove authenticated lifecycle operations, zero-replay recovery, cancellation
  failure, deletion/retention, policy/profile/root races, secret failure and
  actual packed SDK/native-client/binary behavior with migrations.

Rust helpers, Linux release behavior, protected/Remote PTYs and complete
detached/reparented descendant containment remain unqualified. This prototype
does not relax permissions, allowed-env policy or the user's Sandbox pause.
