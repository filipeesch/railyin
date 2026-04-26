import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../common-tools.ts";
import type { CommonToolContext } from "../types.ts";
import type { FileDiffPayload } from "../../../shared/rpc-types.ts";

type ZodScalar = { optional: () => unknown };

type ZodLike = {
  string: () => ZodScalar;
  number: () => ZodScalar;
  boolean: () => ZodScalar;
  any: () => ZodScalar;
  array: (item: unknown) => ZodScalar;
  object: (shape: Record<string, unknown>) => ZodScalar;
  enum: (values: [string, ...string[]]) => ZodScalar;
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
  let base: ZodScalar;
  switch (type) {
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array": {
      const items = (prop.items ?? {}) as Record<string, unknown>;
      base = z.array(schemaPropToZod(z, items, true));
      break;
    }
    case "object":
      base = z.object(jsonSchemaToZodShape(z, prop));
      break;
    case "string":
      if (Array.isArray(prop.enum) && prop.enum.length >= 1) {
        try {
          base = z.enum(prop.enum as [string, ...string[]]);
        } catch {
          base = z.string();
        }
      } else {
        base = z.string();
      }
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

export interface ClaudeToolServer {
  server: unknown;
  /**
   * Atomically reads and clears the pending suspend payload set by the last tool call.
   * Returns `undefined` if no tool suspended during the current turn.
   */
  takePendingSuspend: () => string | undefined;
}

export function buildClaudeToolServer(
  sdk: ClaudeSdkRuntime,
  z: ZodLike,
  context: CommonToolContext,
): ClaudeToolServer {
  // Shared between the tool handler and the PostToolUse hook.
  // The handler sets this when a tool returns a suspend result;
  // the hook reads and clears it — no tool-name awareness needed.
  let pendingSuspendPayload: string | undefined;

  const tools = COMMON_TOOL_DEFINITIONS.map((def) => sdk.tool(
    def.name,
    def.description,
    jsonSchemaToZodShape(z, def.parameters as Record<string, unknown>),
    async (args: Record<string, unknown>) => {
      try {
        const result = await executeCommonTool(def.name, toToolArgs(args ?? {}), context);
        if (result.type === "suspend") {
          pendingSuspendPayload = result.payload;
        }
        const text = result.type === "result" ? result.text : "Interview suspended - awaiting user response.";
        return {
          content: [{ type: "text", text }],
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

  const server = sdk.createSdkMcpServer({
    name: "railyin",
    version: "0.1.0",
    tools,
  });

  return {
    server,
    takePendingSuspend: () => {
      const payload = pendingSuspendPayload;
      pendingSuspendPayload = undefined;
      return payload;
    },
  };
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


type ZodScalar = { optional: () => unknown };

type ZodLike = {
  string: () => ZodScalar;
  number: () => ZodScalar;
  boolean: () => ZodScalar;
  any: () => ZodScalar;
  array: (item: unknown) => ZodScalar;
  object: (shape: Record<string, unknown>) => ZodScalar;
  enum: (values: [string, ...string[]]) => ZodScalar;
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
  let base: ZodScalar;
  switch (type) {
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array": {
      const items = (prop.items ?? {}) as Record<string, unknown>;
      base = z.array(schemaPropToZod(z, items, true));
      break;
    }
    case "object":
      base = z.object(jsonSchemaToZodShape(z, prop));
      break;
    case "string":
      if (Array.isArray(prop.enum) && prop.enum.length >= 1) {
        try {
          base = z.enum(prop.enum as [string, ...string[]]);
        } catch {
          base = z.string();
        }
      } else {
        base = z.string();
      }
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

export interface ClaudeToolServer {
  server: unknown;
  /**
   * Atomically reads and clears the pending suspend payload set by the last tool call.
   * Returns `undefined` if no tool suspended during the current turn.
   */
  takePendingSuspend: () => string | undefined;
}

export function buildClaudeToolServer(
  sdk: ClaudeSdkRuntime,
  z: ZodLike,
  context: CommonToolContext,
<<<<<<< HEAD
): { server: unknown; takePendingSuspend: () => string | undefined } {
  let pendingSuspend: string | undefined;
=======
): ClaudeToolServer {
  // Shared between the tool handler and the PostToolUse hook.
  // The handler sets this when a tool returns a suspend result;
  // the hook reads and clears it — no tool-name awareness needed.
  let pendingSuspendPayload: string | undefined;
>>>>>>> origin/main

  const tools = COMMON_TOOL_DEFINITIONS.map((def) => sdk.tool(
    def.name,
    def.description,
    jsonSchemaToZodShape(z, def.parameters as Record<string, unknown>),
    async (args: Record<string, unknown>) => {
      try {
        const result = await executeCommonTool(def.name, toToolArgs(args ?? {}), context);
        if (result.type === "suspend") {
<<<<<<< HEAD
          pendingSuspend = result.payload;
          return { content: [{ type: "text", text: "Interview suspended - awaiting user response." }] };
        }
        return { content: [{ type: "text", text: result.text }] };
=======
          pendingSuspendPayload = result.payload;
        }
        const text = result.type === "result" ? result.text : "Interview suspended - awaiting user response.";
        return {
          content: [{ type: "text", text }],
        };
>>>>>>> origin/main
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  ));

  const server = sdk.createSdkMcpServer({
    name: "railyin",
    version: "0.1.0",
    tools,
  });

  return {
    server,
    takePendingSuspend: () => {
<<<<<<< HEAD
      const payload = pendingSuspend;
      pendingSuspend = undefined;
=======
      const payload = pendingSuspendPayload;
      pendingSuspendPayload = undefined;
>>>>>>> origin/main
      return payload;
    },
  };
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
