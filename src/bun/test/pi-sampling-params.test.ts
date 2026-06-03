import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSamplingPreset } from "@bun/engine/pi/sampling-params.ts";
import type { PiEngineConfig } from "@bun/config/index.ts";

const baseConfig: PiEngineConfig = {
  type: "pi",
  sampling_presets: {
    precise: { temperature: 0.2, top_p: 0.85 },
    balanced: { temperature: 0.7, top_p: 0.9, top_k: 40, presence_penalty: 0.1 },
    creative: { temperature: 1.0 },
  },
};

describe("resolveSamplingPreset", () => {
  // PS-1: Named preset is returned correctly
  it("PS-1: returns named preset with its defined params", () => {
    const result = resolveSamplingPreset("precise", baseConfig);
    expect(result).toEqual({ temperature: 0.2, top_p: 0.85 });
  });

  // PS-2: Partial preset has no extra keys (label/description stripped)
  it("PS-2: partial preset only has defined sampling keys", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: { minimal: { temperature: 0.8 } },
    };
    const result = resolveSamplingPreset("minimal", config);
    expect(result).toHaveProperty("temperature", 0.8);
    expect(result).not.toHaveProperty("top_p");
    expect(result).not.toHaveProperty("top_k");
    expect(result).not.toHaveProperty("presence_penalty");
    expect(result).not.toHaveProperty("repetition_penalty");
    expect(result).not.toHaveProperty("frequency_penalty");
    expect(result).not.toHaveProperty("seed");
    expect(result).not.toHaveProperty("min_p");
  });

  // PS-3: All eight params present when defined
  it("PS-3: preset with all eight params returns all eight", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: {
        full: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          presence_penalty: 0.1,
          repetition_penalty: 1.1,
          frequency_penalty: 0.3,
          seed: 42,
          min_p: 0.1,
        },
      },
    };
    const result = resolveSamplingPreset("full", config);
    expect(result).toEqual({
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      presence_penalty: 0.1,
      repetition_penalty: 1.1,
      frequency_penalty: 0.3,
      seed: 42,
      min_p: 0.1,
    });
  });

  // PS-4: undefined presetName, no default → undefined
  it("PS-4: undefined presetName with no default returns undefined", () => {
    const result = resolveSamplingPreset(undefined, baseConfig);
    expect(result).toBeUndefined();
  });

  // PS-5: undefined presetName, default set → returns default preset
  it("PS-5: undefined presetName falls back to default_sampling_preset", () => {
    const config: PiEngineConfig = {
      ...baseConfig,
      default_sampling_preset: "balanced",
    };
    const result = resolveSamplingPreset(undefined, config);
    expect(result).toEqual({
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      presence_penalty: 0.1,
    });
  });

  // PS-6: explicit preset takes precedence over default
  it("PS-6: explicit preset overrides default_sampling_preset", () => {
    const config: PiEngineConfig = {
      ...baseConfig,
      default_sampling_preset: "balanced",
    };
    const result = resolveSamplingPreset("creative", config);
    expect(result).toEqual({ temperature: 1.0 });
  });

  // PS-7: unknown preset + default → returns default and warns
  it("PS-7: unknown preset logs a warning and falls back to default", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const config: PiEngineConfig = {
        ...baseConfig,
        default_sampling_preset: "balanced",
      };
      const result = resolveSamplingPreset("nonexistent", config);
      expect(result).toEqual({
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        presence_penalty: 0.1,
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // PS-8: unknown preset, no default → undefined, no throw
  it("PS-8: unknown preset with no default returns undefined without throwing", () => {
    expect(() => resolveSamplingPreset("nonexistent", baseConfig)).not.toThrow();
    expect(resolveSamplingPreset("nonexistent", baseConfig)).toBeUndefined();
  });

  // PS-9: sampling_presets undefined → returns undefined without throwing
  it("PS-9: missing sampling_presets returns undefined without throwing", () => {
    const config: PiEngineConfig = { type: "pi" };
    expect(() => resolveSamplingPreset("any", config)).not.toThrow();
    expect(resolveSamplingPreset("any", config)).toBeUndefined();
  });

  // PS-10: temperature: 0 is not filtered as falsy
  it("PS-10: temperature: 0 is preserved in returned preset", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: { zero: { temperature: 0 } },
    };
    const result = resolveSamplingPreset("zero", config);
    expect(result).toHaveProperty("temperature", 0);
  });

  // PS-11: repetition_penalty is forwarded
  it("PS-11: preset with repetition_penalty returns it in resolved params", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: { penalized: { temperature: 0.7, repetition_penalty: 1.1 } },
    };
    const result = resolveSamplingPreset("penalized", config);
    expect(result).toEqual({ temperature: 0.7, repetition_penalty: 1.1 });
  });

  // PS-12: frequency_penalty is forwarded
  it("PS-12: preset with frequency_penalty returns it in resolved params", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: { freq: { temperature: 0.5, frequency_penalty: 0.3 } },
    };
    const result = resolveSamplingPreset("freq", config);
    expect(result).toEqual({ temperature: 0.5, frequency_penalty: 0.3 });
  });

  // PS-13: seed is forwarded
  it("PS-13: preset with seed returns it in resolved params", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: { reproducible: { temperature: 0.7, seed: 42 } },
    };
    const result = resolveSamplingPreset("reproducible", config);
    expect(result).toEqual({ temperature: 0.7, seed: 42 });
  });

  // PS-14: min_p is forwarded
  it("PS-14: preset with min_p returns it in resolved params", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: { minp: { temperature: 0.7, min_p: 0.1 } },
    };
    const result = resolveSamplingPreset("minp", config);
    expect(result).toEqual({ temperature: 0.7, min_p: 0.1 });
  });

  // PS-15: label and description are stripped from resolved SamplingParams
  it("PS-15: preset with label and description — neither appears in resolved SamplingParams", () => {
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: {
        labeled: {
          label: "Balanced",
          description: "Good all-round default",
          temperature: 0.8,
          top_p: 0.95,
        },
      },
    };
    const result = resolveSamplingPreset("labeled", config);
    expect(result).toEqual({ temperature: 0.8, top_p: 0.95 });
    expect(result).not.toHaveProperty("label");
    expect(result).not.toHaveProperty("description");
  });
});
