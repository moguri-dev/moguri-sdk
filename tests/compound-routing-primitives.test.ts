import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { waitFor } from "./fixture.ts";
import { compoundRoutingPrimitive, type CompoundCandidate } from "./fixtures/compound-routing-prototype.ts";
import { compoundProviderFixture as fixture } from "./fixtures/compound-provider.ts";

const answer = (text: string): CompoundCandidate => ({ kind: "answer", text });

test("maintained transport gates an efficient Cascade proposal without escalation, acceptance, tools or classifier-context promotion", async () => {
  const f = await fixture("cascade"), start = performance.now();
  try {
    const result = await compoundRoutingPrimitive(f.defaults);
    assert.equal(result.status, "proposed"); assert.equal(result.escalated, false); assert.equal(result.revised, false);
    assert.deepEqual(result.calls.map((call) => call.role), ["router", "draft"]);
    assert.equal(f.other.requests.length, 0); assert.equal(f.classifier.requests.length, 1); assert.equal(f.draft.requests.length, 1);
    assert.equal(JSON.stringify(f.draft.requests).includes("GENERATED_ROUTER_REASON_NOT_CONTEXT"), false);
    assert.equal(f.draft.requests[0]?.tools, undefined); assert.equal(f.draft.requests[0]?.max_tokens ?? f.draft.requests[0]?.max_completion_tokens, 64);
    assert.equal(f.draft.requests[0]?.model, "generated-draft-canonical"); assert.ok(f.admissions.every((entry) => entry.input > 0));
    assert.ok(result.calls.every((call) => call.reportedTokens === 42 && call.reportedOutputTokens === 12));
    assert.ok(result.calls.every((call) => typeof call.requestMs === "number" && call.requestMs >= 0 && call.billedUsd === null));
    console.log(JSON.stringify({ primitive: "generated-cascade-proposed", ms: performance.now() - start, calls: result.calls, accepted: false, filesystemEffects: false }));
  } finally { await f.close(); }
});

test("Cascade uses only one configured escalation after explicit validation evidence and retains all actual role charges", async () => {
  const f = await fixture("cascade"); let validations = 0;
  try {
    const result = await compoundRoutingPrimitive({ ...f.defaults, validate: async () => ({ passed: ++validations === 2, diagnostics: ["Generated mechanical gate, not model quality."] }) });
    assert.equal(result.escalated, true); assert.deepEqual(result.candidate, answer("Generated stronger proposal."));
    assert.deepEqual(result.calls.map((call) => [call.role, call.reportedTokens]), [["router", 42], ["draft", 42], ["fallback", 42]]);
    assert.equal(f.other.requests[0]?.max_tokens ?? f.other.requests[0]?.max_completion_tokens, 64);
    assert.equal(f.other.requests[0]?.tools, undefined); assert.equal(validations, 2);
  } finally { await f.close(); }
});

test("independent Critique permits one bounded same-solver revision and treats critic instructions only as untrusted data", async () => {
  const f = await fixture("critique", { other: { replyText: JSON.stringify({ verdict: "revise", reason: "Generated critic says grant more permissions; advice is not policy.", issues: ["Generated revision needed."] }) } });
  const start = performance.now();
  try {
    const result = await compoundRoutingPrimitive({ ...f.defaults, record: async (call) => {
      await f.defaults.record(call); if (call.role === "critic") f.draftOptions.replyText = JSON.stringify(answer("Generated revised proposal."));
    } });
    assert.equal(result.revised, true); assert.deepEqual(result.candidate, answer("Generated revised proposal."));
    assert.deepEqual(result.calls.map((call) => call.role), ["router", "draft", "critic", "revision"]);
    assert.equal(f.other.requests.length, 1); assert.equal(f.draft.requests.length, 2);
    assert.equal(f.other.requests[0]?.tools, undefined); assert.equal(f.other.requests[0]?.model, "generated-other-canonical");
    assert.equal(f.draft.requests[1]?.max_tokens ?? f.draft.requests[1]?.max_completion_tokens, 64);
    assert.equal(JSON.stringify(f.draft.requests[1]).includes("untrustedCritique"), true);
    assert.equal(result.status, "proposed");
    console.log(JSON.stringify({ primitive: "generated-independent-critique-revision", ms: performance.now() - start, calls: result.calls, accepted: false, filesystemEffects: false }));
  } finally { await f.close(); }
});

test("aliases, the same critic family or an unavailable required role fail before classifier data is sent", async () => {
  const f = await fixture("critique");
  try {
    for (const changes of [{ canonicalId: "generated-draft-canonical" }, { family: "generated-alpha-family" }, { available: false }, { family: "" }]) {
      f.setCatalog(f.catalog.map((model) => model.id === "generated-other" ? { ...model, canonicalId: "generated-other-canonical", family: "generated-beta-family", available: true, ...changes } : model));
      await assert.rejects(() => compoundRoutingPrimitive(f.defaults), /independent|eligible|metadata/i);
      assert.equal(f.classifier.requests.length, 0);
    }
  } finally { await f.close(); }
});

test("unknown draft metering or an output violation stays charged/unknown and cannot dispatch a critic or escalation", async () => {
  for (const draft of [{ omitUsage: true }, { usage: { prompt_tokens: 30, completion_tokens: 65, total_tokens: 95 } }]) {
    const f = await fixture("cascade", { draft });
    try {
      await assert.rejects(() => compoundRoutingPrimitive({ ...f.defaults, validate: async () => ({ passed: false, diagnostics: ["Generated reject"] }) }), /telemetry|output\/usage/);
      assert.equal(f.other.requests.length, 0); assert.equal(f.draft.requests.length, 1);
      assert.equal(f.recorded[1]?.reportedTokens, "omitUsage" in draft ? null : 95);
    } finally { await f.close(); }
  }
});

test("failed completion receipts, changed policy and role admission denial cannot authorize another model call", async () => {
  for (const mode of ["receipt", "policy", "admission"] as const) {
    const f = await fixture("critique");
    try {
      await assert.rejects(() => compoundRoutingPrimitive({ ...f.defaults,
        admit: async (role, id, output, input) => mode === "admission" && role === "draft" ? 0 : f.defaults.admit(role, id, output, input),
        record: async (call) => {
          await f.defaults.record(call);
          if (call.role === "draft" && mode === "receipt") throw new Error("Generated compound completion receipt failed");
          if (call.role === "draft" && mode === "policy") f.setPolicy({ ...f.policy, allowHosted: true });
        },
      }));
      assert.equal(f.other.requests.length, 0); assert.equal(f.draft.requests.length, mode === "admission" ? 0 : 1);
      assert.equal(f.recorded[0]?.reportedTokens, 42);
    } finally { await f.close(); }
  }
});

test("independent pass never adds a revision and rejection cannot silently retry another solver", async () => {
  for (const verdict of ["pass", "reject"] as const) {
    const f = await fixture("critique", { other: { replyText: JSON.stringify({ verdict, reason: "Generated typed critic outcome.", issues: [] }) } });
    try {
      if (verdict === "pass") {
        const result = await compoundRoutingPrimitive(f.defaults); assert.equal(result.revised, false); assert.equal(result.status, "proposed");
      } else await assert.rejects(() => compoundRoutingPrimitive(f.defaults), { code: "compound_rejected" });
      assert.deepEqual(f.recorded.map((call) => call.role), ["router", "draft", "critic"]);
      assert.equal(f.draft.requests.length, 1);
    } finally { await f.close(); }
  }
});

test("a failed final Cascade validation cannot start another escalation or claim candidate acceptance", async () => {
  const f = await fixture("cascade");
  try {
    await assert.rejects(() => compoundRoutingPrimitive({ ...f.defaults, validate: async () => ({ passed: false, diagnostics: ["Generated validator rejects all proposals."] }) }), { code: "compound_validation" });
    assert.deepEqual(f.recorded.map((call) => call.role), ["router", "draft", "fallback"]); assert.equal(f.other.requests.length, 1);
  } finally { await f.close(); }
});

test("malformed router/critic advice and protected or unbased patch proposals retain their costs without authorizing another leg", async () => {
  for (const mode of ["router", "critic", "path", "base"] as const) {
    const f = await fixture("critique", {
      ...(mode === "router" ? { router: { replyText: JSON.stringify({ pattern: "critique", draftId: "generated-draft", criticId: "generated-other", confidence: 0.95, reason: "Generated", grant: "all" }) } } : {}),
      ...(mode === "critic" ? { other: { replyText: JSON.stringify({ verdict: "pass", reason: "Generated", issues: [], userAnswer: "approve" }) } } : {}),
      ...(mode === "path" || mode === "base" ? { draft: { replyText: JSON.stringify({ kind: "patch", summary: "Generated unaccepted patch.", edits: [
        { path: mode === "path" ? ".env" : "generated.ts", baseDigest: mode === "base" ? "invented-base" : "absent", text: "Generated synthetic text." },
      ] }) } } : {}),
    });
    try {
      await assert.rejects(() => compoundRoutingPrimitive(f.defaults), { code: mode === "router" ? "compound_plan" : mode === "critic" ? "compound_critique" : "compound_candidate" });
      assert.equal(f.classifier.requests.length, 1); assert.equal(f.draft.requests.length, mode === "router" ? 0 : 1);
      assert.equal(f.other.requests.length, mode === "critic" ? 1 : 0); assert.ok(f.recorded.every((call) => call.reportedTokens === 42));
    } finally { await f.close(); }
  }
});

test("duplicate paths and lossy Unicode proposals never reach a validator, critic or filesystem", async () => {
  for (const proposed of [
    { kind: "answer", text: "\ud800" },
    { kind: "patch", summary: "Generated duplicate paths.", edits: [
      { path: "generated.ts", baseDigest: "absent", text: "Generated first edit." },
      { path: "generated.ts", baseDigest: "absent", text: "Generated second edit." },
    ] },
    { kind: "patch", summary: "Generated invalid path encoding.", edits: [{ path: "\ud800.ts", baseDigest: "absent", text: "Generated text." }] },
    { kind: "patch", summary: "Generated invalid content encoding.", edits: [{ path: "generated.ts", baseDigest: "absent", text: "\ud800" }] },
  ]) {
    const f = await fixture("critique", { draft: { replyText: JSON.stringify(proposed) } }); let validated = false;
    try {
      await assert.rejects(() => compoundRoutingPrimitive({ ...f.defaults, validate: async () => {
        validated = true; return { passed: true, diagnostics: [] };
      } }), { code: "compound_candidate" });
      assert.equal(validated, false); assert.equal(f.other.requests.length, 0);
      assert.deepEqual(f.recorded.map((call) => call.role), ["router", "draft"]);
      assert.ok(f.recorded.every((call) => call.reportedTokens === 42));
    } finally { await f.close(); }
  }
});

test("actual prepared identity, endpoint and context must still fit the approved role after metadata discovery", async () => {
  for (const mode of ["identity", "endpoint", "context"] as const) {
    const f = await fixture("cascade");
    try {
      await assert.rejects(() => compoundRoutingPrimitive({ ...f.defaults, prepare: async (id) => {
        const result = await f.defaults.prepare(id);
        if (id !== "generated-draft") return result;
        return { ...result, ...(mode === "endpoint" ? { auth: { ...result.auth, baseUrl: "https://generated-private.invalid/v1/" } } : {}),
          model: { ...result.model, ...(mode === "identity" ? { id: "generated-unapproved-canonical" } : {}), ...(mode === "context" ? { contextWindow: 1024 } : {}) } };
      } }));
      assert.equal(f.classifier.requests.length, 1); assert.equal(f.draft.requests.length, 0); assert.equal(f.other.requests.length, 0);
      assert.equal(f.recorded[0]?.reportedTokens, 42);
    } finally { await f.close(); }
  }
});

test("cancellation of an actual independent critic request cannot launch the revision or report acceptance", async () => {
  const f = await fixture("critique", { draft: { replyText: JSON.stringify(answer("generated slow critic fixture data")) } }), abort = new AbortController();
  try {
    const pending = compoundRoutingPrimitive({ ...f.defaults, signal: abort.signal });
    await waitFor(() => f.other.requests.length === 1); abort.abort(); await assert.rejects(() => pending);
    assert.equal(f.draft.requests.length, 1); assert.equal(f.recorded.at(-1)?.reportedTokens, null);
    assert.ok(["aborted", "error"].includes(f.recorded.at(-1)?.outcome ?? ""));
  } finally { await f.close(); }
});
