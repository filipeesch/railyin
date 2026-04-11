import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../common-tools.ts";
import type { CommonToolContext, EngineEvent } from "../types.ts";

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
    Object.entries(args).map(([key, value]) => [key, value == null ? "" : String(value)]),
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
  emit: (event: EngineEvent) => void,
): unknown {
  const tools = COMMON_TOOL_DEFINITIONS.map((def) => sdk.tool(
    def.name,
    def.description,
    jsonSchemaToZodShape(z, def.parameters as Record<string, unknown>),
    async (args: Record<string, unknown>) => {
      const callId = `claude_tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      emit({
        type: "tool_start",
        name: def.name,
        arguments: JSON.stringify(args ?? {}),
        callId,
      });

      try {
        const result = await executeCommonTool(def.name, toToolArgs(args ?? {}), context);
        emit({
          type: "tool_result",
          name: def.name,
          result,
          callId,
        });
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({
          type: "tool_result",
          name: def.name,
          result: message,
          callId,
          isError: true,
        });
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
