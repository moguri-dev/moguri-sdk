# Agent harnesses: Claude Agent, Codex Agent and ACP agents

An agent harness runs the user's own installed coding agent inside a Moguri
session. Claude Agent runs unmodified Claude Code; Codex Agent runs the Codex CLI
through `codex app-server`; Antigravity Agent and Gemini CLI Agent run Google's
`agy acp` and `gemini --acp` over the Agent Client Protocol (ACP). The harness plans, calls its model and runs its own
tools. Moguri keeps the session, queue, event history, approvals, cancellation
records, worktree root and transcript. The design follows how
[T3 Code](https://github.com/pingdotgg/t3code) (MIT) drives Claude Code and Codex;
no T3 Code source was copied.

All harnesses share one worker IPC protocol (`agent-harness-protocol.ts`), one
process-group owner (`agent-worker-runtime.ts`), the same controller lifecycle and
the same `agent.*` events. Sections below describe Claude Agent first, then what
differs for [Codex Agent](#codex-agent) and the [ACP agents](#acp-agents-antigravity-agent-and-gemini-cli-agent).

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
- Sandbox and Remote envs, Autopilot, side, subagent, settings and
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

1. The controller commits `agent.session_bound` when the harness reports its
   initialized native session, with the native session ID, transport, executable
   path/version, `authMethod` and canonical root. A harness that exits before
   initializing binds nothing, so nothing can be resumed from it. A turn uses
   `--resume` only when an earlier turn proved the same harness started
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
- Autonomous: the user's explicit session delegation approves calls, but hard
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

## Codex Agent

Codex Agent runs the user's own Codex CLI (`codex app-server`, the
[documented integration surface](https://developers.openai.com/codex/app-server)
for rich clients) with the user's own `codex login`, either Sign in with ChatGPT or
an API key. It follows T3 Code's existing-login path. T3's managed mode, which
installs Codex and brokers its tokens, is not implemented: Moguri never installs
Codex and never reads, stores or refreshes Codex credentials. The same limits as
Claude Agent apply (Local, Unlimited, single-root text chats, no Autopilot,
no steering).

### Discovery

Codex Agent is off by default (`settings.codexAgent.enabled`). Discovery resolves
an explicit absolute `executablePath`, otherwise `codex` on `PATH`, then
`~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. One bounded app-server
session (15 seconds, own process group) runs `initialize`, `account/read` and
paginated `model/list`; it starts no thread and makes no model call. The version
comes from the initialize user agent. Only the login kind is kept (`chatgpt`,
`api_key` or `third_party` for a configured custom provider); the account email and
plan are discarded. No account means not signed in. Every listed, non-hidden model
becomes `codex-agent.<model>`.

Codex Agent is blocked when the profile's default tool decision is deny, because
Codex can run some commands without asking (see below) and that policy could not
be enforced beforehand.

### Turn lifecycle

1. The worker spawns `codex app-server` in its own process group with a curated
   environment (shell basics plus `CODEX_*`, `OPENAI_*`, `AZURE_OPENAI_*` and proxy
   variables), then performs the `initialize`/`initialized` handshake.
2. A new thread uses `thread/start`; a resumable earlier thread uses `thread/resume`
   with the same rules as Claude Agent. Both set `approvalPolicy: "untrusted"`,
   `approvalsReviewer: "user"`, the `workspace-write` sandbox (`read-only` for
   read-only sessions) and the config override `web_search: "disabled"`. Codex
   assigns the thread ID; the worker reports it once the thread is open, and only
   then is `agent.session_bound` committed.
3. `turn/start` sends the prompt with `sandboxPolicy` `workspaceWrite` or `readOnly`,
   both without network access.
4. Codex items become Moguri steps: agent text and reasoning accumulate until a
   tool item (command, file change, MCP call, web search) closes the step with its
   tool call. A command approval can arrive before its `item/started`, so the
   approval itself can introduce the call.
5. `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`
   become Moguri approvals and are answered `accept`, `decline` or (when stopping)
   `cancel`, never `acceptForSession`. Permission requests are answered with no
   permissions, MCP elicitations are declined, and every other server request is
   refused.
6. `thread/tokenUsage/updated` totals become `agent.usage` (no cost estimate).
   Stop sends `turn/interrupt`, then the same process-group escalation as Claude.

### Approval policy

Codex calls map to Moguri subjects: `command` to `run_command`, `file_change` to
`write_file` for every changed path, `web_search` to `web_search` and anything
else (MCP tools, subagents) to `codex:<name>`. A file change whose paths Codex did
not disclose always needs a review. The Claude rules for native file safeguards,
script commands, Autonomous and read-only sessions apply unchanged.

The app-server protocol still accepts `untrusted` after Codex 0.149.0 retired it
as a `config.toml` value ([openai/codex#39630](https://github.com/openai/codex/pull/39630),
checked 2026-11-16). Since 0.149.0 it asks for every command unless the user's own
Codex exec-policy rules allow it; earlier versions also ran a built-in known-safe,
read-only command list (for example `cat`, `ls`, `rg`) without asking. Moguri
cannot pre-empt either. When such a result arrives, Moguri adopts it as completed
only if every command action is a recognized read, list or search inside the root
that Moguri's own read policy allows without review, and no exact-command denial
matches; the record says Codex ran it without asking. Any other tool Codex ran
without asking (an exec-policy-allowed command, an MCP call) is recorded as
`unconfirmed` and settles the turn as partial.

## ACP agents: Antigravity Agent and Gemini CLI Agent

Antigravity Agent runs the user's own Antigravity CLI (`agy acp`, which Google
[documents for ACP clients](https://antigravity.google/docs/cli/acp/)) and Gemini
CLI Agent runs the user's own Gemini CLI (`gemini --acp`, Apache-2.0). Both speak
the stable ACP version 1 over one Moguri-owned client: newline-delimited JSON-RPC
2.0, reusing the Codex app-server line client with the `jsonrpc` field (D79). The
`@agentclientprotocol/sdk` package is not used, so nothing new is bundled. The
design follows T3 Code's Antigravity driver and its ACP registry entry for Gemini
CLI; no T3 Code source was copied.

### Authentication and terms

Moguri never installs either CLI, never calls ACP `authenticate`, never starts or
relays a Google sign-in and never reads, copies or refreshes their tokens. The
user signs in with Google's own flow by running `agy` or `gemini` in their own
terminal (a Gemini API key can live in the CLI's own `~/.gemini/.env`). Moguri
never calls Antigravity or Cloud Code Assist endpoints and identifies itself as
`moguri` in `clientInfo`, never as another editor. This follows the
[Antigravity Additional Terms](https://antigravity.google/terms) §6, checked
2026-11-25, which forbids third-party software accessing the service with
Antigravity OAuth: Moguri only launches Google's unmodified CLI, which owns its
sign-in, as Google's ACP documentation describes for editors.

The agent's environment is an allowlist: shell basics plus proxy and certificate
variables, and `NO_BROWSER=true`. Ambient Google credentials (`GEMINI_API_KEY`,
`GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT` and the
like) never reach it, so a variable can't silently change the signed-in account.

### Discovery

Both are off by default (`settings.antigravityAgent.enabled`,
`settings.geminiAgent.enabled`). Discovery resolves an explicit absolute
`executablePath`, otherwise `agy` or `gemini` on `PATH`, then `~/.local/bin`,
`/opt/homebrew/bin` and `/usr/local/bin`. One bounded probe (30 seconds, own process
group, an empty temporary directory) runs `initialize` and `session/new`; it sends
no prompt. The version comes from `initialize`'s `agentInfo`; Antigravity CLI must
be 1.5.0 or newer, the first version T3 Code supports. ACP's `auth_required`
(`-32000`) means not signed in. Models come from the session's `model` config
option or the legacy `models` block and become `antigravity-agent.<model>` or
`gemini-agent.<model>`; an agent that lists none offers its own default.
Antigravity can serve other labs' models, which keep their own lab (D56).

Both are blocked when the profile's default tool decision is deny, because the
agent decides which tools ask for permission and typically reads files without
asking.

### Turn lifecycle

1. The worker spawns the CLI in the session root in its own process group and
   sends `initialize` with no file-system or terminal capabilities, so the agent
   uses its own tools and asks permission for them.
2. A resumable earlier session uses `session/load` when the agent advertises
   `loadSession`, with the same resume rules as Claude Agent; the history it
   replays is ignored. Otherwise `session/new` starts a session whose ID the agent
   assigns, and `agent.session_bound` is committed once it exists.
3. A model other than the session's current one is selected with
   `session/set_model`, or `session/set_config_option` where that is missing. If
   selection fails, nothing is sent and no other model is substituted.
4. ACP has no system prompt, so a new session's first `session/prompt` carries
   Moguri's instructions in a `<moguri-instructions>` block before the request.
5. `agent_message_chunk` and `agent_thought_chunk` updates become text and
   reasoning; a `tool_call` closes the step with its call. Each
   `session/request_permission` becomes a Moguri approval answered with the
   agent's `allow_once` or `reject_once` option, or `cancelled` while stopping.
   Moguri never selects an `allow_always` option. Every other client method
   (file system, terminals, elicitation) is refused.
6. `PromptResponse.usage` becomes `agent.usage` for that prompt, with a
   `usage_update` USD cost as the agent's own estimate. Stop sends `session/cancel`,
   then the same process-group escalation as Claude.

### Approval policy

ACP tool kinds map to Moguri subjects: `read` to `read_file`, `search` to
`find_files`, `edit`, `delete` and `move` to `write_file` for each disclosed
location, `execute` to `run_command` with the raw command and `fetch` to
`web_fetch`. Any other kind becomes `acp:<kind>`. An edit or read without
disclosed locations, or a command without its command line, always needs a
review. The Claude rules for native file safeguards, script commands, Autonomous
and read-only sessions apply unchanged; read-only sessions allow only `read`,
`search` and `think`.

A tool the agent ran without asking is adopted as completed only when it is a
`read` or `search` whose every disclosed path Moguri's read policy allows without
review, or a `think` step; the record says so. Any other unrequested tool is
`unconfirmed` and settles the turn as partial.

## Events and migration

Migration 108 adds `claude_agent_harness_schema` (its name predates Codex) and new
events `agent.session_bound`, `agent.step_started`, `agent.message` and
`agent.usage`, each carrying `harness: "claude-agent" | "codex-agent"`.
`agent.message` retains a context blob through the normal encrypted retention
grants. Pre-108 lineages cannot contain these events, harness settings or harness
tool calls. Claude Code and Codex usage totals are the harness's cumulative session
values; a harness's USD figure is its own estimate and never enters the Moguri
budget ledger or a billed field.

Migration 124 (D79) adds `antigravity-agent` and `gemini-agent` to `harness`, the
`acp` transport and the `hosted_cloud_acp_schema` marker; pre-124 lineages cannot
contain ACP sessions, ACP tool calls or ACP harness settings. ACP usage is the
prompt's own usage, not native-session totals.

## Tests

`tests/claude-agent.test.ts` drives both transports against a generated
`tests/fixtures/fake-claude.mjs` that speaks the control protocol. It never
contacts Anthropic or reads credentials. Coverage includes stream normalization,
policy mapping, environment curation, approval and denial, resume, stop and
process-group cleanup, hard denials over the script exception, unapproved
results, resume safety, transcript handoff, pasted text, missing sign-in and the
108 migration.

`tests/codex-agent.test.ts` drives a generated `tests/fixtures/fake-codex.mjs`
that speaks the app-server protocol without contacting OpenAI. Coverage includes
item grouping, approval-first commands, autonomous read reconciliation, policy
mapping, environment curation, thread start and resume parameters, decline,
unapproved MCP results, failure, stop with process-group cleanup, missing sign-in
and default-deny blocking.

`tests/acp-agent.test.ts` drives a generated `tests/fixtures/fake-acp.mjs` that
speaks ACP without contacting Google or reading credentials. Coverage includes
update grouping, permission-first calls, policy mapping, the environment
allowlist (ambient Google credentials are dropped), model discovery and
selection, session load with ignored replay, once-only permission options,
rejection, unrequested tools, stop with process-group cleanup, missing sign-in
without `authenticate`, the Antigravity minimum version, default-deny blocking
and the 124 migration and restart.
