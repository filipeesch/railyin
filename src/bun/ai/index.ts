import type { AIProvider } from "./types.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import { FakeAIProvider } from "./fake.ts";
import type { AIProviderConfig } from "../config/index.ts";

export function createProvider(config: AIProviderConfig): AIProvider {
  if (config.provider === "fake" || !config.base_url) {
    console.log("[ai] Using FakeAIProvider");
    return new FakeAIProvider();
  }

  console.log(`[ai] Using OpenAICompatibleProvider → ${config.base_url} (${config.model})`);
  return new OpenAICompatibleProvider(config.base_url, config.api_key ?? "", config.model);
}

export type { AIProvider };
