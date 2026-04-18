import type { McpServerConfig, McpServerTransport, McpToolDef } from "./types.ts";

// ─── JSON-RPC types ───────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Abstract base ────────────────────────────────────────────────────────────

export abstract class McpClient {
  protected _idCounter = 1;

  abstract initialize(): Promise<void>;
  abstract listTools(): Promise<McpToolDef[]>;
  abstract callTool(name: string, args: Record<string, unknown>): Promise<string>;
  abstract close(): Promise<void>;

  protected nextId(): number {
    return this._idCounter++;
  }

  protected buildRequest(method: string, params?: unknown): JsonRpcRequest {
    return { jsonrpc: "2.0", id: this.nextId(), method, ...(params !== undefined ? { params } : {}) };
  }

  protected buildNotification(method: string, params?: unknown): JsonRpcNotification {
    return { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
  }

  protected parseToolList(result: unknown): McpToolDef[] {
    const res = result as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    if (!Array.isArray(res?.tools)) return [];
    return res.tools.map((t) => ({
      name: t.name,
      serverName: "",
      qualifiedName: "",
      description: t.description,
      inputSchema: (t.inputSchema as McpToolDef["inputSchema"]) ?? { type: "object" },
    }));
  }

  protected extractToolResult(result: unknown): string {
    if (typeof result === "string") return result;
    const r = result as { content?: Array<{ type: string; text?: string }> };
    if (Array.isArray(r?.content)) {
      return r.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    }
    return JSON.stringify(result);
  }
}

// ─── Stdio client ─────────────────────────────────────────────────────────────

export class StdioMcpClient extends McpClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private _pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _readBuffer = "";
  private _closed = false;
  private config: Extract<McpServerTransport, { type: "stdio" }>;
  private serverName: string;

  constructor(serverName: string, config: Extract<McpServerTransport, { type: "stdio" }>) {
    super();
    this.serverName = serverName;
    this.config = config;
  }

  async initialize(): Promise<void> {
    const env = { ...process.env, ...(this.config.env ?? {}) } as Record<string, string>;
    this.proc = Bun.spawn([this.config.command, ...(this.config.args ?? [])], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    this._startReading();

    await this._sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "railyin", version: "1.0" },
    });
    await this._sendNotification("initialized", {});
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this._sendRequest("tools/list", {});
    return this.parseToolList(result);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this._sendRequest("tools/call", { name, arguments: args });
    return this.extractToolResult(result);
  }

  async close(): Promise<void> {
    this._closed = true;
    for (const pending of this._pendingRequests.values()) {
      pending.reject(new Error("Client closed"));
    }
    this._pendingRequests.clear();
    try {
      this.proc?.kill();
    } catch {
      // ignore
    }
    this.proc = null;
  }

  private _startReading(): void {
    if (!this.proc?.stdout) return;
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    const pump = async () => {
      try {
        while (!this._closed) {
          const { done, value } = await reader.read();
          if (done) break;
          this._readBuffer += decoder.decode(value, { stream: true });
          this._processBuffer();
        }
      } catch {
        // stream closed
      }
    };
    void pump();
  }

  private _processBuffer(): void {
    let nl: number;
    while ((nl = this._readBuffer.indexOf("\n")) !== -1) {
      const line = this._readBuffer.slice(0, nl).trim();
      this._readBuffer = this._readBuffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        const pending = this._pendingRequests.get(msg.id);
        if (pending) {
          this._pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }

  private async _sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this._closed || !this.proc?.stdin) {
        reject(new Error("Client not connected"));
        return;
      }
      const req = this.buildRequest(method, params);
      this._pendingRequests.set(req.id, { resolve, reject });
      const line = JSON.stringify(req) + "\n";
      void this.proc.stdin.write(line);
    });
  }

  private async _sendNotification(method: string, params: unknown): Promise<void> {
    if (!this.proc?.stdin) return;
    const notif = this.buildNotification(method, params);
    await this.proc.stdin.write(JSON.stringify(notif) + "\n");
  }
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

export class HttpMcpClient extends McpClient {
  private config: Extract<McpServerTransport, { type: "http" }>;
  private serverName: string;
  private _initialized = false;

  constructor(serverName: string, config: Extract<McpServerTransport, { type: "http" }>) {
    super();
    this.serverName = serverName;
    this.config = config;
  }

  async initialize(): Promise<void> {
    await this._post("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "railyin", version: "1.0" },
    });
    await this._postNotification("initialized", {});
    this._initialized = true;
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this._post("tools/list", {});
    return this.parseToolList(result);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this._post("tools/call", { name, arguments: args });
    return this.extractToolResult(result);
  }

  async close(): Promise<void> {
    this._initialized = false;
  }

  private async _post(method: string, params: unknown): Promise<unknown> {
    const req = this.buildRequest(method, params);
    const resp = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(req),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const json = (await resp.json()) as JsonRpcResponse;
    if (json.error) throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    return json.result;
  }

  private async _postNotification(method: string, params: unknown): Promise<void> {
    const notif = this.buildNotification(method, params);
    await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(notif),
    }).catch(() => {
      // ignore notification errors
    });
  }
}
