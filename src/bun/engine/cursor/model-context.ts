/**
 * Cursor model context-window resolution.
 *
 * The `@cursor/sdk` `ModelListItem` does not expose a `contextWindow` field;
 * the model's context is conveyed by a `context` model parameter (values like
 * `300k`, `1m`, `272k`) and/or a context-qualified model id suffix
 * (`cursor/gpt-5.5@272k`). This module derives a real context window so the
 * context gauge / warning reflect the actual model capability instead of a
 * hardcoded 128k.
 *
 * Resolution order:
 *   1. the model's `context` parameter (max explicit numeric value),
 *   2. a `@<size>` suffix in the model id,
 *   3. a bundled fallback snapshot for known models,
 *   4. `undefined` (graceful — `resolveContextWindow` falls back sanely).
 */

export interface CursorModelParameter {
  id?: string;
  values?: Array<{ value?: string }>;
}

/** Parse a Cursor size token ("300k" | "1m" | "272000") into an integer, or NaN. */
export function parseCursorToken(value: string): number {
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/.exec(trimmed);
  if (!match) return Number.NaN;
  const num = Number(match[1]);
  const unit = match[2];
  if (unit === "k") return num * 1000;
  if (unit === "m") return num * 1_000_000;
  return num;
}

/**
 * Largest explicit numeric value of the model's `context` parameter. Returns
 * `undefined` when the parameter is absent or has no parseable numeric value.
 */
export function parseContextWindowFromParams(parameters: CursorModelParameter[] | undefined): number | undefined {
  if (!Array.isArray(parameters)) return undefined;
  const contextParam = parameters.find((p) => p.id === "context");
  const values = contextParam?.values;
  if (!Array.isArray(values)) return undefined;
  const sizes = values
    .map((v) => (typeof v.value === "string" ? parseCursorToken(v.value) : Number.NaN))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (sizes.length === 0) return undefined;
  return Math.max(...sizes);
}

/** Parse a `@<size>` suffix in the model id (e.g. `gpt-5.5@272k`). */
export function parseContextWindowFromId(modelId: string | undefined): number | undefined {
  if (!modelId) return undefined;
  const match = /@(\d+(?:\.\d+)?\s*[km]?)\s*$/i.exec(modelId.trim());
  if (!match) return undefined;
  const n = parseCursorToken(match[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Bundled fallback snapshot of known Cursor model context windows, used only
 * when a model's live metadata carries no `context` parameter and no id
 * suffix. These values are seeded from the Cursor model catalog and should be
 * refreshed when new models are introduced. Matched case-insensitively against
 * the base model id (suffix and engine prefix stripped).
 */
const FALLBACK_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4": 300_000,
  "claude-opus-4-8": 300_000,
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5": 200_000,
  "gpt-5": 272_000,
  "gpt-5-5": 272_000,
  "gpt-4-1": 200_000,
  "gpt-4o": 128_000,
  "gemini-2-5-pro": 1_000_000,
  "gemini-2-5-flash": 1_000_000,
  "composer-2-5": 200_000,
  "cursor-small": 200_000,
};

function normalizeModelKey(modelId: string | undefined): string {
  if (!modelId) return "";
  // Remove engine prefix ("cursor/") and any @<size> suffix, lowercase.
  const noPrefix = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  return noPrefix.replace(/@[^@\s]+$/, "").trim().toLowerCase();
}

/** Full resolution: context param → id suffix → bundled snapshot → undefined. */
export function resolveModelContextWindow(
  parameters: CursorModelParameter[] | undefined,
  modelId: string | undefined,
): number | undefined {
  return (
    parseContextWindowFromParams(parameters)
    ?? parseContextWindowFromId(modelId)
    ?? (modelId ? FALLBACK_CONTEXT_WINDOWS[normalizeModelKey(modelId)] : undefined)
  );
}
