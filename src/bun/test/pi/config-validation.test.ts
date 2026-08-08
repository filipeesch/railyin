import { describe, test, expect } from "bun:test";
import { validatePiEngineConfig } from "../../engine/pi/pi-config-validation.ts";
import type { PiEngineConfig } from "../../config/index.ts";

describe("validatePiEngineConfig", () => {
  test("CV-1: valid config passes without throwing", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { max_per_call: 5 } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-2: max_per_call = 0 throws with message naming the field", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { max_per_call: 0 } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("max_per_call");
  });

  test("CV-3: max_per_call = 11 throws", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { max_per_call: 11 } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("max_per_call");
  });

  test("CV-4: max_per_call = 1 passes (lower boundary)", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { max_per_call: 1 } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-4b: max_per_call = 10 passes (upper boundary)", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { max_per_call: 10 } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-5: early_margin_tokens = 512 throws with message naming the field", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { background_compaction: { early_margin_tokens: 512 } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("early_margin_tokens");
  });

  test("CV-6: early_margin_tokens = 1024 passes (boundary value)", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { background_compaction: { early_margin_tokens: 1024 } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-7: neither field set — passes (all optional)", () => {
    const config: PiEngineConfig = { type: "pi" };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-8: model limit context = 0 throws", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { limit: { context: 0 } } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("limit.context");
  });

  test("CV-9: model limit output = 0 throws", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { limit: { output: 0 } } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("limit.output");
  });

  test("CV-10: model limit context > 0 passes", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { limit: { context: 8192 } } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-11: non-disabled variant without options throws", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { variants: { fast: {} } } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("options");
  });

  test("CV-12: non-disabled variant with options passes", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { variants: { fast: { options: { temperature: 0.1 } } } } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-13: disabled variant without options passes", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { variants: { fast: { disabled: true } } } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-14: axis without id throws", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { axes: [{ label: "No ID" }] as any } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("id");
  });

  test("CV-15: axis without label throws", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: { "qwen3-8b": { axes: [{ id: "mode" }] as any } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("label");
  });

  test("CV-16: axis with id and label passes", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: {
        "qwen3-8b": {
          axes: [{ id: "mode", label: "Mode" }],
        },
      },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-17: legacy interleaved key rejected with renaming guidance", () => {
    const config = {
      type: "pi",
      models: {
        "deepseek-chat": { interleaved: "reasoning_content" },
      },
    };
    expect(() => validatePiEngineConfig(config as PiEngineConfig)).toThrow(/thinkingFormat/);
  });

  test("CV-18: invalid thinkingFormat rejected", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: {
        "deepseek-chat": { thinkingFormat: "not-a-format" as never },
      },
    };
    expect(() => validatePiEngineConfig(config)).toThrow(/thinkingFormat/);
  });

  test("CV-19: valid thinkingFormat passes", () => {
    const config: PiEngineConfig = {
      type: "pi",
      models: {
        "deepseek-chat": { thinkingFormat: "deepseek" },
      },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-20: provider timeout_ms = 0 throws with message naming the field", () => {
    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", timeout_ms: 0 } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("timeout_ms");
  });

  test("CV-21: provider timeout_ms < 0 throws", () => {
    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", timeout_ms: -1 } },
    };
    expect(() => validatePiEngineConfig(config)).toThrow("timeout_ms");
  });

  test("CV-22: provider timeout_ms > 0 passes", () => {
    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", timeout_ms: 600_000 } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });

  test("CV-23: provider timeout_ms omitted passes (all optional)", () => {
    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1" } },
    };
    expect(() => validatePiEngineConfig(config)).not.toThrow();
  });
});
