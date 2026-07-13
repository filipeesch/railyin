/**
 * PiModelBuilder — constructs the Pi SDK Model object from engine configuration.
 *
 * Resolves provider name and base URL from a qualified model ID and the engine
 * config's provider map. Warns when LM Studio is configured with an inflight
 * concurrency greater than 2 (LM Studio handles 1–2 concurrent requests).
 */

import type { PiEngineConfig } from "../../config/index.ts";
import { QualifiedModelId } from "../qualified-model-id.ts";
import type { Model } from "@earendil-works/pi-ai";
import { PROVIDER_LIMITER_DEFAULTS } from "./provider-limiter.ts";

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
  build(modelOverride: string | undefined, contextWindowOverride: number | undefined): Model<"openai-completions"> {
    const modelStr = modelOverride ?? this.config.model ?? "default";

    const qmid = QualifiedModelId.tryParse(modelStr);
    const nativeId = qmid?.nativeModelId() ?? modelStr;
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

    return {
      id: modelId,
      name: nativeId,
      api: "openai-completions",
      provider: providerName ?? "default",
      baseUrl,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindowOverride,
      maxTokens: DEFAULT_MAX_TOKENS,
      compat: { supportsDeveloperRole: false },
    } as unknown as Model<"openai-completions">;
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
