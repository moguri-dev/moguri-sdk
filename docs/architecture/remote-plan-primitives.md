# Owned SSH plan-mutation prerequisite

This is a non-sandbox Phase-0 mechanical qualification, not the Remote plan-save
feature. At the 0.13/protocol-19 prerequisite checkpoint, public `plans.save`
still rejected Remote and the desktop view was read-only. The subsequent
[production contract](remote-plan-saves.md) adds the qualified owned path.
No earlier qualified archive is replaced or relabeled.

## Reuse and boundary

Reuse Node filesystem/crypto, maintained TypeBox and the existing private SSH
bridge, encrypted replay journal, exact worker digest and `EventStore`.
Node, TypeBox and the test-only esbuild are MIT-licensed; OpenSSH retains its
upstream BSD/ISC-style licenses. No runtime dependency, model provider or
second agent framework is added. Esbuild only prepares a generated fixture.

The fixture copies the actual built bridge byte-for-byte into a private
temporary prefix and pins a generated deterministic filesystem worker beside
it. A generated rootless loopback OpenSSH server uses separate generated keys.
The parent verifies exact `write_file` arguments, commits its frame cursor
before acknowledgement and grants only the requested operation. Folder rules
and existing protected-path/digest/file helpers execute on the SSH host.

This proves transport/helper composition. It does not prove the future
controller's user-intent authorization, session/root writer leases, retained
artifact commit, public SDK or client UX. The prototype's start-context packet
is fixture transport data, not a production user message or model prompt.
The deterministic worker never initializes or invokes a model.

## Measurements and failure semantics

`node --import tsx --test tests/remote-plan-primitives.test.ts` first fails on the
missing prototype. The initial implementation passed four of five cases; the
fifth assertion incorrectly conflated known worker exit with confirmed effect/
terminal acknowledgement. The actual bridge reported `owned-worker-stopped`
cleanup but `unconfirmed` execution with an unacknowledged retained result.
The corrected assertion checks both independent fields and the result frame's
sequence above the durable acknowledgement cursor, not a broad status alias.

The corrected **six cases pass in 4,549.71 ms**:

| Case | Measurement | Actual boundary |
| --- | ---: | --- |
| Exact one-write authorization and retained result | 618.20 ms | Remote bytes/digest match; same-named Local file untouched; no model request. |
| Stale expected digest | 590.12 ms | Concurrent replacement stays intact; explicit failure, no retry. |
| Stop before authorization | 593.67 ms | Actual stopped outcome, no write/result invented. |
| Stop after acknowledged write | 606.37 ms | Actual written bytes remain; terminal partial, no rollback claim. |
| Lost result acknowledgement | 909.96 ms | Exact encrypted result stays inspectable above the ack cursor; execution unconfirmed despite known worker exit. |
| Denied/read-only folders | 974.79 ms | Both policies reject without mutation or model requests. |

Type checks also pass. All input and keys are generated; no personal
authorization, data, microphone, weights, paid inference, VM or SendBox probe
is used. SSH/known worker exit is not proof of descendant containment. This is
process/control-loss evidence, not a filesystem power-loss guarantee.

## Required production integration

A Remote save must bind actual user intent, command identity, owning profile/
session, canonical pinned root/target/build, path, expected digest/text and
current mode/folder/env policy before effects. Recheck after asynchronous
preparation. Record intent before dispatch and preserve uncertain outcomes;
a reconnect/restart or duplicate command must never replay a write.

Use the existing owned worker/control stream, not a fire-and-forget SSH query
or a model-generated tool request. No model call, synthetic human prompt,
implicit tool grant, read-only bypass or Local fallback is authorized. Preserve
the existing Local plan API and editing behavior.

Successful retained-artifact creation must refer to the actual acknowledged
remote bytes and boundary. A file effect followed by lost control, changed
scope, failed retention or unconfirmed acknowledgement is partial/unconfirmed,
not a clean save or rollback. Exact stop/recovery must not target newer work.
Public operation state must remain inspectable without replaying the effect.

New durable intent/result/control-purpose events require a numbered migration,
unchanged old ciphertext/receipts/grants and recovery coverage. Final acceptance
must exercise SDK, actual CLI/native TUI, hidden desktop, real pinned SSH,
concurrent source/root/policy changes, cancellation/acknowledgement failures,
restart and the exact installed package. These production surfaces remain
unimplemented at this prerequisite checkpoint. Sandbox work stays paused.
