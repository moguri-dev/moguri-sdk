# Claude Agent harness

Claude Agent runs the user's own installed, unmodified Claude Code as an external
agent harness inside a Moguri session. Claude Code plans, calls its model and runs
its own tools. Moguri keeps the session, queue, event history, approvals,
cancellation records, worktree root and transcript. The design follows how
[T3 Code](https://github.com/pingdotgg/t3code) (MIT) drives Claude Code; no T3
Code source was copied.

## Boundary

| Moguri owns | Claude Code owns |
| --- | --- |
| Session, queue, drafts and the append-only event history | Step scheduling, model calls and compaction |
| An exact decision for every tool call, recorded with its actual actor | Tool execution after Moguri allows it |
| Stop requests, acknowledgement and terminal outcome | Its transcript under the user's Claude config directory |
| The Local root (project, managed worktree or bound Home) | `CLAUDE.md`, skills, plugins and settings it loads |

D05's Moguri-owned loop is unchanged. Claude Agent is a separate harness, so the
following stay explicitly unavailable for Claude Agent sessions rather than being
approximated:

- Kupo routing and every helper role (router, critic, decision, title, compaction,
  candidate, wind-down). `ModelRegistry.prepare` rejects Claude Agent IDs, and
  `routingModelReady` excludes them.
- Finite token/USD budgets, including profile and global caps. Claude Code makes
  its own model calls, so Moguri cannot reserve before each dispatch (D25).
- Sandbox and Remote envs, Autopilot Max, side, subagent, settings and
  multi-repository chats, attachments other than pasted text, mid-turn steering
  and Moguri model options.
- Remembered grants for Claude Code tools. Each prompt is approved once.

## Authentication and terms

Moguri never installs Claude Code, never runs or ships a Claude binary bundled with
the SDK, never offers a Claude sign-in button and never reads or stores Claude
credentials. The user signs in with Anthropic's own flow (`claude auth login`) in
their own terminal, or configures their own API key or cloud provider (Bedrock,
Vertex, Foundry) in their environment. Usage is billed to the user under their own
agreement. This follows Anthropic's
[authentication and credential-use policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use),
checked 2026-11-16, which permits an end user signing in to the unmodified Claude
Code binary with their own subscription. The Agent SDK overview separately says
third-party developers may not offer claude.ai login or rate limits without
approval; Moguri therefore only detects existing sign-in status. Menus say
"Claude Agent", following the Agent SDK branding guidelines.

## Discovery

Claude Agent is off by default (`settings.claudeAgent.enabled`). Enabling it is the
user's consent to run their installed executable. Discovery then:

1. Resolves an explicit absolute `executablePath`, otherwise `claude` on `PATH`,
   then `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`.
2. Runs `claude --version` and requires at least 2.1.0.
3. Runs `claude auth status` and keeps only `authMethod`. Email and organization
   are discarded. Exit 1 or `none` means not signed in.

Probes start no session, MCP server, hook or model call. They have a 10-second
deadline and kill their own process group on timeout. Sonnet, Opus and Haiku
aliases (`claude-agent.sonnet` and so on) become selectable only after a
successful probe against the current settings.

## Turn lifecycle

Each Moguri turn runs one owned worker process (`claude-agent-worker`) with one
long-lived streaming session:

1. The controller commits `agent.session_bound` before launch, with the native
   session ID, transport, executable path/version, `authMethod` and canonical root.
   A turn uses `--resume` only when an earlier turn proved Claude Code started
   that native session (a response or result was recorded) on the same root, and
   no other model turn, rewind, context change, control turn or steer has changed
   Moguri's history since. Otherwise it starts a new native session with
   `--session-id`, so a crashed first turn or a discarded history is never resumed.
2. A new native session in a Moguri session with earlier history receives that
   text transcript (at most 64 KiB, one copy per response) as labelled context. It
   grants no permissions. Pasted text attachments are inlined into the prompt.
3. The worker spawns Claude Code in its own process group with a curated
   environment: shell basics plus `ANTHROPIC_*`, `CLAUDE_*`, cloud-provider and
   proxy variables. Moguri tokens never reach it.
4. A `PreToolUse` hook answers `ask` for every tool, so the user's Claude allow
   rules cannot bypass Moguri. Each `can_use_tool` request becomes a Moguri
   approval. `AskUserQuestion` is disallowed, so Claude asks in text instead.
5. Assistant text streams as `assistant.delta`; each response is retained as
   `agent.message` (text-only context for later Moguri models). Tool requests,
   decisions, starts and results use the existing `tool.*` events with
   `call.harness = "claude-agent"`. Harness tool results stay out of Moguri model
   context.
6. Claude Code's result becomes `agent.usage`, then the worker closes input,
   confirms the process exited and reports the terminal outcome.

### Approval policy

Claude tools map to the closest Moguri policy subject so existing hard denials,
path scope and explicit delegations apply: `Bash` to `run_command`, edit tools to
`write_file`, `Read` to `read_file`, search tools to `find_files`, todo tools to
`task_progress` and web tools to `web_fetch`/`web_search`. Any other tool
(subagents, MCP, plan exit) uses the subject `claude:<ToolName>`, so tool rules
for that name or `*` and a default deny apply before autonomy.

- Manual and Guided: reads inside the root are allowed by policy. Edits, commands
  and unmapped tools (subagents, MCP, plan exit) need an actual user decision.
  Moguri's native file safeguards do not cover Claude Code edits, so they are
  never auto-allowed by native policy.
- Autopilot: the user's explicit session delegation approves calls, but hard
  denials still win. Commands that run scripts or dynamic executables, which
  Moguri's own tools route through script review, need an actual user decision
  for that one call; this applies only when the script guard is the sole reason,
  never over an explicit, exact-command or default deny.
- A tool result for a call Moguri never approved is recorded as `unconfirmed` and
  settles the turn as partial.
- Read-only sessions run Claude in `plan` mode and deny every non-read tool. A
  switch to read-only during a turn applies to every later approval in it.
- Paths outside the root are denied. Approvals are serialized; a second
  concurrent request waits.

### Stop and recovery

Stop records `turn.stop_requested`, the worker acknowledges, sends Claude Code's
`interrupt` control request and escalates to `SIGTERM`/`SIGKILL` of its process
group at 2.5 and 3.5 seconds. The controller's existing 5-second escalation still
applies. After every turn, including normal exits, the worker terminates any
processes still in Claude Code's process group (`SIGTERM`, then `SIGKILL`); only
`ESRCH` confirms cleanup, otherwise the turn is partial. Processes that detach into
their own process group are outside this boundary. A stopped or failed turn never becomes completed. A tool approved but
without a result settles the turn as partial.

If the service exits, the worker sees its control channel disconnect and kills the
Claude process group. Restart never resumes an interrupted Claude turn
automatically: the next user prompt resumes the native session with a fresh turn.

## Transports

Both transports launch the same user executable, use the same normalizer and
produce identical events. Choose one in Settings / Model providers.

| Transport | Tradeoffs |
| --- | --- |
| `sdk` (default) | Anthropic's `@anthropic-ai/claude-agent-sdk`, as T3 Code uses. Typed, maintained by Anthropic and tracks Claude Code protocol changes. Proprietary terms; Moguri pins it as a devDependency bundled into the worker, and overrides its optional per-platform Claude binaries (about 347 MB each) with an empty stub. `spawnClaudeCodeProcess` keeps process ownership in Moguri. |
| `stream-json` | Moguri speaks Claude Code's `--input-format stream-json` control protocol directly (`initialize`, `can_use_tool`, `hook_callback`, `interrupt`), as Anthropic's SDKs do internally. No SDK code is involved. The wire format is the SDK's internal protocol, not a public stability promise, so a Claude Code upgrade can break it before the SDK path. |

## Events and migration

Migration 108 adds `claude_agent_harness_schema` and new events
`agent.session_bound`, `agent.step_started`, `agent.message` and `agent.usage`.
`agent.message` retains a context blob through the normal encrypted retention
grants. Pre-108 lineages cannot contain these events, Claude Agent settings or
harness tool calls. Usage totals are Claude Code's cumulative session values; the
USD figure is Claude Code's own estimate and never enters the Moguri budget ledger
or a billed field.

## Tests

`tests/claude-agent.test.ts` drives both transports against a generated
`tests/fixtures/fake-claude.mjs` that speaks the control protocol. It never
contacts Anthropic or reads credentials. Coverage includes stream normalization,
policy mapping, environment curation, approval and denial, resume, stop and
process-group cleanup, hard denials over the script exception, unapproved
results, resume safety, transcript handoff, pasted text, missing sign-in and the
108 migration.
