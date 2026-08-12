import { describe, test, expect } from "bun:test";
import { resolvePiApiMode, DEFAULT_API_MODE, type PiApiMode } from "../../engine/pi/api-mode.ts";
import type { PiEngineConfig } from "../../config/index.ts";

describe("resolvePiApiMode", () => {
  test("AM-1: engine-level api applies to all providers", () => {
    const config: PiEngineConfig = {
      type: "pi",
      api: "openai-responses",
      providers: {
        vllm: { base_url: "http://localhost:8000/v1" },
        ollama: { base_url: "http://localhost:11434/v1" },
      },
    };
    expect(resolvePiApiMode(config, "vllm")).toBe("openai-responses");
    expect(resolvePiApiMode(config, "ollama")).toBe("openai-responses");
  });

  test("AM-2: provider override wins over engine default", () => {
    const config: PiEngineConfig = {
      type: "pi",
      api: "openai-responses",
      providers: {
        lmstudio: { base_url: "http://localhost:1234/v1", api: "openai-completions" },
        vllm: { base_url: "http://localhost:8000/v1" },
      },
    };
    expect(resolvePiApiMode(config, "lmstudio")).toBe("openai-completions");
    expect(resolvePiApiMode(config, "vllm")).toBe("openai-responses");
  });

  test("AM-3: absent api defaults to openai-responses", () => {
    const config: PiEngineConfig = { type: "pi" };
    expect(DEFAULT_API_MODE).toBe("openai-responses");
    expect(resolvePiApiMode(config, "lmstudio")).toBe("openai-responses");
  });

  test("AM-4: unknown provider name falls back to engine default", () => {
    const config: PiEngineConfig = {
      type: "pi",
      api: "openai-completions",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1" } },
    };
    expect(resolvePiApiMode(config, "not-configured")).toBe("openai-completions");
  });

  test("AM-5: unconfigured provider prefix falls back to engine default (no providers map)", () => {
    const config: PiEngineConfig = { type: "pi", api: "openai-completions" };
    expect(resolvePiApiMode(config, "mystery")).toBe("openai-completions");
  });

  test("AM-6: unprefixed model (default provider) resolves from engine default", () => {
    const config: PiEngineConfig = { type: "pi", api: "openai-completions" };
    expect(resolvePiApiMode(config, undefined)).toBe("openai-completions");
  });

  test("AM-7: provider override on a provider configured without api uses engine default", () => {
    const config: PiEngineConfig = {
      type: "pi",
      api: "openai-completions",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1" } },
    };
    expect(resolvePiApiMode(config, "lmstudio")).toBe("openai-completions");
  });

  test("AM-8: default provider (unprefixed) is unaffected by another provider's override", () => {
    const config: PiEngineConfig = {
      type: "pi",
      api: "openai-responses",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", api: "openai-completions" } },
    };
    expect(resolvePiApiMode(config, undefined)).toBe("openai-responses");
  });

  test("AM-9: exhaustive — all union values are resolvable", () => {
    const modes: PiApiMode[] = ["openai-completions", "openai-responses"];
    for (const mode of modes) {
      const config: PiEngineConfig = { type: "pi", api: mode };
      expect(resolvePiApiMode(config, "x")).toBe(mode);
    }
  });
});
