# Live session analytics

**Dashboard / Analytics** shows what running and recent sessions are doing,
turn by turn, on a zoomable timeline. It is a live monitor, not history: the
data lives only in the local service's memory and is short-lived by design.

## What it shows

- **Stats**: live sessions (working or waiting for you), working sessions,
  projects, the Moguri service process's CPU and resident memory, and enabled
  MCP servers. CPU and memory describe the service process only, not agent
  child processes or the whole machine.
- **Sessions**: Live (a turn is running or a question/approval is waiting) and
  Recent (activity inside the window), with a text filter.
- **Timeline**: one row per lane, an overview strip, a time ruler and a tokens
  out row. Instant events are dots, timed spans are bars, crowded markers
  collapse into a count you can click to zoom.
- **Event detail**: lane, status, start, duration, tool, model, token reports
  and a short preview of the prompt, answer, arguments or result.
- **Footer**: prompts, commands, MCP calls, edits, failures, reported tokens
  in and out, and the models used.

| Lane | Source events |
| --- | --- |
| Prompts | `turn.started`, `steer.applied`, `question.answered` |
| Answers | `model.started` / `agent.step_started` to `model.completed` / `agent.message` |
| Thinking | Reasoning text on the completed message |
| Commands | `run_command`, `command_job`, `run_script` and harness shell tools |
| Files | File and document read, search, edit and write tools |
| Web | `web_fetch`, `web_search`, page and browser tools |
| Tools | Everything else; direct MCP and `mcp_gateway` calls count as MCP |
| Context | Compaction, context switches, control turns, stopped or failed turns |

Token totals only sum provider reports. Calls without a report are counted
separately as unreported; a gap is never shown as zero usage. Harness
cumulative usage (`agent.usage`) is not split into per-call bars.

## Controls

Scroll or pinch zooms around the pointer, dragging pans, dragging the ruler
zooms to that range and double-click fits. With the timeline focused, ←/→
step through events, F fits, L follows live, + and - zoom and Esc clears the
selection. Find events dims everything that does not match and Enter jumps to
the next match. Lane chips hide or show lanes.

## Retention

Analytics is shaped like OpenTelemetry spans (one lane per span kind, start
and end, model and token attributes), but it is **not** an OTLP pipeline and
nothing is sent to a collector:

- `LiveAnalytics` (`apps/service/src/live-analytics.ts`) observes events the
  controller just committed. It appends no events, writes no files, adds
  nothing to model context and is never replayed.
- On start it reads only the last window of retained events. A restart clears
  everything else.
- A timer prunes every 30 seconds. Events older than 60 minutes are dropped,
  idle sessions outside the window are forgotten, and archived or deleted
  sessions are dropped immediately. Active sessions keep their row even when
  their old events age out.
- Caps: 40 sessions (idle ones are dropped first), 2,000 events per session
  (oldest finished events first) and 240-character previews.
- Clients poll every 2 seconds while the page is open and visible. They keep
  no copy after the view closes.

The limits are `LIVE_ANALYTICS_LIMITS` in
`packages/protocol/src/analytics.ts`. Exporting long-lived traces or metrics
remains the separate, opt-in, metadata-only
[OTLP export](otlp-export.md).

## API

`analytics.overview` returns the stats and session summaries;
`analytics.session` returns one session's events and totals, or `null` when
the session is gone, archived or has no recent activity.

```ts
const overview = await sdk.analytics.overview();
const detail = await sdk.analytics.session(overview.sessions[0]!.sessionId);
```

CLI: `moguri dashboard analytics [SESSION_ID]`. Slash: `/dashboard analytics
[SESSION_ID]`. The TUI F7 dashboard includes the overview.
