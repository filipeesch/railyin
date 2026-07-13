import { describe, test, expect } from "bun:test";
import { PiModelBuilder, DEFAULT_MAX_TOKENS } from "../../engine/pi/model-builder.ts";
import type { PiEngineConfig } from "../../config/index.ts";

describe("PiModelBuilder", () => {
  test("MB-1: builds model with provider and base_url from config", () => {
    const config: PiEngineConfig = {
      type: "pi",
      model: "pi/lmstudio/my-model",
      providers: {
        lmstudio: { base_url: "http://localhost:1234/v1" },
      },
    };
    const builder = new PiModelBuilder(config);
    const model = builder.build("pi/lmstudio/my-model", 128_000);

    expect(model.id).toBe("my-model");
    expect(model.name).toBe("lmstudio/my-model");
    expect(model.provider).toBe("lmstudio");
    expect(model.baseUrl).toBe("http://localhost:1234/v1");
    expect(model.contextWindow).toBe(128_000);
    expect(model.maxTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(model.api).toBe("openai-completions");
  });

  test("MB-2: falls back to config.model when modelOverride is undefined", () => {
    const config: PiEngineConfig = {
      type: "pi",
      model: "pi/ollama/llama3",
      providers: {
        ollama: { base_url: "http://localhost:11434/v1" },
      },
    };
    const builder = new PiModelBuilder(config);
    const model = builder.build(undefined, 32_768);

    expect(model.id).toBe("llama3");
    expect(model.name).toBe("ollama/llama3");
    expect(model.provider).toBe("ollama");
  });

  test("MB-3: uses default base_url when provider is not configured", () => {
    const config: PiEngineConfig = { type: "pi" };
    const builder = new PiModelBuilder(config);
    const model = builder.build("pi/unknown/model", 64_000);

    expect(model.provider).toBe("unknown");
    expect(model.baseUrl).toBe("http://localhost:1234/v1");
  });

  test("MB-4: throws when contextWindowOverride is undefined", () => {
    const config: PiEngineConfig = { type: "pi", model: "pi/lmstudio/model" };
    const builder = new PiModelBuilder(config);
    expect(() => builder.build("pi/lmstudio/model", undefined)).toThrow(
      /No context window configured/,
    );
  });

  test("MB-5: strips engine prefix from qualified model id", () => {
    const config: PiEngineConfig = {
      type: "pi",
      providers: {
        lmstudio: { base_url: "http://lmstudio:1234/v1" },
      },
    };
    const builder = new PiModelBuilder(config);
    const model = builder.build("pi/lmstudio/qwen", 128_000);

    expect(model.id).toBe("qwen");
    expect(model.name).toBe("lmstudio/qwen");
  });

  test("MB-6: warns when LM Studio provider has max_inflight > 2", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

    const config: PiEngineConfig = {
      type: "pi",
      providers: {
        lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 8 },
      },
    };
    const builder = new PiModelBuilder(config);
    builder.warnIfLmStudioOverloaded("lmstudio");

    console.warn = originalWarn;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("max_inflight=8");
    expect(warnings[0]).toContain("LM Studio");
  });

  test("MB-7: does not warn for non-LM-Studio providers", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

    const config: PiEngineConfig = {
      type: "pi",
      providers: {
        openai: { base_url: "https://api.openai.com/v1", max_inflight: 8 },
      },
    };
    const builder = new PiModelBuilder(config);
    builder.warnIfLmStudioOverloaded("openai");

    console.warn = originalWarn;
    expect(warnings).toHaveLength(0);
  });
});
