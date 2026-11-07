# DS4 and DeepSeek V4.1 Flash Q2 compatibility

This qualifies one explicitly installed antirez/ds4 runtime and model on macOS,
through Moguri's existing SDK, local service and owned worker. It is not a model
quality benchmark, hardware capacity promise, paid-provider receipt, Remote or
Sandbox qualification, or completion of the wider milestone.

## Reuse and change contract

Reuse Node 26 built-ins, the maintained `@earendil-works/pi-ai` 1.3.0
OpenAI-completions adapter, Moguri's SDK/service/worker, TypeBox and existing
encrypted event store. These libraries retain their MIT/component notices.
The external DS4 engine is MIT-licensed and is not bundled, changed, installed
or upgraded. No weight or encoder download is introduced.

The only production correction is cache-category presence: DS4 reports
`usage.prompt_tokens_details.cache_write_tokens`. The maintained adapter
already maps that value and subtracts cache reads and writes from plain input.
Moguri now recognizes its presence, including an explicit zero. Missing,
negative, fractional, non-finite or nonnumeric values do not become known zero.
Cache subsets are never added twice to the reported total.

No public API, configuration field, durable event/schema, migration or protocol
version changes. Protocol94 retains the existing `model.completed`, usage,
stream-presence and budget records. Historical observations are not rewritten.
The same typed usage reaches SDK, CLI/TUI and desktop; neither client owns a
second provider transport. Restart/recovery continues to retain unknown holds
without replay or deletion. A previously running older worker must settle or
be explicitly restarted before expecting corrected observations.

## Prerequisites, 2026-11-07

The clean worktree started at merged [#56](https://github.com/mbianchidev/moguri/pull/56),
`2f5eabe2766927f4844bb66f280fc8f882170fc8`. Missing development dependencies
were restored with `npm ci`; its audit reported zero vulnerabilities.

| Generated prerequisite | Result / measurement |
| --- | --- |
| Node selected by repository scripts | 26.12.0 |
| Phase 0 OAuth/streaming | PASS, 1,076.98 ms; cancellation 31.57 ms |
| SQLite WAL/crash rollback/rebuild | PASS, 63.35 ms; 1,000 events; append p95 0.0485 ms |
| Owned macOS PTY cancellation | PASS, 152.09 ms; zero known survivors |
| OpenTUI | PASS, 60 updates; 17.13 ms/update |
| Hidden Electron | PASS, startup 210.23 ms; RSS 448.03 MiB; frame 8.25 ms |
| Bounded filesystem/Git | PASS, 2,000 generated files; 95.62 ms |
| Configured local provider primitive | PASS, 40.63 ms; tools, keyless SSE, usage and cancellation |
| Working-window/thinking primitive | PASS, 54.15 ms; ignored generic-completions effort remains blocked |

The stock Phase 0 script's historical unavailable/live/native/quality rows
remain exclusions, not new physical failures or passes. Installed executable
presence does not qualify those separate transports. None of these generated
prerequisites loads the user's model or supplies personal credentials.

## Actual installed identities and contract

The user identified the installation guide in Downloads. Its exact locations
were inspected, rather than scanning hosts or crawling unrelated files:

| Input | Actual observation |
| --- | --- |
| Runtime checkout | `$HOME/ai-workspace/ds4`, clean source `b3f50180ec2c7324892be1f50bc83555ccb8d5e7` |
| Executable | `ds4-server`, 3,280,840 bytes; SHA-256 `08bb90a4c3eff7f13fa2b7fff9f51e2a89c0643b79f63392e5720b1b4d189544` |
| Selected model | `$HOME/Models/dwarfstar/DeepSeek-V4.1-Flash-1017-IQ2_XXS-Q2_K-imatrix.gguf`, 365,713,686,528 bytes |
| Bounded model metadata | GGUF v3; `general.architecture=deepseek41`; `general.name=DeepSeek V4.1 Flash`; only the first 64 KiB read |
| Engine | Native Metal, Apple M5 Max; explicit SSD streaming; Engram disk-only |
| Model catalog | `deepseek-v4.1-flash`, `owned_by=ds4.c`, text input/output; one loaded model, not a guessed alias |
| Server allocation tested | 32,768 context tokens; 1,024 default/output test ceiling |
| Connection | Task-owned `127.0.0.1:18647`; numeric loopback HTTP; no Authorization header or persistent DS4 KV cache |

The model's whole-file SHA-256 was not recomputed. The installation guide's
expected artifact hash is not relabelled as a newly measured digest. Model
selection is tied to the exact supplied file, its observed size/metadata and
the engine's loaded-model catalog, not a display-name capability guess.

The actual contract advertises `GET /v1/models`, streamed
`POST /v1/chat/completions`, tools, `max_tokens` and `reasoning_effort`.
The maintained adapter already preserves `reasoning_content` and opaque tool
IDs across ordinary/tool history, requests final streamed usage and performs
no retry (`maxRetries: 0`). Moguri's approvals still govern generated-file
effects. Discovery never runs inference.

DS4's numeric and named thinking controls are not qualified Moguri generic-local
options. The tested adapter leaves thinking server-controlled and exposes no
effort levels. An explicit unsupported override fails while retaining the
draft/model/window; it is not silently ignored or mapped to another effort.
The exact working ceiling remains local admission, not a server-allocation
change or a claim about the model's natural maximum. No vision encoder was
selected; `imageInput` remains false.

## Live baseline evidence

The actual protocol94 SDK/service/worker baseline, worker SHA-256
`e5740ed0dfc76f956a772fef0f286b1e581257bb793d227ac38cf40d6b9557ec`,
produced these results with generated prompts and temporary project/state:

| Actual Moguri operation | Result / measurement |
| --- | --- |
| Ordinary generated marker | Completed, 41,530.78 ms; 21 reported output tokens; total 2,183 |
| Ordinary history follow-up | Completed, 3,922.48 ms; exact earlier marker; total 2,247 |
| Shared working window | Exact 32,767 accepted; unsupported `low` rejected without inference |
| Tool discovery, policy-authorized new-file write and final answer | Completed, 124,304.97 ms; three actual worker model steps; totals 2,454 / 6,201 / 6,498; exact generated file bytes checked |
| In-flight local cancellation | Stopped, 36.11 ms after stop; actual worker outcome `aborted`; usage remained unknown/null |

All model steps retain source `local`, provider `local.ds4-qualification`,
the exact API ID and Local Env. Estimated, provider-reported and billed USD
remain separate and null without rates/billing evidence. DS4's separate cache
write counts explain plain input being zero; this is not zero prompt usage.
The baseline exposed the incorrect cache-write-presence flag, and a generated
zero-write regression reproduced `null !== 0` before the production correction.
Factory Manual can permit bounded file writes by policy; it is not a promise
that every file operation opens a confirmation. The live probe therefore
configures an explicit `write_file: ask` rule in its private profile and requires
one actual inspected approval before qualifying its write. A run without that
review is not an explicit-review pass, even if its policy-authorized model turn
completed.

Short markers arrived as one real visible stream delta before model completion;
normalized reasoning/output streams had multiple events. This does not promise
one visible delta per token or infer throughput from chunk count. Cold prefills
and prefix rebuilds were materially slower than an ordinary continued turn.
The 120-second per-model-request deadline remained unchanged; a larger/colder
request may fail explicitly, retain its original context/accounting and require
a user-controlled retry. No automatic timeout expansion is introduced.

Generated regressions cover the real catalog/SSE/reasoning/cache/tool shape,
explicit cache-write zero, opaque and malformed IDs, truncated tool output,
missing usage, missing terminal finish, endpoint HTTP failure and cancellation
with a saved draft. Missing/failed completion holds capacity as unknown; it is
not a free call. These fault fixtures do not load weights or claim a live outage.

## Reproduce without another download

Use only the already installed binary and selected model. Do not start a second
DS4 process if an existing user-owned instance is running. In its own terminal:

```sh
DS4_HOME="$HOME/ai-workspace/ds4"
MODEL="$HOME/Models/dwarfstar/DeepSeek-V4.1-Flash-1017-IQ2_XXS-Q2_K-imatrix.gguf"
cd "$DS4_HOME"
./ds4-server --metal -m "$MODEL" --ssd-streaming \
  --host 127.0.0.1 --port 8000 --ctx 32768 --tokens 1024
```

Do not add CORS, expose another interface, relax memory guards or substitute a
CPU backend/model. Keep the selected model's storage mounted. The server owns
its inference memory; Moguri does not manage its lifetime or cache policy.

Inspect `http://127.0.0.1:8000/v1/models`, then review this array in **Settings /
Models / Configured local models / Local model endpoints**:

```json
[{
  "id": "ds4",
  "name": "DwarfStar DeepSeek V4.1 Flash Q2",
  "enabled": true,
  "baseUrl": "http://127.0.0.1:8000/v1",
  "auth": "none",
  "models": [{
    "id": "deepseek-v4.1-flash",
    "name": "DeepSeek V4.1 Flash Q2",
    "contextWindow": 32768,
    "maxTokens": 1024,
    "imageInput": false,
    "toolInput": true
  }]
}]
```

Select that exact source and **Env Local / Manual**. The 1,024-token ceiling is
the bounded live test setting, not the model maximum or a guarantee that longer
reasoning will fit. An overfull/incomplete response stays partial with its
original data; increase explicit limits only within the actual server allocation.
No token placeholder authenticates DS4. No personal profile/default is changed
by the compatibility probe.

From a built Moguri source checkout, opt in explicitly:

```sh
npm run build
npm run qualify:ds4 -- --live \
  --base-url http://127.0.0.1:8000/v1 \
  --model deepseek-v4.1-flash --context-window 32768 \
  --max-tokens 1024 --tools
```

The probe creates its own encrypted state, generated Home/project and short,
explicitly acknowledged lab system prompt. It never connects a personal account,
opens a personal app or starts/stops the supplied server. `--tools` permits only
the exact one-file generated write after checking its actual approval request;
unexpected requests fail without permission. It observes genuine event-stream
output, ordinary follow-up, shared controls and live cancellation, then removes
its own state/files/workers. It reports failures and unconfirmed cleanup rather
than success-shaped output. Stop only your own server in its terminal afterward.
