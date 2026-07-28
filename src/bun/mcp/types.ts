// ─── MCP Config types (mirror VS Code mcp.json format) ───────────────────────

export type McpServerTransport =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string>; auth?: McpOAuthStaticClientConfig };

/**
 * Static OAuth client registration, for authorization servers that reject
 * anonymous Dynamic Client Registration (e.g. Keycloak realms configured to
 * require an Initial Access Token for DCR). When present, the registry skips
 * DCR entirely and uses this client_id/client_secret directly for
 * `/authorize` and `/token` — a realm admin must pre-register this client
 * out-of-band and share its client_id with the user.
 */
export interface McpOAuthStaticClientConfig {
  client_id: string;
  client_secret?: string;
}

export interface McpServerConfig {
  name: string; // human-readable label
  transport: McpServerTransport;
  /** Optional description shown in UI */
  description?: string;
  /** If false, server is present in config but skipped at startup */
  enabled?: boolean;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

// ─── MCP Protocol types ───────────────────────────────────────────────────────

export interface McpToolInputSchema {
  type: "object";
  properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
  required?: string[];
  [key: string]: unknown;
}

export interface McpToolDef {
  /** Unqualified tool name as reported by the server */
  name: string;
  /** Server name this tool belongs to */
  serverName: string;
  /** Qualified tool name used in AI context: mcp__<server>__<tool> */
  qualifiedName: string;
  description?: string;
  inputSchema: McpToolInputSchema;
}

// ─── Server state machine ─────────────────────────────────────────────────────

export type ServerState = "idle" | "starting" | "running" | "auth_required" | "error" | "disabled";

export interface McpServerStatus {
  name: string;
  state: ServerState;
  tools: McpToolDef[];
  error?: string;
}
