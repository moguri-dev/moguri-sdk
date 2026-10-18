# Initial event catalog and protocol

Every durable event carries `id`, `seq`, `schema_version`, `timestamp`,
`profile_id`, `project_id`, `work_item_id`, `session_id`, `turn_id`, `step_id`,
`parent_event_id`, `correlation_id`, `event_type` and a typed `payload`.
Unused scope fields are null in checkpoint 1.

| Event family | Payload and invariant |
| --- | --- |
| `project.added` | Canonical project identity/path. No filesystem access is implied for an agent. |
| `session.created`, `session.configured` | Title/controls and explicit configuration changes. Running turns cannot be rewritten. |
| `session.archived`, `session.restored` | Non-destructive lifecycle changes. Active/queued sessions cannot be archived. |
| `session.blocked`, `session.resumed` | Admission diagnostic or explicit user resumption. Resumption does not prove prior cleanup. |
| `draft.saved` | Text and authorized snapshots; increments the draft revision. |
| `queue.enqueued`, `queue.edited`, `queue.removed`, `queue.reordered` | Exact unclaimed message mutation, each with a queue revision. |
| `queue.delivery_changed` | Explicit conversion of an unclaimed steer into a new queued turn. |
| `turn.started` | Admitted item, controls and allowed-env policy revision; claims the item once. |
| `steer.applied` | One item enters its owning turn at a safe model-step boundary. |
| `model.started` | Step and actual fixed model. Creates an unknown, in-progress accounting entry. |
| `assistant.delta` | Durable streamed text for that step, batched by the worker. |
| `model.completed` | Public message, normalized-context blob digest and actual/unknown usage. Does not imply overall turn success. |
| `tool.requested` | Exact declared tool, approval UUID and policy revision. |
| `tool.decided` | Allow/deny, exact request UUID and real `user`/`policy` actor. No model approval actor exists in this checkpoint. |
| `tool.started`, `tool.output`, `tool.completed` | Approved execution, bounded output, explicit actual/denied/stopped/failed/partial/unconfirmed result. |
| `process.started` | Owned tool-call ID, PID and process group. |
| `turn.stop_requested`, `turn.stop_acknowledged` | Distinct cancellation transitions. Acknowledgement alone is not successful cleanup. |
| `turn.finished` | Completed/stopped/failed/partial, with actionable diagnostics. Unsettled model usage and process cleanup remain unknown. |
| `policy.updated` | New user-only allowed-env revision and exact Local turns permitted to finish. |
| `provider.changed` | Non-secret connection status/diagnostic. Device codes and tokens are not durable events. |

## HTTP commands

The service binds to a random `127.0.0.1` port. Every HTTP route requires
`Authorization: Bearer <private token>`, exact loopback Host and an approved
or absent Origin. There is no CORS allowance.

- `GET /v1/health`: protocol and service identity.
- `GET /v1/snapshot`: authoritative current profile projection.
- `POST /v1/commands`: TypeBox-validated `{ id, profileId, command }`.

The command union covers project/session creation, configuration,
archive/restore/resume, draft/snapshot attachment changes, queue admission and
mutation, explicit steer conversion, exact approval responses, stop, provider
login/cancel/logout/refresh and allowed-env policy. Invalid data, stale revisions,
expired approvals, unavailable capabilities and reused command IDs have explicit
error codes; they are not success-shaped empty responses.

## WebSocket

Connect to `/v1/events`, then send:

```json
{"type":"authenticate","protocolVersion":1,"token":"<private token>","after":0}
```

Tokens never enter the URL. The server rejects unauthenticated, malformed,
wrong-version, unexpected-Origin and wrong-Host connections. Authentication
must complete within five seconds.

The server replays missed `event` frames and sends `ready` with a current
snapshot. Live events retain sequence numbers; `invalidate` refreshes ephemeral
provider setup state. Slow clients are closed with a reconnect instruction,
not allowed unbounded buffering. The SDK reconnects, resolves rotated private
connection metadata and resynchronizes without resending mutations.

The desktop renderer uses the same protocol through a same-origin
`moguri://app` HTTP proxy and an authenticated loopback WebSocket. Its sandboxed
preload exposes only connection discovery, explicit directory/file pickers and
explicit HTTPS opening. Node integration is disabled; navigation, new windows,
iframes and arbitrary permission requests are blocked.

## Honest accounting

Successful calls retain provider-reported token telemetry when supplied.
Empty/preliminary telemetry, aborted requests and interrupted workers are
conservatively unknown, never zero. Request wall time is measured separately;
active-generation throughput is not claimed. All Copilot dollar fields remain
null because catalog API prices are not a subscription invoice.
