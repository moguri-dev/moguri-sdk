# Session Agent terminal

The owner selected a separate **Agent** terminal tab, not model access to the
existing User or Global consoles. The Agent view uses Moguri's actual approved
`run_command` PTYs and their original scoped command results. It does not create
a second executor or silently attach a model to a user's shell.

## Prerequisites and reused components

The 2026-10-24 macOS arm64 / Node 26 baseline passed generated provider
cancellation (31.42 ms), SQLite append p95 (0.057 ms), PTY cancellation
(151.53 ms, no observed survivor), OpenTUI updates (17.30 ms), hidden Electron
startup (271.35 ms / 440.44 MiB / 8.29 ms scroll frames), and 2,000-file
filesystem/Git inspection (0.99/6.76 ms). The session spike preserved 250
independent artifacts across 500 encrypted events in 117.92 ms and loaded the
real 423,045-byte Ghostty WASM in 35.70 ms under strict CSP.

Reuse Node/Node-PTY (MIT/component notices), Ghostty Web (MIT), React (MIT),
TypeBox (MIT), the existing scoped command worker/supervisor and SDK/event
authority. No dependency, VT parser or new execution transport is added.
Unavailable live/native/Linux/release baseline groups remain explicitly
unqualified; these measurements do not establish real provider entitlement,
whole-descendant containment or a signed release.

## Ownership and capabilities

The SDK/service Agent view selects only original, unambiguous `run_command`
requests/results in the exact retained profile/session. Pending and denied
requests remain explicitly unstarted, never successful PTYs. File reads, MCP results,
GitHub/Linear jobs, model context and private user/global console buffers
cannot be substituted. Original turn/step/call identity, environment, status
and retained-output limits remain visible. Deleted source sessions cannot
recover bytes from the independent sanitized operation ledger.

The model uses existing `run_command` with unchanged command approval, actual
execution-root and environment policy, folder restrictions, writer leases,
timeout, cancellation and cleanup behavior. The read-only
`read_agent_terminal` capability lists bounded original command metadata or
reads an exact command result in bounded UTF-8 pages. It requires the owning
turn's exact tool approval/delegation and a fresh policy/mode check. Output
is untrusted data, never permission, an instruction or proof of command success.
Private role owners remain tool-less.
The model capability requires an attached workspace, like command execution;
project-free chats do not receive an unusable terminal schema. User SDK/CLI
inspection can still read retained records without executing a workspace tool.

This is a per-command agent terminal, not a persistent interactive shell.
Each approved command owns its existing PTY; subsequent commands do not inherit
shell variables or a changed directory from a previous command. Interactive
stdin and background command adoption are not introduced. The desktop Agent
view has no stdin route: models run commands, while personal typing belongs in
the private User terminal. Stop in chat cancels the actual owning agent turn.

## Shared presentation and retention

User remains the original private Ghostty console, with its current explicit
open/reattachment/no-input-replay semantics. Global Terminal remains user-only.
Agent displays actual agent output through the same maintained Ghostty runtime,
with original command selection, truthful lifecycle labels and bounded output
pages/tails. Merely opening, restoring, reconnecting or selecting Agent never
launches a shell or a model. Scope changes discard stale pending reads.

Agent command input/output already belongs to the approved model tool stream;
this feature does not copy user console bytes into that stream. No terminal
input is replayed, no PID ownership is inferred, and a missing or partial
result never becomes success. A clipped live tail is not full process output.

Protocol/database 46 extends the existing read view and model tool schemas.
There is no new durable event or SQL layout. The transactional version upgrade
preserves existing ciphertext, grants, receipts and unknown accounting.

## Required generated coverage

Prove actual approved command execution and model rereads, no personal-console
exposure, mode/permission/root/profile isolation, UTF-8 bounds, cancellation
and unknown results, delayed-scope replies, restart/migration preservation,
real read-only Ghostty rendering, shared CLI/TUI access and packed browser-safe
SDK/React declarations. No personal shell, account, microphone or paid inference
is used.
