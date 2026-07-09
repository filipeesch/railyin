import type { ModelSettingsInfo } from "../../shared/rpc-types.ts";
import type { EngineModelInfo } from "../engine/types.ts";

interface NormalizedModelSettings {
  modelSettings: ModelSettingsInfo;
  rawModelSettings: Record<string, unknown> | null;
}

export function normalizeModelSettings(model: EngineModelInfo | undefined): NormalizedModelSettings {
  const engineId = model?.qualifiedId?.split("/")[0] ?? null;
  const fromEngine = sanitizeValues(model?.supportedReasoningModes);
  // Strict discovery: only derive Cursor options from explicit SDK metadata.
  const fromCursor = engineId === "cursor"
    ? inferCursorReasoningModes(model?.rawReasoningModeMetadata ?? null)
    : [];
  const supportedValues = dedupeValues(fromEngine.length > 0 ? fromEngine : fromCursor);

  const defaultValue = normalizeDefault(
    model?.defaultReasoningMode ?? null,
    supportedValues,
    engineId === "cursor" ? inferCursorDefaultMode(model?.rawReasoningModeMetadata ?? null, supportedValues) : null,
  );

  return {
    modelSettings: {
      reasoningMode: {
        supportedValues,
        defaultValue,
        visible: supportedValues.length > 0,
      },
    },
    rawModelSettings: (model?.rawReasoningModeMetadata as Record<string, unknown> | undefined) ?? null,
  };
}

function sanitizeValues(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => String(v).trim()).filter((v) => v.length > 0);
}

function dedupeValues(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeDefault(
  explicitDefault: string | null,
  supportedValues: string[],
  fallbackDefault: string | null,
): string | null {
  if (explicitDefault && supportedValues.includes(explicitDefault)) return explicitDefault;
  if (fallbackDefault && supportedValues.includes(fallbackDefault)) return fallbackDefault;
  return null;
}

function inferCursorReasoningModes(raw: Record<string, unknown> | null): string[] {
  if (!raw) return [];
  const candidates = [
    ...extractCursorCandidates(raw.variants, "variants"),
    ...extractCursorCandidates(raw.parameters, "parameters"),
  ];
  return dedupeValues(
    candidates
      // Keep only labels that clearly communicate reasoning/effort semantics.
      .filter((candidate) => isCursorReasoningSemantic(candidate.label))
      .map((candidate) => candidate.value),
  );
}

function inferCursorDefaultMode(raw: Record<string, unknown> | null, supportedValues: string[]): string | null {
  if (!raw) return null;
  const candidates = [
    ...extractCursorCandidates(raw.variants, "variants"),
    ...extractCursorCandidates(raw.parameters, "parameters"),
  ];
  const defaultCandidate = candidates.find(
    (candidate) => candidate.isDefault && supportedValues.includes(candidate.value),
  );
  return defaultCandidate?.value ?? null;
}

function extractCursorCandidates(
  source: unknown,
  sourceKind: "variants" | "parameters",
): Array<{ value: string; label: string; isDefault: boolean }> {
  if (!Array.isArray(source)) return [];
  const output: Array<{ value: string; label: string; isDefault: boolean }> = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const label =
      asString(item.label) ??
      asString(item.displayName) ??
      asString(item.name) ??
      asString(item.title) ??
      asString(item.id) ??
      asString(item.value);
    if (!label) continue;
    output.push({
      value: label,
      label,
      isDefault:
        item.isDefault === true ||
        item.default === true ||
        (sourceKind === "parameters" && item.selected === true),
    });
  }
  return output;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCursorReasoningSemantic(label: string): boolean {
  return /\b(fast|normal|balanced|deep|reason|thinking|effort|quality|slow)\b/i.test(label);
}
