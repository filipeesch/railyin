import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../common-tools.ts";
import type { CommonToolContext } from "../types.ts";
import type { FileDiffPayload } from "../../../shared/rpc-types.ts";

type ZodLike = {
  string: () => { optional: () => unknown };
  number: () => { optional: () => unknown };
  boolean: () => { optional: () => unknown };
  any: () => { optional: () => unknown };
};

type ClaudeSdkRuntime = {
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<Record<string, unknown>>,
  ) => unknown;
  createSdkMcpServer: (options: { name: string; version?: string; tools?: unknown[] }) => unknown;
};

function toToolArgs(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value === "string") return [key, value];
      if (value == null) return [key, ""];
      try {
        return [key, JSON.stringify(value)];
      } catch {
        return [key, String(value)];
      }
    }),
  );
}

function schemaPropToZod(z: ZodLike, prop: Record<string, unknown>, required: boolean): unknown {
  const type = typeof prop.type === "string" ? prop.type : "string";
  let base;
  switch (type) {
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "string":
      base = z.string();
      break;
    default:
      base = z.any();
      break;
  }
  return required ? base : base.optional();
}

function jsonSchemaToZodShape(z: ZodLike, schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
  return Object.fromEntries(
    Object.entries(properties).map(([name, prop]) => [name, schemaPropToZod(z, prop, required.has(name))]),
  );
}

export function buildClaudeToolServer(
  sdk: ClaudeSdkRuntime,
  z: ZodLike,
  context: CommonToolContext,
): unknown {
  const tools = COMMON_TOOL_DEFINITIONS.map((def) => sdk.tool(
    def.name,
    def.description,
    jsonSchemaToZodShape(z, def.parameters as Record<string, unknown>),
    async (args: Record<string, unknown>) => {
      try {
        const result = await executeCommonTool(def.name, toToolArgs(args ?? {}), context);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  ));

  return sdk.createSdkMcpServer({
    name: "railyin",
    version: "0.1.0",
    tools,
  });
}

export function extractWrittenFilesFromResult(result: string): FileDiffPayload[] | undefined {
  try {
    const parsed = JSON.parse(result) as { writtenFiles?: unknown };
    if (!Array.isArray(parsed.writtenFiles)) return undefined;
    return parsed.writtenFiles.filter((entry): entry is FileDiffPayload => {
      return !!entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string";
    });
  } catch {
    return undefined;
  }
}
