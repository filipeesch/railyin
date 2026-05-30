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
});
