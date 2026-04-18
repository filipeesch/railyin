import type { McpConfig, McpServerConfig, McpToolDef, McpServerStatus, ServerState } from "./types.ts";
import { StdioMcpClient, HttpMcpClient, type McpClient } from "./client.ts";

interface ServerInstance {
  config: McpServerConfig;
  client: McpClient | null;
  state: ServerState;
  tools: McpToolDef[];
  error?: string;
}

export class McpClientRegistry {
  private servers = new Map<string, ServerInstance>();
  private config: McpConfig;

  constructor(config: McpConfig) {
    this.config = config;
    for (const serverConfig of config.servers) {
      if (serverConfig.enabled === false) {
        this.servers.set(serverConfig.name, {
          config: serverConfig,
          client: null,
          state: "disabled",
          tools: [],
        });
      } else {
        this.servers.set(serverConfig.name, {
          config: serverConfig,
          client: null,
          state: "idle",
          tools: [],
        });
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async startAll(): Promise<void> {
    const starts = [...this.servers.values()]
      .filter((s) => s.state !== "disabled")
      .map((s) => this._startServer(s.config.name));
    await Promise.allSettled(starts);
  }

  async shutdown(): Promise<void> {
    const shutdowns = [...this.servers.values()]
      .filter((s) => s.client !== null)
      .map((s) => this._stopServer(s.config.name));
    await Promise.allSettled(shutdowns);
  }

  async reload(serverName?: string): Promise<void> {
    if (serverName) {
      await this._stopServer(serverName);
      await this._startServer(serverName);
    } else {
      await this.shutdown();
      await this.startAll();
    }
  }

  listTools(filter?: string[] | null): McpToolDef[] {
    const tools: McpToolDef[] = [];
    for (const instance of this.servers.values()) {
      if (instance.state !== "running") continue;
      for (const tool of instance.tools) {
        if (!filter || filter.includes(`${instance.config.name}:${tool.name}`)) {
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const instance = this.servers.get(serverName);
    if (!instance) throw new Error(`MCP server "${serverName}" not found`);
    if (instance.state !== "running" || !instance.client) {
      throw new Error(`MCP server "${serverName}" is not running (state: ${instance.state})`);
    }
    return instance.client.callTool(toolName, args);
  }

  getStatus(): McpServerStatus[] {
    return [...this.servers.values()].map((s) => ({
      name: s.config.name,
      state: s.state,
      tools: s.tools,
      error: s.error,
    }));
  }

  getServerConfig(name: string): McpServerConfig | undefined {
    return this.servers.get(name)?.config;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async _startServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance || instance.state === "disabled") return;

    instance.state = "starting";
    instance.error = undefined;

    try {
      const client = this._createClient(instance.config);
      instance.client = client;
      await client.initialize();
      const rawTools = await client.listTools();
      instance.tools = rawTools.map((t) => ({
        ...t,
        serverName: name,
        qualifiedName: `mcp__${name}__${t.name}`,
      }));
      instance.state = "running";
    } catch (err) {
      instance.state = "error";
      instance.error = err instanceof Error ? err.message : String(err);
      instance.client = null;
      console.warn(`[mcp] Server "${name}" failed to start: ${instance.error}`);
    }
  }

  private async _stopServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) return;
    try {
      await instance.client?.close();
    } catch {
      // ignore close errors
    }
    instance.client = null;
    instance.tools = [];
    instance.state = "idle";
    instance.error = undefined;
  }

  private _createClient(config: McpServerConfig): McpClient {
    const { transport } = config;
    if (transport.type === "stdio") {
      return new StdioMcpClient(config.name, transport);
    } else if (transport.type === "http") {
      return new HttpMcpClient(config.name, transport);
    }
    throw new Error(`Unsupported MCP transport type: ${(transport as { type: string }).type}`);
  }
}

// ─── Singleton accessor ───────────────────────────────────────────────────────

let _registry: McpClientRegistry | null = null;

export function getMcpRegistry(): McpClientRegistry | null {
  return _registry;
}

export function initMcpRegistry(config: McpConfig): McpClientRegistry {
  if (_registry) {
    void _registry.shutdown().catch(() => {});
  }
  _registry = new McpClientRegistry(config);
  return _registry;
}
