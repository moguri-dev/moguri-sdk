import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionCapability } from "../apps/service/src/decision-policy.ts";
import { defaultSettings, type ModelInfo } from "../packages/sdk/src/index.ts";

test("Autopilot Max requires a separately configured bounded compatible decision provider; Jev cannot invent an output-limit field or substitute a generator", () => {
  const settings = defaultSettings(), model: ModelInfo = { id: "generated-decision", name: "Generated bounded decision model", providerId: "generated-provider", apiModelId: "generated-api",
    source: "copilot", environments: ["Local"], contextWindow: 32768, maxTokens: 2048, imageInput: false };
  assert.throws(() => decisionCapability(settings.decisions, [model], "Local"), { code: "decision_unavailable" });
  const configured = { ...settings.decisions, enabled: true, modelId: model.id };
  assert.throws(() => decisionCapability(configured, [model], "Local"), { code: "decision_privacy" });
  assert.equal(decisionCapability({ ...configured, allowHosted: true }, [model], "Local").model.id, model.id);
  assert.throws(() => decisionCapability({ ...configured, allowHosted: true }, [model], "Remote"), { code: "decision_env" });
  assert.throws(() => decisionCapability({ ...configured, provider: "jev", modelId: "jev-0.0.1", allowHosted: true }, [model], "Local"), { code: "decision_output_limit" });
});
