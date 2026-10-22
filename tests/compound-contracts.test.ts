import assert from "node:assert/strict";
import { test } from "node:test";
import { compoundCritique, compoundProposal } from "../apps/service/src/compound-contracts.ts";
import { digest } from "../apps/service/src/store.ts";
import { compoundContext } from "../apps/service/src/compound-context.ts";

test("a public proposal retains task plan and architecture alongside only the exact reviewed implementation paths and bases", () => {
  const source = "Generated original implementation.\n", baseDigest = digest(source);
  const patch = { kind: "patch", summary: "Generated implementation proposal.", edits: [{ path: "fixture.ts", baseDigest, text: "Generated proposed implementation.\n" }] };
  const value = { plan: "Generated plan: change only the reviewed file.", architecture: "Generated architecture: reuse the existing owned control plane.", patch };
  const proposal = compoundProposal(JSON.stringify(value), [{ path: "fixture.ts", baseDigest, text: source }]);
  assert.deepEqual(proposal, value);
  assert.throws(() => compoundProposal(JSON.stringify({ ...value, patch: { ...patch, edits: [{ ...patch.edits[0], path: "unreviewed.ts" }] } }), [{ path: "fixture.ts", baseDigest, text: source }]), /reviewed|original/);
});

test("critique must explicitly cover the current request plan, architecture and implementation without becoming source acceptance", () => {
  const pass = { verdict: "pass", reason: "Generated scoped review, not quality proof or permission.", issues: [] };
  const value = { verdict: "revise", plan: pass, architecture: { ...pass, verdict: "revise", issues: ["Generated architecture concern."] }, implementation: pass };
  assert.deepEqual(compoundCritique(JSON.stringify(value)), value);
  const { architecture: _missing, ...incomplete } = value;
  assert.throws(() => compoundCritique(JSON.stringify(incomplete)), { code: "invalid_request" });
  assert.throws(() => compoundCritique(JSON.stringify({ ...value, verdict: "pass" })), /verdict|contradict/i);
  assert.throws(() => compoundCritique(JSON.stringify({ ...value, accepted: true })), { code: "invalid_request" });
});

test("critic context binds the current ask and all three proposal dimensions plus real-test evidence, never router explanations or hidden inputs", () => {
  const task = { task: "Generated current request.", requestPlan: "Generated reviewed request plan.", requestArchitecture: "Generated reviewed architecture.",
    files: [{ path: "fixture.ts", baseDigest: "absent", text: null }], routerReason: "GENERATED_ROUTER_REASON_NOT_CONTEXT" };
  const proposal = { plan: "Generated solver plan.", architecture: "Generated solver architecture.",
    patch: { kind: "patch" as const, summary: "Generated solver implementation.", edits: [{ path: "fixture.ts", baseDigest: "absent", text: "Generated implementation bytes." }] } };
  const validation = { status: "failed" as const, command: "generated-test-command", output: "Generated actual test failure.", evidenceDigest: "a".repeat(64) };
  const context = compoundContext("critic", task, { proposal, validation });
  const text = JSON.stringify(context);
  for (const value of ["Generated current request.", "Generated solver plan.", "Generated solver architecture.", "Generated implementation bytes.", "Generated actual test failure."]) assert.ok(text.includes(value));
  assert.equal(text.includes("GENERATED_ROUTER_REASON_NOT_CONTEXT"), false);
  assert.equal(text.includes("untrustedProposal"), true);
  assert.equal(text.includes("untrustedValidationEvidence"), true);
});

test("unpaired original task/context/file text is rejected before JSON escaping can hide a lossy input", () => {
  const task = { task: "Generated current task.", requestPlan: null, requestArchitecture: null, files: [{ path: "fixture.ts", baseDigest: "absent", text: null }] };
  for (const value of [{ ...task, task: "\ud800" }, { ...task, requestPlan: "\ud800" }, { ...task, requestArchitecture: "\ud800" },
    { ...task, files: [{ path: "fixture.ts", baseDigest: "a".repeat(64), text: "\ud800" }] }]) {
    assert.throws(() => compoundContext("draft", value), { code: "compound_context" });
  }
});
