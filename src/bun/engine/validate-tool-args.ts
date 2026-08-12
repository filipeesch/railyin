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
 * Resolve the JSON Schema node at a given AJV instancePath relative to the
 * tool's parameters schema. Supports nested `properties` and array `items`
 * traversal (e.g. `/question` → parameters.properties.question).
 */
function schemaNodeAtPath(
  root: Record<string, unknown>,
  instancePath: string,
): Record<string, unknown> | undefined {
  const segments = instancePath.split("/").filter((s) => s.length > 0 && !/^\d+$/.test(s));
  let node: Record<string, unknown> = root;
  for (const segment of segments) {
    const props = node.properties as Record<string, unknown> | undefined;
    if (props && typeof props[segment] === "object") {
      node = props[segment] as Record<string, unknown>;
      continue;
    }
    // Array items traversal: the segment matched an object property whose
    // schema has `items` (e.g. `/questions` → items → then child segments
    // descend into the item object's properties).
    if (node.items && typeof node.items === "object") {
      node = node.items as Record<string, unknown>;
      const itemProps = node.properties as Record<string, unknown> | undefined;
      if (itemProps && typeof itemProps[segment] === "object") {
        node = itemProps[segment] as Record<string, unknown>;
        continue;
      }
    }
    return undefined;
  }
  // A `required` error's instancePath points at the parent object that is
  // missing the property. If that parent is an array schema (has `items` but
  // no `properties`), descend into the item schema to resolve the property.
  if (node.properties === undefined && node.items && typeof node.items === "object") {
    node = node.items as Record<string, unknown>;
  }
  return node;
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
        // Schema-aware hint: if the missing property declares an enum, list its
        // valid values so the model can self-correct (e.g. question.type).
        const node = schemaNodeAtPath(
          (def.parameters ?? {}) as Record<string, unknown>,
          err.instancePath,
        );
        const nodeProps = (node?.properties ?? {}) as Record<string, unknown>;
        const missingProp = nodeProps[missing] as Record<string, unknown> | undefined;
        if (missingProp && Array.isArray(missingProp.enum)) {
          const allowedStr = (missingProp.enum as unknown[]).map((v) => `"${v}"`).join(", ");
          const fullField = field ? `${field}.${missing}` : missing;
          return `Error: field '${fullField}' is required (valid values: ${allowedStr})`;
        }
        const fullField = field ? `${field}.${missing}` : missing;
        return `Error: field '${fullField}' is required`;
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
