# Decision-provider prerequisite

Status: generated transport/schema primitive only. No public decision API,
automatic answer, routing policy or Autopilot is enabled. The qualified
0.8 app/SDK artifacts are unchanged.

## Reuse and verified wire

Reuse Node HTTP/abort/crypto (MIT), TypeBox (MIT), the existing bounded-body
helper and deterministic tool authorizer. No new dependency or provider fork
is needed. The prototype lives under generated test fixtures until the shared
owned-call/accounting and decision-authority integration is implemented.
This prerequisite adds no durable events, schema migration or client-only
state.

Official documentation checked on 2026-10-20:

- [System One API](https://docs.typesafe.ai/api/system-one.md):
  `POST /v1/systemone`, explicit bearer authentication, `model`, `state` and
  named `questions`. Noul is a yes/true probability; Choice returns option
  membership, confidence and probabilities; Score is a probability-weighted
  zero-based value with the original legend and separate confidence.
- [Models](https://docs.typesafe.ai/models): versioned model IDs are accepted,
  aliases may move, and the response reports the resolved version. Current
  published input pricing is not automatically a Moguri rate or billed cost.
- [Confidence](https://docs.typesafe.ai/confidence): confidence is not the same
  quantity as the selected option's probability. These provider descriptions
  are not a Moguri calibration/reliability guarantee.

The generated fixture's `jev-0.0.1` is intentionally synthetic, not a live model.
The prototype requires the caller's pinned expected version and rejects alias
drift. It implements a bounded text-only subset, not vision/long-context danger
zone headers. State stays data; output never becomes a permission or user answer.

## Important admission constraint

The documented request has **no output-token-limit field**. Returning token
usage does not establish an enforceable output bound. The prototype rejects a
finite-token policy before dispatch, rather than inventing a `max_tokens`
parameter, silently lifting a cap or pretending output was bounded.

Future shared admission must derive effective finite policy from the real
session/profile/global ledger, not a client-provided boolean. An ineligible
Jev/compatible leg must pause/escalate or use only an explicitly approved,
qualified alternative. No model confidence overrides this constraint.
USD eligibility, approved prices, remote inference origin and all-role
reservations still require their separate owned-call integration. Output
pricing is never inferred as zero from a missing provider field.

## Generated measurements

Run `node scripts/decision-spike.mjs`.

Eight checks pass in **395.51 ms**. The real loopback HTTP wire completes in
**15.00 ms**. The combined cancellation/deadline fixture takes **84.10 ms**,
including its intentional 50 ms deadline; that is not live-provider latency
or a provider-side cancellation measurement.

The checks cover:

- Exact named question/answer/legend binding, score consistency, probability
  bounds, expected pinned version and immutable in-flight request snapshots.
- Missing usage remains explicitly unreported; invalid advice retains
  independently valid reported token units for later accounting.
- 401/403/429/502 never retry or disclose an echoed generated credential.
  A cancelled-looking network error is not recorded as user cancellation.
- Actual client abort/deadline closes the loopback transport. Provider
  completion/charges remain unconfirmed; no free usage or successful outcome
  is inferred. Pre-dispatch cancellation emits no request.
- Bounded bytes, invalid UTF-8/JSON, missing/foreign options and stale owner/
  request/context/delegation/policy identity fail explicitly.
- Advice at confidence/probability one still loses to the actual deterministic
  tool denial. No automatic action or fake user attribution is performed.

These are mechanical contract/failure checks, **not** live Jev access,
calibrated decision thresholds, adversarial-model reliability, kupo quality,
actual budget-ledger integration, candidate application, remote/Sandbox model
transport or delegated automation qualification. Those remain required before
exposing automatic behavior.
