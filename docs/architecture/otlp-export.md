# Metadata-only OTLP export

This is the bounded, user-approved OpenTelemetry cut of
[#23](https://github.com/mbianchidev/moguri/issues/23), not a new accounting
engine, hosted telemetry service, content recorder or auto-instrumentation
framework. Protocol 97 delivered traces and metrics; protocol 111 adds an
opt-in diagnostic log signal, secret-backend credential headers, finite
failure outcomes, correction handling, measured overhead and the process/Env
coverage matrix below. The service, shared SDK, CLI/TUI and desktop review
path are implemented. Final frozen release qualification remains separate.

## Authority and privacy contract

The existing append-only execution, budget and operation records remain
authoritative. The exporter observes committed records after recovery; it
cannot reserve/release budget, start work, change outcomes or replay history.
Model, turn and tool/MCP spans are diagnostic projections. Metrics are gauges
of the existing canonical budget/operation totals, not another accumulated
usage ledger. Estimated, provider-reported and billed costs remain distinct;
unknown values are omitted or explicitly classified, never fabricated zeroes.

Configuration is off by default and belongs to one immutable authenticated
profile. A reviewed update binds that profile, exact configuration revision,
collector origin, trace sampling ratio and versioned metadata disclosure.
Changing profiles does not move configuration or pending exports. Newly
created profiles start disabled. The sender runs on the Local control plane
even when an original accepted record describes Remote or Sandbox work.

Export uses OTLP/HTTP JSON to an explicit HTTPS collector origin, or literal
loopback HTTP for a user-owned local Collector. It appends `/v1/traces`,
`/v1/metrics` and, when reviewed, `/v1/logs`. Userinfo, custom paths, query
strings, fragments and redirects are unsupported. Credential headers are
described [below](#credential-headers-protocol-111). No OTEL environment
variables, resource detectors, global providers, inbound trace context or
baggage are adopted. Nothing connects, resolves a destination or reads the
secret backend while disabled or merely reviewing configuration.

Only allowlisted operational attributes leave the service: finite role, Env,
operation family and actual outcome/accounting categories; known token/cache
counts, observed timings and separately labelled estimates. Known public model
catalogue identifiers may be included; configured/private names and MCP server
or tool identifiers are not presumed public. No prompt, response, reasoning,
source/attachment body, tool argument/result, terminal data, raw exception,
service log text, profile/project/session name, path, repository URL,
credential or personal identifier is collected for export.

Trace/span aliases are scoped to a fresh exporter epoch and are not exported
source identities or authority. They correlate existing owned record links;
they do not inject context into a model or worker. Sampling applies to traces,
not the canonical totals. Metrics have fixed names and bounded categorical
dimensions, never session/call/trace IDs. Repeated gauge snapshots and late
canonical corrections cannot become additional billed calls.
Each exporter epoch also has a random opaque `service.instance.id`, not a
profile identifier or hostname. Separate profiles targeting the same Collector
therefore do not overwrite indistinguishable gauge series.

## Diagnostic logs (protocol 111)

The log signal is off unless the actual user reviews `logs: true`; a
disclosure-1 configuration retained from protocol 97 never sends logs. Each
log record is a projection of an exported span, never a copy of service
console output: one record when a turn, model call, tool or MCP attempt ends
with a non-success outcome, and one `corrected` record when a canonical record
changes after its span was exported. Bodies are fixed templates such as
`Model call ended with outcome failed.`; attributes are limited to Env, role,
outcome, operation family/actor/finite diagnostic, accounting status and
`error.type`. Every record carries the trace and span ID of its span. Logs are
not sampled; their trace flags say whether the correlated trace was sampled.
Receiver, provider and exception text never enters a log body or attribute.

## Failure outcomes and corrections (protocol 111)

Provider finish reasons map to the shared outcome vocabulary: `stop`,
`toolUse` and `length` are `completed` (the reason is kept as
`gen_ai.response.finish_reasons`), `error` is `failed` and `aborted` is
`stopped`. Spans for `failed`, `partial` and `unconfirmed` outcomes get status
ERROR and a finite `error.type` equal to that outcome. Stops, denials and
unknown results stay status UNSET without `error.type`, so cancellation is not
reported as an error and unknown is not reported as success. Operation records
also export their finite `moguri.operation.diagnostic`.

Late usage, cache recovery and reconciled operation outcomes re-record the
same canonical entry. The exporter remembers up to 4,096 exported span keys per
epoch: a re-recorded entry with the same exported fields is ignored, and a
changed one becomes a `corrected` log record instead of a duplicate span.
Metrics are still recomputed from canonical totals, so corrections never add
calls or tokens.

## Credential headers (protocol 111)

A review may name up to eight credential headers (lowercase, unique, and never
a transport header such as `content-type`, `host` or `proxy-*`). Values are
stored only in the profile's secret backend
(`dev.moguri.profile.<id>.telemetry`), keyed by the exact collector origin and
header name. Changing the collector therefore needs the values again; another
profile cannot read them. Set values through Settings / General, the TUI's
masked `/otlp credential set ENDPOINT NAME` input, or
`moguri telemetry otlp credential set ENDPOINT NAME` with the value piped on
stdin. Values never enter events, reviews, status, logs, drafts or command
lines. If any configured value is missing or the backend is locked, the
request is not sent and status reports `credential`; no unauthenticated
fallback is attempted. Status shows only whether each value is stored.

## Bounded failure and recovery

The intended hard limits are 128 queued spans, 32 spans per batch, 128 queued
log records, 32 log records per batch, 64 KiB per request, 4 KiB per response,
one request in flight per profile, a 1,500-ms request deadline, a 1,000-ms
batching interval and a 2,000-ms shutdown drain.
There are no automatic retries or disk spools. Saturation, rejected/partial
responses, timeout, invalid responses and shutdown loss are visible in
service-owned status without retaining receiver response text.

Export never blocks inference or its commit path. Disable/change cancels the
old sender and prevents admission under a stale review. A service restart
starts a new diagnostic epoch, does not backfill individual records, and
never repeats model/tool effects. Current profile aggregate gauges can include
older canonical totals; this is disclosed separately from live trace coverage.
HTTP acceptance is not proof of backend ingestion/searchability or exactly-once
delivery. Previously admitted in-flight metadata cannot be unsent.

Protocol/schema 111 keeps that event and adds `otlp_signals_credentials_schema`:
new reviews use disclosure 2 and record `logs` and `headers`; disclosure-1
history projects with logs off and no headers. Disclosure-2 history, or logs or
headers on disclosure 1, cannot be relabelled as pre-111 lineage.

Protocol/schema 97 adds a profile-owned `telemetry.export_configured` event and
`otlp_export_schema=1`. Migration must preserve genuine protocol-96 background
and protocol-95 inbox provenance, original ciphertext, grants, queues, drafts
and unknown accounting. Missing/premature markers and future export history
relabelled as older state must fail without resetting data.

## Reused libraries and Phase 0

The compatible maintained OpenTelemetry set is pinned to API 1.10.0,
SDK trace/metrics/resources 3.1.0, OTLP transformer 0.301.0 and semantic
conventions 1.45.0, all Apache-2.0. Protocol 111 pins the transformer's own
`@opentelemetry/sdk-logs` 3.1.0 (Apache-2.0, already in the lockfile) as a direct
dependency for its `ReadableLogRecord` type; logs reuse the official
`JsonLogsSerializer` and `SeverityNumber`, with no logger provider or global
registration. The official JSON codecs and SDK data types
are reused with an explicit bounded Node HTTP sender, rather than an
environment-aware auto-configuring exporter. The 0.x transformer and GenAI
conventions remain version-pinned/development surfaces; Moguri-specific
provenance and estimated-accounting fields use `moguri.*`. Existing Node,
pi-ai, React, OpenTUI and TypeBox retain their MIT notices; SQLite remains
public domain.

Before feature integration, `npm run spike` measured six available primitives:
generated Copilot HTTP/cancellation passed with six requests and 31.40-ms
cancellation; SQLite passed with 1,000 events, 0.053-ms append p95 and 0.519-ms
rebuild; known-group PTY cancellation passed in 151.96 ms with zero survivors;
60 OpenTUI updates averaged 17.12 ms; hidden Electron was ready in 267.31 ms,
444.14 MiB with 8.09-ms scroll frames; generated 2,000-file search/Git status
took 1.24/7.39 ms.

That general probe still labels its unavailable live provider, Rust/Linux,
signing/notarization, native, quality/decision, configured SSH and wider initial
checkpoint gates FAIL. Those probe limitations are not release acceptance or
claims that separately qualified execution capabilities are absent.

`npm run spike:otel` exercises an actual generated pi-ai worker call and
unchanged canonical accounting through the official JSON serializers. On
pinned Node 26.12.0 it passed in 457.99 ms: one actual call/42 reported tokens,
830-byte trace and 527-byte metric requests; 1,000 serialization pairs took
2.98 ms; a stalled request cancelled in 53.03 ms; no redirect, private marker,
new model call or accounting mutation followed export. System Node 26.13.0
also passed separately. All HTTP used an owned loopback receiver, never a
personal account or external collector.

## Process and Env coverage matrix (protocol 111)

Export observes committed control-plane records; it does not instrument other
processes. Each row states what a collector receives for work in that place.

| Process / Env | Traces | Metrics | Logs | Context propagation |
| --- | --- | --- | --- | --- |
| Local control plane (service) | Turn, model, tool and MCP spans from committed records | Canonical gauges | Outcome and correction records | Not applicable; no inbound context is adopted |
| Local model worker (`@earendil-works/pi-ai`) | Model span from the accepted accounting record | Included | Included | None injected into the worker or provider request |
| Local tool, MCP and script processes | Tool/MCP span from the operation record | Included | Included | None |
| Sandbox (SendBox guest) | Spans from accepted guest outcomes, `moguri.env=Sandbox` | Included | Included | Not qualified: no in-guest instrumentation or propagation |
| Remote (pinned SSH peer) | Spans from accepted peer outcomes, `moguri.env=Remote` | Included | Included | Not qualified: no in-peer instrumentation or propagation |
| Claude Agent / Codex Agent harnesses | Spans only where the harness records accounting/operations | Included | Included | None into the external CLI |
| Desktop and TUI clients | Not instrumented | None | None | None |

In-guest and in-peer instrumentation stay an explicit gap: the exporter runs
only in the service, and the worker and bridge bundles change only through the
shared protocol-111 constant, so no native or SSH bridge qualification is
claimed for telemetry. Adding them would need their own review of
what crosses the boundary, new payload qualification and a decision that
trace context may enter those processes; it would still never grant
authority. Kupo, compound roles and compaction appear as model spans with
their role attribute, because their calls are ordinary accounted model calls.

## Measured overhead (protocol 111)

`npm run spike:otel-overhead` runs 40 generated loopback turns per mode on
pinned Node 26.12.0 (darwin-arm64), each in a fresh project-free chat, in
off/on/off/on blocks with traces, metrics and logs enabled:

| Measure | Result |
| --- | --- |
| Synchronous `observe()` on the commit path | 0.016 ms (off) / 0.104 ms (on) mean per turn; p95 0.127 ms |
| Turn wall time, drift-adjusted export offset | -7.9 ms (no measurable cost; turns grew about 2 ms each from profile size) |
| Raw turn wall time p50 | 430 ms (off) / 498 ms (on), dominated by that drift |
| Requests and bytes per turn | 0.85 requests, 7.2 KB (spans and gauges; successful turns emit no logs) |
| Encode a full 32-span + 32-log batch and gauges | 0.091 ms |
| Losses | 80 spans accepted, 0 dropped, 0 failed requests |

These are generated loopback numbers on one machine, not a release budget.
Network time is background work and never blocks inference or commits.

## Coverage and remaining qualification

The process boundary is the authoritative control-plane record stream,
including accepted qualified worker outcomes. It is not instrumentation inside
SSH peers/SendBox guests, arbitrary HTTP libraries, model SDK internals or
native processes (see the matrix above). Content capture stays out of scope.

The protocol-111 suite (`tests/otlp-signals.test.ts`, extended
`tests/otlp-commands.test.ts`) proves reviewed log/header disclosure and
transport-header refusal; a controlled model failure exported as an ERROR span
with `error.type` and one correlated fixed-template log; a failed tool's ERROR
span and log under its model call without its path or error text; a stopped
turn (UNSET, INFO log) next to a concurrent completed turn in a separate trace;
late corrections as one `corrected` log with no duplicate span or accounting
change; logs never sent without review; credential headers sent only with
this profile's stored values for the reviewed origin, a missing value blocking
the request, another profile and a moved collector receiving nothing, and no
value in events, status or records; disclosure-1 projection and malformed
disclosure-2 refusal; and stdin-only CLI credential entry.
Per-profile review, UI/SDK parity, privacy canaries, queue saturation,
outage/partial response, cancellation/disable, late corrections, migration,
restart and packaged entrypoints require the integration regression suite
before this document can claim completed delivery.

The focused generated suite currently proves real model/tool/MCP records,
parent/child trace links, canonical gauge equality, private-marker exclusion,
profile isolation, unchanged accounting under outage, no automatic retry,
zero trace sampling with unknown usage, queue saturation (128 admitted /
372 dropped from 500 observations), the real 1,500-ms request and 2,000-ms
shutdown bounds, disable during an in-flight request, and retained opt-in
without paid/history replay after restart. Malformed, wrong-signal, partial
and non-JSON receiver acknowledgements never become successful span receipts.
Migration tests retain original ciphertext, unsent drafts and unknown holds,
including an interrupted 96-to-97 transaction. Hidden desktop tests exercise
actual review/confirmation, stale edit preservation and saved-state exit.

## User-owned Collector example

Run an OpenTelemetry Collector you administer on literal loopback port 4318
with its supported `otlp` HTTP receiver and a locally reviewed exporter/backend.
For a bounded local-only diagnostic, a current Collector distribution that
includes the `debug` exporter can use. The official **otelcol 0.165.0**
Darwin-arm64 archive was checksum-verified, its actual `otlp` receiver reports
stable traces/metrics, and its actual binary validated the configuration shape:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
exporters:
  debug:
    verbosity: basic
service:
  telemetry:
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      exporters: [debug]
```

Use `otelcol validate --config collector.yaml` with that pinned distribution;
Moguri does not install or launch a Collector. Debug output is for this bounded
local diagnostic, not a recommended persistent backend. Review your Collector's
retention, redaction and exporter credentials separately, then enable Moguri
through its exact profile review. This example does not expose a network listener
or authorize a third-party hosted destination by default.

The generated `scripts/qualify-otlp-collector.ts VERIFIED_BINARY` check runs
an explicitly supplied 0.165.0 binary on an owned ephemeral loopback port,
not a system installation. It passed in 1,426.04 ms with one actual generated
pi-ai call, two receiver-acknowledged spans, decoded model and canonical gauge
output visible in the actual debug exporter, zero private markers and confirmed
normal Collector shutdown. Its detailed debug mode is confined to that generated
diagnostic; the local example above uses basic verbosity.

## Frozen protocol-97 delivery evidence

Executable/SDK/worker source is `932b750`; `3c3644e` changes only the
settings-search regression expectation to include the new export controls.
All 463 build entries and all other tracked inputs were rehashed unchanged.
Documentation-only receipt additions do not relabel an older executable cut.

| Surface | Actual result |
| --- | --- |
| Focused export/accounting/migration/native-exit set | 68 passed, zero failures |
| Full source invocation at `932b750` | 10,701 cases: 10,671 passed, 29 skipped, one outdated discovery expectation failed; 7,382.85 s |
| Corrected discovery suite at `3c3644e` | Both tests passed, including explicit OTLP/OpenTelemetry/collector search assertions |
| Complete hidden desktop suite | 393 passed, five skipped, zero failures; 14.1 min |
| Independently installed packed SDK | All entrypoints/types, audited install, actual runtime/worker OTLP export and restart passed |
| Actual ad-hoc app/runtime verifier | Passed, including actual bundled OTLP codecs, original PTYs, restart and ordinary shutdown |
| Actual packaged desktop | 17 startup/background/OTLP cases plus all nine deferred-opening cases passed on the same immutable app |
| Fresh physical native qualification | All eight gates passed in 63.05 s; owned guests confirmed absent |
| Production ZIP consumer/private read-only DMG | Passed; 115.73-s ZIP staging and exact native geometry/icons/pixels/bundle identity |
| Root, packed consumer and fresh Linux workload audits | Zero vulnerabilities |

The source receipt remains an invocation with one failed expectation. That
expectation-only correction and its complete two-test replay, together with the
verified unchanged inputs for every other case, qualify the corrected test set;
this is not presented as a fresh all-green single full invocation.
The obsolete expectation was never a production/export failure or a weakened
guard. The earlier red tests, initial renderer-busy fixture read and unacknowledged
desktop teardown remain diagnostic receipts, not substituted passes.

The final actual Collector 0.165.0 replay passed in 1,469.45 ms, with the
unchanged final qualifier, one generated model call and two acknowledged spans.
Its official Darwin-arm64 archive SHA-256 is
`1d68c0f41011a571199cd9489b04dd554e12091cacba862803a5c8ef0004d32a`.
No system Collector, personal credentials, microphone or user app was used.

The fresh no-cache protocol-97 Linux-arm64 image is
`docker.io/library/moguri-worker@sha256:4fd106a748f6dc9754f84c8867f4368dcabcd7adc1ce7cabaee002e84e955c11`.
It verifies pinned Node 26.12.0, exact worker/bridge bytes, native PTY and
locked dependencies; producer time was 39,457.20 ms. The current physical report
is `.native/qualification/current-sendbox-BazS2o/qualification.json`, SHA-256
`e4c57397842d925cbbb507812c999bd38c2f67305257da5dc0a2739f82723e73`.
This does not qualify every separate Sandbox matrix cell, a Linux release,
hosted CI, model quality, live paid inference or notarization.

Exact ad-hoc, non-notarized artifacts are under
`release/qualification-builds/otlp-exit-3c3644e/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 882,743,275 | `b2a6faa3446bac77c16066fd2cd1ed2f79700356ccbc7173403c1da5d901e9ff` |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 897,415,443 | `ce3337782dbbd3dc5f0c8bd13fc11b09da1241c09343dbec746b9e3bf79b9220` |
| `Moguri-0.31.0-alpha.1-macos-arm64.manifest.json` | 536 | `aaba484ee7360d339308713f9d8d0ea355ffaed47b1ae9d3d48b42d3a6e71eeb` |

The manifest retains ZIP and signed bundle-tree SHA-512. Full source/test/build,
SDK archive and log seals are retained with the session delivery receipts.
The package's one/four-console Electron shell used 557.25/563.61 MiB, below the
unchanged 600-MiB shell budget; service/broker-inclusive totals were separately
1,049.56/1,057.44 MiB. Packaged warm reopening authenticated in 421.98 ms;
issue-heavy cold readiness was 1,868.09 ms. The real unconfirmed deadline was
60,576.51 ms followed by explicit original-owner reconnect/draft save in
132.76 ms. The 700/1,000/1,500/3,000-ms regression budgets remain unchanged.

Existing warnings remain disclosed: experimental Node FFI, large renderer
chunks, transitive `whatwg-encoding`/`node-domexception` deprecations, and
Electron Packager skipping the newer `.icon` format while verifying the actual
`.icns` mascot. Generated deferred-opening roots report unavailable bundled
Sandbox distribution separately; they are not the physical native acceptance
root. Install-script approval in the external SDK consumer was explicit before
rebuild/audit. None of these warnings was hidden by raising a budget.

The original personal 90-second initialization cause remains unreproduced.
The installed personal application was not replaced. Before a user-initiated
Quit/update, preserve any older RAM-only opening draft; existing authenticated
service-upgrade review remains required. Export is disabled through migration
unless this actual profile explicitly reviews and enables it.
