import type { McpClientRegistry } from "./registry.ts";

/**
 * Pure executor functions backing the `list_mcp_servers`/`list_mcp_tools`/`invoke_mcp_tool`
 * common tools (see openspec/changes/dynamic-mcp-discovery). Kept separate from
 * `McpClientRegistry` itself (single responsibility: registry owns MCP server/connection
 * lifecycle, this module owns turning that state into tool-call-shaped text) and separate
 * from `engine/common-tools.ts` (keeps that dispatcher a thin switch, not a home for MCP
 * domain logic). No DB or transport access — takes the registry and enabled-tools filter as
 * plain arguments, so it's testable with an in-memory `McpClientRegistry` alone.
 */

function normalizeFilter(enabledMcpTools: string[] | null | undefined): string[] {
  // Absence of an explicit list is treated the same as an empty list ("nothing visible"),
  // not as "no filter" — visibility is opt-in by design, even though McpClientRegistry.listTools()
  // itself treats `null`/`undefined` as unfiltered for its other (non-discovery-tool) callers.
  return enabledMcpTools ?? [];
}

function isToolVisible(enabledMcpTools: string[] | null | undefined, server: string, tool: string): boolean {
  return normalizeFilter(enabledMcpTools).includes(`${server}:${tool}`);
}

/** Formats a not-found/unavailable error consistently across list_mcp_tools and invoke_mcp_tool. */
function serverUnavailableError(registry: McpClientRegistry, server: string): string | null {
  const status = registry.getStatus().find((s) => s.name === server);
  if (!status) return `Error: MCP server "${server}" was not found. Call list_mcp_servers to see configured servers.`;
  if (status.state !== "running") {
    const errSuffix = status.error ? `, error: ${status.error}` : "";
    return `Error: MCP server "${server}" is not available (state: ${status.state}${errSuffix}).`;
  }
  return null;
}

export function execListMcpServers(registry: McpClientRegistry): string {
  const statuses = registry.getStatus();
  if (statuses.length === 0) return "No MCP servers are configured.";

  const lines = statuses.map((s) => {
    const config = registry.getServerConfig(s.name);
    const details = [`state: ${s.state}`];
    if (config?.description) details.push(`description: ${config.description}`);
    if (s.error) details.push(`error: ${s.error}`);
    return `- ${s.name} (${details.join(", ")})`;
  });
  return lines.join("\n");
}

export function execListMcpTools(registry: McpClientRegistry, enabledMcpTools: string[] | null | undefined, server: string): string {
  const unavailable = serverUnavailableError(registry, server);
  if (unavailable) return unavailable;

  const filter = normalizeFilter(enabledMcpTools);
  const tools = registry.listTools(filter).filter((t) => t.serverName === server);
  if (tools.length === 0) {
    return (
      `No tools are visible for MCP server "${server}" in this task. ` +
      `This may mean the server has no tools, or that none of its tools have been enabled — ` +
      `ask the user to enable the ones you need via the MCP tools panel.`
    );
  }

  const lines = tools.map((t) => {
    const description = t.description ? `: ${t.description}` : "";
    return `- ${t.name}${description}\n  inputSchema: ${JSON.stringify(t.inputSchema)}`;
  });
  return lines.join("\n");
}

export async function execInvokeMcpTool(
  registry: McpClientRegistry,
  enabledMcpTools: string[] | null | undefined,
  server: string,
  tool: string,
  args: Record<string, unknown> | undefined,
): Promise<string> {
  if (!isToolVisible(enabledMcpTools, server, tool)) {
    return (
      `Error: tool "${tool}" on MCP server "${server}" is not enabled for this task. ` +
      `Ask the user to enable it via the MCP tools panel, then try again.`
    );
  }

  const unavailable = serverUnavailableError(registry, server);
  if (unavailable) return unavailable;

  try {
    return await registry.callTool(server, tool, args ?? {});
  } catch (err) {
    return `Error invoking "${tool}" on MCP server "${server}": ${err instanceof Error ? err.message : String(err)}`;
  }
}
