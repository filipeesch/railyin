/**
 * PiModelBuilder — constructs the Pi SDK Model object from engine configuration.
 *
 * Resolves provider name and base URL from a qualified model ID and the engine
 * config's provider map. Warns when LM Studio is configured with an inflight
 * concurrency greater than 2 (LM Studio handles 1–2 concurrent requests).
 */

import type { PiEngineConfig } from "../../config/index.ts";
import type { Model } from "@earendil-works/pi-ai";
import { PROVIDER_LIMITER_DEFAULTS } from "./provider-limiter.ts";
import { nativeModelIdFor, resolvePiModelConfig } from "./model-config.ts";
import { resolvePiApiMode, type PiApiMode } from "./api-mode.ts";

/** Default max tokens per response. */
export const DEFAULT_MAX_TOKENS = 8_192;

function isLmStudioUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const { hostname, port } = new URL(baseUrl);
    return (hostname === "localhost" || hostname === "127.0.0.1") && port === "1234";
  } catch {
    return false;
  }
}

export class PiModelBuilder {
  constructor(private readonly config: PiEngineConfig) {}

  /**
   * Build the Pi SDK Model object for the given model identifier and context window.
   * Throws if contextWindowOverride is null — every Pi session requires a known
   * context window to compute compaction thresholds.
   */
  build(modelOverride: string | undefined, contextWindowOverride: number | undefined): Model<PiApiMode> {
    const modelStr = modelOverride ?? this.config.model ?? "default";

    const nativeId = nativeModelIdFor(modelStr);
    const slash = nativeId.indexOf("/");
    const providerName = slash !== -1 ? nativeId.slice(0, slash) : undefined;
    const modelId = slash !== -1 ? nativeId.slice(slash + 1) : nativeId;

    const providerConfig = providerName ? this.config.providers?.[providerName] : undefined;
    const baseUrl = providerConfig?.base_url ?? "http://localhost:1234/v1";

    if (contextWindowOverride == null) {
      throw new Error(
        `No context window configured for model "${modelStr}". ` +
        "Set the context window in model settings before using this model.",
      );
    }

    const modelCfg = resolvePiModelConfig(this.config, nativeId);
    const reasoning = modelCfg?.reasoning ?? true;
    const thinkingFormat = modelCfg?.thinkingFormat;
    const apiMode = resolvePiApiMode(this.config, providerName);

    const compat: Record<string, unknown> = { supportsDeveloperRole: false };
    // `thinkingFormat` is a completions-only compat knob (OpenAICompletionsCompat);
    // under `openai-responses` the compat shape differs and the SDK ignores unknown
    // keys, so it is silently dropped to keep the object type-legal.
    if (apiMode === "openai-completions" && thinkingFormat !== undefined) {
      compat.thinkingFormat = thinkingFormat;
      // DeepSeek streams reasoning in a separate `reasoning_content` field on assistant
      // messages; the SDK must replay/send that field to keep the conversation coherent.
      if (thinkingFormat === "deepseek" || (thinkingFormat === "openrouter" && nativeId.toLowerCase().includes("deepseek"))) {
        compat.requiresReasoningContentOnAssistantMessages = true;
      }
    }

    return {
      id: modelId,
      name: nativeId,
      api: apiMode,
      provider: providerName ?? "default",
      baseUrl,
      reasoning,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindowOverride,
      maxTokens: DEFAULT_MAX_TOKENS,
      compat,
    } as unknown as Model<PiApiMode>;
  }

  /** Log a warning when LM Studio is configured with high concurrency. */
  warnIfLmStudioOverloaded(providerName: string): void {
    const cfg = this.config.providers?.[providerName];
    if (!cfg) return;
    const maxInflight = cfg.max_inflight ?? PROVIDER_LIMITER_DEFAULTS.max_inflight;
    if (maxInflight > 2 && isLmStudioUrl(cfg.base_url)) {
      console.warn(
        `[pi] Provider "${providerName}" has max_inflight=${maxInflight} but base_url looks like LM Studio (:1234). ` +
        "LM Studio handles 1-2 concurrent requests; reduce max_inflight to 1 or 2.",
      );
    }
  }
}
