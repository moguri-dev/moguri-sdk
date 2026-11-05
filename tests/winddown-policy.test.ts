import assert from "node:assert/strict";
import { test } from "node:test";
import { winddownCapability, winddownContext } from "../apps/service/src/winddown-policy.ts";
import { defaultSettings, ModelRoleSchema, type ModelInfo } from "../packages/sdk/src/index.ts";

test("finite routing needs an exact selected-Env wind-down model, real bounds and separate hosted-data permission", () => {
  const settings = defaultSettings(), model: ModelInfo = { id: "generated-checkpoint", name: "Generated bounded checkpoint model", providerId: "generated-provider", apiModelId: "generated-api-checkpoint",
    source: "copilot", environments: ["Local"], contextWindow: 32768, maxTokens: 1024, imageInput: false };
  assert.throws(() => winddownCapability(settings.winddown, [model], "Local"), { code: "winddown_unavailable" });
  const configured = { ...settings.winddown, enabled: true, modelId: model.id, outputTokens: 128 };
  assert.throws(() => winddownCapability(configured, [model], "Local"), { code: "winddown_privacy" });
  const value = winddownCapability({ ...configured, allowHosted: true }, [model], "Local");
  assert.equal(value.model.id, model.id); assert.equal(value.outputBound, 128); assert.ok(value.inputBound > 0);
  assert.throws(() => winddownCapability({ ...configured, allowHosted: true }, [model], "Remote"), { code: "winddown_model" });
  for (const env of ["Remote", "Sandbox"] as const) {
    const selected = winddownCapability({ ...configured, allowHosted: true }, [{ ...model, environments: [env] }], env);
    assert.equal(selected.model.id, model.id); assert.equal(selected.outputBound, value.outputBound);
    assert.equal(selected.inputBound, value.inputBound);
  }
  assert.throws(() => winddownCapability({ ...configured, allowHosted: true }, [{ ...model, maxTokens: 64 }], "Local"), { code: "winddown_model" });
});

test("the complete canonical wind-down envelope includes naming and every other actual role without truncating aggregates", () => {
  const model: ModelInfo = { id: "generated-all-role-checkpoint", name: "Generated all-role checkpoint", providerId: "generated-provider", apiModelId: "generated-api",
    source: "local", endpointBoundary: "loopback", environments: ["Local"], contextWindow: 32768, maxTokens: 1024, imageInput: false };
  const configured = { ...defaultSettings().winddown, enabled: true, modelId: model.id, outputTokens: 128 };
  const bounded = winddownCapability(configured, [model], "Local");
  const roles = ModelRoleSchema.anyOf.map(({ const: role }) => ({ role, calls: 1, knownTokens: 42, unknownCalls: 0 }));
  const context = winddownContext({ version: 1, turnId: "generated-all-role-turn", env: "Local", purpose: "budget-wind-down",
    taskDigest: "a".repeat(64), calls: roles.length, callSetDigest: "b".repeat(64), byRole: roles, basis: "canonical-aggregate-only-no-history-or-code" });
  assert.equal(context.length, 1);
  const text = context[0]!.content;
  assert.equal(typeof text, "string");
  if (typeof text !== "string") throw new Error("Generated aggregate must be one bounded textual context.");
  assert.deepEqual(JSON.parse(text).untrustedCheckpointMetadata.byRole, roles);
  assert.ok(roles.some((entry) => entry.role === "title"));
  assert.ok(bounded.inputBound > 0);
});
