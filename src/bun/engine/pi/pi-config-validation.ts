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
}
