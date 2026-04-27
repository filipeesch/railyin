import Ajv from "ajv";
import type { AIToolDefinition } from "../ai/types.ts";

const ajv = new Ajv({ allErrors: true, verbose: true });

const validatorCache = new Map<string, ReturnType<typeof ajv.compile>>();

function fieldPath(instancePath: string): string {
  return instancePath
    .replace(/^\//, "")
    .replace(/\/(\d+)/g, "[$1]")
    .replace(/\//g, ".");
}

/**
 * Validates tool arguments against the tool's JSON Schema definition.
 * Returns a human-readable error string if invalid, or null if valid.
 * Error messages name the invalid field and, for enums, list valid options.
 */
export function validateToolArgs(def: AIToolDefinition, args: unknown): string | null {
  let validate = validatorCache.get(def.name);
  if (!validate) {
    validate = ajv.compile(def.parameters as object);
    validatorCache.set(def.name, validate);
  }

  if (validate(args)) return null;

  const errors = validate.errors ?? [];
  const messages = errors.map((err) => {
    const field = fieldPath(err.instancePath);
    const data = (err as { data?: unknown }).data;

    switch (err.keyword) {
      case "required": {
        const missing = (err.params as { missingProperty: string }).missingProperty;
        return `Error: field '${missing}' is required`;
      }
      case "enum": {
        const allowed = (err.params as { allowedValues: unknown[] }).allowedValues;
        const allowedStr = allowed.map((v) => `"${v}"`).join(", ");
        return `Error: field '${field}' has invalid value ${JSON.stringify(data)}. Valid values are: ${allowedStr}`;
      }
      case "type": {
        const expectedType = (err.params as { type: string }).type;
        return `Error: field '${field}' must be ${expectedType}, got ${typeof data}`;
      }
      case "minItems": {
        const min = (err.params as { limit: number }).limit;
        return `Error: field '${field}' must have at least ${min} item(s)`;
      }
      default:
        return `Error: field '${field || "(root)"}' failed validation (${err.keyword}: ${err.message ?? ""})`;
    }
  });

  return messages.join("; ");
}
