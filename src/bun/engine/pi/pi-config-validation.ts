import type { PiEngineConfig } from "../../config/index.ts";

/**
 * Validates a PiEngineConfig at construction time.
 * Throws a descriptive Error for any constraint violation.
 */
export function validatePiEngineConfig(config: PiEngineConfig): void {
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

  for (const [modelId, modelCfg] of Object.entries(config.models ?? {})) {
    const { limit, variants, sampling_presets, axes } = modelCfg;
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
