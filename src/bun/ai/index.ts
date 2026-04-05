import type { AIProvider } from "./types.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { FakeAIProvider } from "./fake.ts";
import type { ProviderConfig } from "../config/index.ts";
// Keep legacy import for tests/callers that haven't migrated yet
import type { AIProviderConfig } from "../config/index.ts";

export { ProviderError } from "./retry.ts";
export { retryStream, retryTurn } from "./retry.ts";

// ─── Error ────────────────────────────────────────────────────────────────────

export class UnresolvableProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnresolvableProviderError";
  }
}

// ─── Provider registry (cached instances) ────────────────────────────────────

const _registry = new Map<string, AIProvider>();

export function clearProviderCache(): void {
  _registry.clear();
}

function instantiateProvider(config: ProviderConfig, modelId: string): AIProvider {
  if (config.type === "fake") return new FakeAIProvider();
  if (config.type === "anthropic") return new AnthropicProvider(config.api_key ?? "", modelId);
  // openai-compatible / openrouter / lmstudio / ollama all use OpenAICompatibleProvider
  return new OpenAICompatibleProvider(config.base_url ?? "", config.api_key ?? "", modelId);
}

// ─── resolveProvider ─────────────────────────────────────────────────────────

/**
 * Resolve the AIProvider and bare model ID from a fully-qualified model string.
 *
 * @param qualifiedModel - Fully-qualified model ID: `{providerId}/{modelId}`, e.g.
 *   `"anthropic/claude-3-5-sonnet-20241022"` or `"lmstudio/qwen3-8b"`.
 * @param providers - The provider list from the loaded config.
 * @returns `{ provider, model }` where `model` is the un-prefixed ID passed to the API.
 * @throws {UnresolvableProviderError} when model is null/empty or the provider prefix
 *   does not match any configured provider.
 */
export function resolveProvider(
  qualifiedModel: string | null | undefined,
  providers: ProviderConfig[],
): { provider: AIProvider; model: string } {
  if (!qualifiedModel || qualifiedModel.trim() === "") {
    throw new UnresolvableProviderError(
      "No model selected for this task. Please select a model to continue.",
    );
  }

  const slashIdx = qualifiedModel.indexOf("/");
  if (slashIdx === -1) {
    throw new UnresolvableProviderError(
      `Model '${qualifiedModel}' is not a fully-qualified model ID (expected '{providerId}/{modelId}'). Please select a model to continue.`,
    );
  }

  const providerId = qualifiedModel.slice(0, slashIdx);
  const modelId = qualifiedModel.slice(slashIdx + 1);

  const config = providers.find((p) => p.id === providerId);
  if (!config) {
    throw new UnresolvableProviderError(
      `No provider configured for '${providerId}' (from model '${qualifiedModel}'). Please select a model to continue.`,
    );
  }

  // Cache by full qualified model (model is embedded in provider instance)
  if (!_registry.has(qualifiedModel)) {
    _registry.set(qualifiedModel, instantiateProvider(config, modelId));
  }

  return { provider: _registry.get(qualifiedModel)!, model: modelId };
}

// ─── Model list helpers ───────────────────────────────────────────────────────

/** Fetch model list from an OpenAI-compatible provider (LM Studio native + /v1/models fallback). */
export async function listOpenAICompatibleModels(
  config: ProviderConfig,
): Promise<Array<{ id: string; contextWindow: number | null }>> {
  const baseUrl = (config.base_url ?? "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const headers: Record<string, string> = config.api_key
    ? { Authorization: `Bearer ${config.api_key}` }
    : {};

  // Try LM Studio native API first — gives context_length per loaded model
  try {
    const res = await fetch(`${baseUrl}/api/v1/models`, { headers });
    if (res.ok) {
      const json = await res.json() as {
        models?: Array<{
          key: string;
          type?: string;
          loaded_instances?: Array<{ config?: { context_length?: number } }>;
          max_context_length?: number;
        }>;
      };
      const llms = (json.models ?? []).filter((m) => !m.type || m.type === "llm");
      if (llms.length > 0) {
        return llms.map((m) => ({
          id: m.key,
          contextWindow:
            m.loaded_instances?.[0]?.config?.context_length ?? m.max_context_length ?? null,
        }));
      }
    }
  } catch { /* not LM Studio */ }

  // Standard OpenAI-compatible /v1/models
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { headers });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string; context_length?: number }> };
    return (json.data ?? [])
      .filter((m) => Boolean(m.id))
      .map((m) => ({
        id: m.id,
        contextWindow: typeof m.context_length === "number" ? m.context_length : null,
      }));
  } catch {
    return [];
  }
}

// ─── Legacy factory (kept for backward compat) ────────────────────────────────

/** @deprecated Use resolveProvider() instead. */
export function createProvider(config: AIProviderConfig): AIProvider {
  if (config.provider === "fake" || !config.base_url) {
    console.log("[ai] Using FakeAIProvider");
    return new FakeAIProvider();
  }
  console.log(`[ai] Using OpenAICompatibleProvider → ${config.base_url} (${config.model})`);
  return new OpenAICompatibleProvider(config.base_url, config.api_key ?? "", config.model ?? "");
}

export type { AIProvider };
