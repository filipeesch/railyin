/**
 * Fake in-memory MCP client, injected into `McpClientRegistry` via its `clientFactory`
 * DI seam (see `registry.ts`'s `McpClientRegistryOptions.clientFactory`). Lets tests drive
 * the registry's full state machine (start/stop/list/call) without a real subprocess or
 * network transport.
 *
 * Shared by `mcp-registry.test.ts`, `mcp-registry-oauth.test.ts`, discovery-tool tests, and
 * the cross-engine `runMcpDiscoveryScenario` integration helper.
 */
import { McpClient } from "../../mcp/client.ts";
import type { McpToolDef } from "../../mcp/types.ts";

export interface FakeMcpClientOptions {
  initializeError?: Error;
  callToolError?: Error;
  tools?: Array<Omit<McpToolDef, "serverName" | "qualifiedName">>;
  /** Overrides the text returned by a successful callTool(); defaults to "ok". */
  callToolResult?: string;
}

export class FakeMcpClient extends McpClient {
  closed = false;
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly opts: FakeMcpClientOptions = {}) {
    super();
  }

  async initialize(): Promise<void> {
    if (this.opts.initializeError) throw this.opts.initializeError;
  }

  async listTools(): Promise<McpToolDef[]> {
    return (this.opts.tools ?? []).map((t) => ({ ...t, serverName: "", qualifiedName: "" }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    this.calls.push({ name, args });
    if (this.opts.callToolError) throw this.opts.callToolError;
    return this.opts.callToolResult ?? "ok";
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
