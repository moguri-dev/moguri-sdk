# Metadata-only OTLP export

This is the bounded, user-approved traces-and-metrics cut of
[#23](https://github.com/mbianchidev/moguri/issues/23), not a new accounting
engine, hosted telemetry service, content recorder or auto-instrumentation
framework. The service, shared SDK, CLI/TUI and desktop review path are
implemented. Primitive and focused integration evidence are recorded below;
final frozen release qualification remains separate.

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

The first cut supports OTLP/HTTP JSON to an explicit HTTPS collector origin,
or literal loopback HTTP for a user-owned local Collector. It appends
`/v1/traces` and `/v1/metrics`. Userinfo, custom paths, query strings, fragments,
redirects and exporter credentials/headers are unsupported. No OTEL environment
variables, resource detectors, global providers, inbound trace context or
baggage are adopted. Nothing connects or resolves a destination while disabled
or merely reviewing configuration.

Only allowlisted operational attributes leave the service: finite role, Env,
operation family and actual outcome/accounting categories; known token/cache
counts, observed timings and separately labelled estimates. Known public model
catalogue identifiers may be included; configured/private names and MCP server
or tool identifiers are not presumed public. No prompt, response, reasoning,
source/attachment body, tool argument/result, terminal data, raw exception,
diagnostic log text, profile/project/session name, path, repository URL,
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

## Bounded failure and recovery

The intended hard limits are 128 queued spans, 32 spans per batch, 64 KiB per
request, 4 KiB per response, one request in flight per profile, a 1,500-ms
request deadline, a 1,000-ms batching interval and a 2,000-ms shutdown drain.
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

Protocol/schema 97 adds a profile-owned `telemetry.export_configured` event and
`otlp_export_schema=1`. Migration must preserve genuine protocol-96 background
and protocol-95 inbox provenance, original ciphertext, grants, queues, drafts
and unknown accounting. Missing/premature markers and future export history
relabelled as older state must fail without resetting data.

## Reused libraries and Phase 0

The compatible maintained OpenTelemetry set is pinned to API 1.10.0,
SDK trace/metrics/resources 3.1.0, OTLP transformer 0.301.0 and semantic
conventions 1.45.0, all Apache-2.0. The official JSON codecs and SDK data types
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

## Coverage and remaining qualification

The initial process boundary is the authoritative control-plane record stream,
including accepted qualified worker outcomes. It is not instrumentation inside
SSH peers/SendBox guests, arbitrary HTTP libraries, model SDK internals or
native processes. There is no diagnostic-log export or content capture.
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
