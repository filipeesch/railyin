import type { JSONSchema7 } from "json-schema";

/**
 * Normalize tool arguments from LLMs that serialize array/object parameters
 * as JSON strings. For example, `{ questions: "[{...}]" }` → `{ questions: [{...}] }`.
 *
 * This is a standalone, testable function that can be used across agent paths
 * (Pi engine via `prepareArguments`, Claude adapter, Copilot engine, etc.).
 *
 * - Only parses string values when schema declares `type: "array"` or `type: "object"`
 * - Skips `type: "string"`, `type: "number"`, `type: "boolean"`, `null`
 * - Catches `JSON.parse` errors and preserves original string on failure
 * - Validates parsed result is a valid array/object; discards if not
 * - Skims allOf/anyOf/oneOf — TODO: implement when a real schema uses them
 */
export function normalizeToolArguments(
  schema: JSONSchema7,
  rawArgs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rawArgs };
  const properties = (schema.properties ?? {}) as Record<string, JSONSchema7>;

  for (const [key, prop] of Object.entries(properties)) {
    const value = result[key];

    // Non-string values pass through — no need to parse
    if (typeof value !== "string") continue;

    // Only parse arrays and objects
    if (!(prop.type === "array" || prop.type === "object")) continue;

    // Skip allOf/anyOf/oneOf — TODO: implement when a real schema uses them
    if (Array.isArray(prop.allOf) || Array.isArray(prop.anyOf) || Array.isArray(prop.oneOf)) {
      continue;
    }

    try {
      const parsed = JSON.parse(value);

      // Validate parsed result matches expected type
      if ((prop.type === "array" && Array.isArray(parsed)) ||
          (prop.type === "object" && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))) {
        result[key] = parsed;
      }
      // Otherwise: discard parsed value, keep original string
    } catch {
      // JSON.parse failed — keep original string
    }
  }

  return result;
}
