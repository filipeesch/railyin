import type { PiEngineConfig, PiApiMode } from "../../config/index.ts";

const VALID_API_MODES = new Set<PiApiMode>(["openai-completions", "openai-responses"]);

/**
 * Validates a PiEngineConfig at construction time.
 * Throws a descriptive Error for any constraint violation.
 */
export function validatePiEngineConfig(config: PiEngineConfig): void {
  if (config.api !== undefined && !VALID_API_MODES.has(config.api)) {
    throw new Error(
      `Pi engine config: api must be one of: openai-completions, openai-responses — got: ${config.api}`,
    );
  }

  for (const [providerName, providerCfg] of Object.entries(config.providers ?? {})) {
    if (providerCfg.api !== undefined && !VALID_API_MODES.has(providerCfg.api)) {
      throw new Error(
        `Pi engine config: providers.${providerName}.api must be one of: openai-completions, openai-responses — got: ${providerCfg.api}`,
      );
    }
  }

  const maxPerCall = config.harness?.delegate?.max_per_call;
  if (maxPerCall != null && (maxPerCall < 1 || maxPerCall > 10)) {
    throw new Error(
      `Pi engine config: harness.delegate.max_per_call must be between 1 and 10, got: ${maxPerCall}`,
    );
  }

  const earlyMargin = config.harness?.background_compaction?.early_margin_tokens;
  if (earlyMargin != null && earlyMargin < 1024) {
    throw new Error(
      `Pi engine config: harness.background_compaction.early_margin_tokens must be >= 1024, got: ${earlyMargin}`,
    );
  }

  const VALID_THINKING_FORMATS = new Set([
    "openai", "openrouter", "deepseek", "together", "zai", "qwen",
    "chat-template", "qwen-chat-template", "string-thinking", "ant-ling",
  ]);

  for (const [modelId, modelCfg] of Object.entries(config.models ?? {})) {
    const { limit, variants, sampling_presets, axes, thinkingFormat } = modelCfg;
    // Legacy configs may still carry `interleaved` (removed from the type). Catch it at runtime
    // with a clear migration pointer rather than silently dropping it.
    const legacyInterleaved = (modelCfg as Record<string, unknown>).interleaved;
    if (legacyInterleaved !== undefined) {
      throw new Error(
        `Pi engine config: models.${modelId}.interleaved is no longer supported — rename it to "thinkingFormat" (e.g. thinkingFormat: deepseek)`,
      );
    }
    if (thinkingFormat !== undefined && !VALID_THINKING_FORMATS.has(thinkingFormat)) {
      throw new Error(
        `Pi engine config: models.${modelId}.thinkingFormat must be one of: ${[...VALID_THINKING_FORMATS].join(", ")}, got: ${thinkingFormat}`,
      );
    }
    if (limit) {
      if (limit.context != null && limit.context <= 0) {
        throw new Error(
          `Pi engine config: models.${modelId}.limit.context must be > 0, got: ${limit.context}`,
        );
      }
      if (limit.output != null && limit.output <= 0) {
        throw new Error(
          `Pi engine config: models.${modelId}.limit.output must be > 0, got: ${limit.output}`,
        );
      }
    }
    for (const [variantName, variantCfg] of Object.entries(variants ?? {})) {
      if (variantCfg.disabled !== true) {
        const invalid = Object.keys(variantCfg).filter(
          (k) => k !== "disabled" && !["label"].includes(k),
        );
        if (invalid.length === 0) {
          throw new Error(
            `Pi engine config: models.${modelId}.variants.${variantName} must define request-body params (options) unless disabled`,
          );
        }
      }
    }
    for (const axis of axes ?? []) {
      if (!axis.id || !axis.label) {
        throw new Error(
          `Pi engine config: models.${modelId}.axes entries require 'id' and 'label'`,
        );
      }
    }
  }
}
