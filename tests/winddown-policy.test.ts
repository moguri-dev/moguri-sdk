import assert from "node:assert/strict";
import { test } from "node:test";
import { winddownCapability } from "../apps/service/src/winddown-policy.ts";
import { defaultSettings, type ModelInfo } from "../packages/sdk/src/index.ts";

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
