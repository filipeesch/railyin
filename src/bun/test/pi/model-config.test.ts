import { describe, test, expect } from "bun:test";
import {
  resolvePiModelConfig,
  derivePiModelSettings,
  derivePiModelAxes,
  canonicalThinkingLevel,
} from "../../engine/pi/model-config.ts";
import type { PiEngineConfig, PiModelConfig } from "../../config/index.ts";

function makeConfig(models: Record<string, PiModelConfig> = {}): PiEngineConfig {
  return { type: "pi", models };
}

describe("resolvePiModelConfig", () => {
  test("MC-RES-1: provider/model key resolves directly", () => {
    const cfg = makeConfig({ "lmstudio/qwen3-8b": { name: "Qwen 8B" } });
    expect(resolvePiModelConfig(cfg, "lmstudio/qwen3-8b")?.name).toBe("Qwen 8B");
  });

  test("MC-RES-2: bare model id key resolves directly", () => {
    const cfg = makeConfig({ "qwen3-8b": { name: "Qwen 8B" } });
    expect(resolvePiModelConfig(cfg, "qwen3-8b")?.name).toBe("Qwen 8B");
  });

  test("MC-RES-3: provider/model falls back to bare id when no qualified key", () => {
    const cfg = makeConfig({ "qwen3-8b": { name: "Bare key" } });
    expect(resolvePiModelConfig(cfg, "lmstudio/qwen3-8b")?.name).toBe("Bare key");
  });

  test("MC-RES-4: qualified key wins over bare id", () => {
    const cfg = makeConfig({
      "qwen3-8b": { name: "bare" },
      "lmstudio/qwen3-8b": { name: "qualified" },
    });
    expect(resolvePiModelConfig(cfg, "lmstudio/qwen3-8b")?.name).toBe("qualified");
  });

  test("MC-RES-5: undefined model id returns undefined", () => {
    const cfg = makeConfig({ "qwen3-8b": { name: "Qwen" } });
    expect(resolvePiModelConfig(cfg, undefined)).toBeUndefined();
  });

  test("MC-RES-6: missing model returns undefined", () => {
    const cfg = makeConfig({});
    expect(resolvePiModelConfig(cfg, "lmstudio/nope")).toBeUndefined();
  });
});

describe("derivePiModelSettings", () => {
  test("MC-SET-1: model limit context wins over override and engine default", () => {
    const cfg = makeConfig({ "lmstudio/qwen3-8b": { limit: { context: 64_000 } } });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    const s = derivePiModelSettings(cfg, m, 32_000);
    expect(s.contextWindow).toBe(64_000);
  });

  test("MC-SET-2: override wins over engine context_window", () => {
    const cfg: PiEngineConfig = { type: "pi", context_window: 128_000 };
    const s = derivePiModelSettings(cfg, undefined, 8_000);
    expect(s.contextWindow).toBe(8_000);
  });

  test("MC-SET-3: engine context_window used when no model limit or override", () => {
    const cfg: PiEngineConfig = { type: "pi", context_window: 96_000 };
    const s = derivePiModelSettings(cfg, undefined, undefined);
    expect(s.contextWindow).toBe(96_000);
  });

  test("MC-SET-4: output limit mapped to maxTokens", () => {
    const cfg = makeConfig({ "lmstudio/qwen3-8b": { limit: { output: 4096 } } });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    const s = derivePiModelSettings(cfg, m);
    expect(s.maxTokens).toBe(4096);
  });

  test("MC-SET-5: reasoning defaults to true when omitted", () => {
    const cfg = makeConfig({ "lmstudio/qwen3-8b": {} });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    expect(derivePiModelSettings(cfg, m).reasoning).toBe(true);
  });

  test("MC-SET-6: reasoning false is honored", () => {
    const cfg = makeConfig({ "lmstudio/qwen3-8b": { reasoning: false } });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    expect(derivePiModelSettings(cfg, m).reasoning).toBe(false);
  });
});

describe("derivePiModelAxes", () => {
  test("MC-AX-1: variants produce a Mode axis with disabled variants hidden", () => {
    const cfg = makeConfig({
      "lmstudio/qwen3-8b": {
        variants: {
          none: {},
          normal: {},
          max: {},
          low: { disabled: true },
          medium: { disabled: true },
          high: { disabled: true },
        },
      },
    });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    const axes = derivePiModelAxes(m);
    const modeAxis = axes.find((a) => a.id === "mode");
    expect(modeAxis).toBeDefined();
    const optionValues = modeAxis!.options!.map((o) => o.value);
    expect(optionValues).toEqual(["none", "normal", "max"]);
  });

  test("MC-AX-2: sampling presets produce a Sampling axis", () => {
    const cfg = makeConfig({
      "lmstudio/qwen3-8b": {
        sampling_presets: {
          balanced: { temperature: 0.8 },
          precise: { temperature: 0.2 },
        },
      },
    });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    const axes = derivePiModelAxes(m);
    const samplingAxis = axes.find((a) => a.id === "sampling");
    expect(samplingAxis).toBeDefined();
    const optionValues = samplingAxis!.options!.map((o) => o.value);
    expect(optionValues).toEqual(["balanced", "precise"]);
  });

  test("MC-AX-3: explicit axes override auto-derived ones with the same id", () => {
    const cfg = makeConfig({
      "lmstudio/qwen3-8b": {
        variants: { none: {}, normal: {} },
        axes: [{ id: "mode", label: "Reasoning", options: [{ value: "high", label: "High" }] }],
      },
    });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    const axes = derivePiModelAxes(m);
    const modeAxis = axes.find((a) => a.id === "mode");
    expect(modeAxis!.label).toBe("Reasoning");
    expect(modeAxis!.options!.map((o) => o.value)).toEqual(["high"]);
  });

  test("MC-AX-4: no variants or presets → no auto axes", () => {
    const cfg = makeConfig({ "lmstudio/qwen3-8b": {} });
    const m = resolvePiModelConfig(cfg, "lmstudio/qwen3-8b");
    expect(derivePiModelAxes(m)).toEqual([]);
  });
});

describe("canonicalThinkingLevel", () => {
  test("MC-CANON-1: none maps to off", () => {
    expect(canonicalThinkingLevel({ reasoningEffort: "none" })).toBe("off");
    expect(canonicalThinkingLevel({ reasoning_effort: "none" })).toBe("off");
  });

  test("MC-CANON-2: valid canonical levels pass through", () => {
    for (const level of ["minimal", "low", "medium", "high", "xhigh"] as const) {
      expect(canonicalThinkingLevel({ reasoningEffort: level })).toBe(level);
    }
  });

  test("MC-CANON-3: no effort, no knob → off", () => {
    expect(canonicalThinkingLevel({})).toBe("off");
    expect(canonicalThinkingLevel(undefined)).toBe("off");
  });

  test("MC-CANON-4: invalid effort falls back to off", () => {
    expect(canonicalThinkingLevel({ reasoningEffort: "max" } as Record<string, unknown>)).toBe("off");
  });

  test("MC-CANON-5: provider-specific knob without effort → high (reasoning enabled)", () => {
    expect(canonicalThinkingLevel({ enable_thinking: true })).toBe("high");
    expect(canonicalThinkingLevel({ chat_template_kwargs: { enable_thinking: true } })).toBe("high");
  });
});
