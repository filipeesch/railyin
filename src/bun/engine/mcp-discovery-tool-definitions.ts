import type { AIToolDefinition } from "../ai/types.ts";

/**
 * MCP discovery/invocation common tools — replace native per-tool MCP
 * injection (see openspec/changes/dynamic-mcp-discovery). Instead of wrapping
 * every enabled MCP tool as its own native tool definition (which bloats the
 * model's tool list and defeats provider-side tool/prompt caching), the model
 * discovers MCP capabilities on demand via these 3 tools, available
 * identically across every engine through COMMON_TOOL_DEFINITIONS.
 */
export const MCP_DISCOVERY_TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: "list_mcp_servers",
    description:
      "List all configured MCP servers (project-level if applicable, else global), regardless of which tools " +
      "are currently visible to you. Each entry includes the server's name, description (if configured), " +
      "lifecycle state (running/starting/idle/error/auth_required/disabled), and error message when applicable. " +
      "Use this first to discover what MCP servers exist before calling list_mcp_tools.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_mcp_tools",
    description:
      "List all tools available on a given MCP server: each tool's name, description, and argument schema " +
      "(including per-argument descriptions). Only returns tools that have been made visible to you for this " +
      "task/session — an empty result may mean the server has no tools, or that none of its tools have been " +
      "enabled here (ask the user to enable them via the MCP tools panel). Call list_mcp_servers first to find " +
      "valid server names.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "The MCP server name, as returned by list_mcp_servers." },
      },
      required: ["server"],
    },
  },
  {
    name: "invoke_mcp_tool",
    description:
      "Invoke a specific tool on a specific MCP server and return its result. Call list_mcp_tools first to learn " +
      "the tool's argument schema. Only tools made visible to you via list_mcp_tools can be invoked — invoking a " +
      "tool that was not shown to you will be rejected.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "The MCP server name, as returned by list_mcp_servers." },
        tool: { type: "string", description: "The unqualified tool name, as returned by list_mcp_tools." },
        arguments: { type: "object", description: "Arguments to pass to the tool, matching its input schema." },
      },
      required: ["server", "tool"],
    },
  },
];

export const MCP_DISCOVERY_TOOL_NAMES = new Set(MCP_DISCOVERY_TOOL_DEFINITIONS.map((d) => d.name));
