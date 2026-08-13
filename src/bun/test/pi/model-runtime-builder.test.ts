import { describe, test, expect } from "bun:test";
import { buildPiModelRuntime, DEFAULT_PROVIDER_BASE_URL, DEFAULT_PROVIDER_API_KEY } from "../../engine/pi/model-runtime-builder.ts";
import type { PiEngineConfig } from "../../config/index.ts";

describe("buildPiModelRuntime", () => {
  test("MRB-1: registers every configured provider with baseUrl, apiKey, and resolved api", async () => {
    const config: PiEngineConfig = {
      type: "pi",
      api: "openai-responses",
      providers: {
        lmstudio: { base_url: "http://localhost:1234/v1", api_key: "secret", api: "openai-completions" },
        vllm: { base_url: "http://localhost:8000/v1" },
      },
    };

    const runtime = await buildPiModelRuntime(config);

    const lmstudio = runtime.getRegisteredProviderConfig("lmstudio");
    expect(lmstudio).toBeDefined();
    expect(lmstudio!.baseUrl).toBe("http://localhost:1234/v1");
    expect(lmstudio!.apiKey).toBe("secret");
    expect(lmstudio!.api).toBe("openai-completions");

    const vllm = runtime.getRegisteredProviderConfig("vllm");
    expect(vllm).toBeDefined();
    expect(vllm!.baseUrl).toBe("http://localhost:8000/v1");
    expect(vllm!.apiKey).toBe(DEFAULT_PROVIDER_API_KEY);
    expect(vllm!.api).toBe("openai-responses");
  });

  test("MRB-2: provider api override reflected in registration", async () => {
    const config: PiEngineConfig = {
      type: "pi",
      api: "openai-responses",
      providers: {
        lmstudio: { base_url: "http://localhost:1234/v1", api: "openai-completions" },
      },
    };

    const runtime = await buildPiModelRuntime(config);
    expect(runtime.getRegisteredProviderConfig("lmstudio")?.api).toBe("openai-completions");
  });

  test("MRB-3: default fallback provider registered for unprefixed models", async () => {
    const config: PiEngineConfig = { type: "pi", api: "openai-completions" };

    const runtime = await buildPiModelRuntime(config);
    const defaultProvider = runtime.getRegisteredProviderConfig("default");
    expect(defaultProvider).toBeDefined();
    expect(defaultProvider!.baseUrl).toBe(DEFAULT_PROVIDER_BASE_URL);
    expect(defaultProvider!.api).toBe("openai-completions");
  });

  test("MRB-4: configured provider named 'default' is not double-registered", async () => {
    const config: PiEngineConfig = {
      type: "pi",
      providers: {
        default: { base_url: "http://custom:9999/v1", api_key: "custom-key" },
      },
    };

    const runtime = await buildPiModelRuntime(config);
    const defaultProvider = runtime.getRegisteredProviderConfig("default");
    expect(defaultProvider).toBeDefined();
    expect(defaultProvider!.baseUrl).toBe("http://custom:9999/v1");
    expect(defaultProvider!.apiKey).toBe("custom-key");
  });

  test("MRB-5: getAuth resolves the runtime api key (wiring proven)", async () => {
    const config: PiEngineConfig = {
      type: "pi",
      providers: {
        lmstudio: { base_url: "http://localhost:1234/v1", api_key: "my-key" },
      },
    };

    const runtime = await buildPiModelRuntime(config);
    const auth = await runtime.getAuth("lmstudio");
    expect(auth).toBeDefined();
    expect(auth!.auth.apiKey).toBe("my-key");
  });

  test("MRB-6: getAuth resolves the no-key fallback for unconfigured providers", async () => {
    const config: PiEngineConfig = { type: "pi" };

    const runtime = await buildPiModelRuntime(config);
    const auth = await runtime.getAuth("default");
    expect(auth).toBeDefined();
    expect(auth!.auth.apiKey).toBe(DEFAULT_PROVIDER_API_KEY);
  });

  test("MRB-7: creation performs no catalog network refresh (refreshOnCreate false)", async () => {
    // Building must succeed without network; the runtime starts with no
    // availability refresh and providers are registered by Railyin.
    const config: PiEngineConfig = {
      type: "pi",
      providers: {
        lmstudio: { base_url: "http://localhost:1234/v1" },
      },
    };

    const runtime = await buildPiModelRuntime(config);
    const providers = runtime.getProviders();
    expect(providers.some((p) => p.id === "lmstudio")).toBe(true);
  });
});
