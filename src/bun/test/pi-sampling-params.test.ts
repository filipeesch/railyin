import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSamplingPreset } from "@bun/engine/pi/sampling-params.ts";
import type { PiEngineConfig } from "@bun/config/index.ts";

const baseConfig: PiEngineConfig = {
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

  // PS-2: Partial preset has no extra keys
  it("PS-2: partial preset only has defined keys", () => {
    const config: PiEngineConfig = {
      sampling_presets: { minimal: { temperature: 0.8 } },
    };
    const result = resolveSamplingPreset("minimal", config);
    expect(result).toHaveProperty("temperature", 0.8);
    expect(result).not.toHaveProperty("top_p");
    expect(result).not.toHaveProperty("top_k");
    expect(result).not.toHaveProperty("presence_penalty");
  });

  // PS-3: All four params present when defined
  it("PS-3: preset with all four params returns all four", () => {
    const result = resolveSamplingPreset("balanced", baseConfig);
    expect(result).toEqual({
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      presence_penalty: 0.1,
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
    expect(result).toEqual(baseConfig.sampling_presets!.balanced);
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
      expect(result).toEqual(baseConfig.sampling_presets!.balanced);
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
    const config: PiEngineConfig = {};
    expect(() => resolveSamplingPreset("any", config)).not.toThrow();
    expect(resolveSamplingPreset("any", config)).toBeUndefined();
  });

  // PS-10: temperature: 0 is not filtered as falsy
  it("PS-10: temperature: 0 is preserved in returned preset", () => {
    const config: PiEngineConfig = {
      sampling_presets: { zero: { temperature: 0 } },
    };
    const result = resolveSamplingPreset("zero", config);
    expect(result).toHaveProperty("temperature", 0);
  });
});
