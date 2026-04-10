import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import type {
  InitializeParams,
  InitializeResult,
  TextDocumentItem,
} from "./types.ts";

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

// ─── LSPClient ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

export class LSPClient {
  private process: ChildProcess;
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private buffer = "";
  private _closed = false;

  constructor(command: string, args: string[], cwd: string) {
    this.process = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
      this.drainBuffer();
    });

    this.process.stderr!.on("data", (_chunk: Buffer) => {
      // Server diagnostics — intentionally ignored (servers write non-fatal info here)
    });

    this.process.on("exit", () => {
      this._closed = true;
      // Reject all pending requests on unexpected exit
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("LSP server process exited unexpectedly"));
      }
      this.pendingRequests.clear();
    });
  }

  get closed(): boolean {
    return this._closed;
  }

  // ─── JSON-RPC framing ───────────────────────────────────────────────────────

  private sendMessage(msg: JsonRpcRequest | JsonRpcNotification): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    this.process.stdin!.write(header + body);
  }

  private drainBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        // Malformed header — drop up to and including the separator
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.buffer.length < bodyStart + contentLength) break; // wait for more data

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcResponse;
        if ("id" in msg && msg.id != null) {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
        // Notifications from server (e.g. publishDiagnostics) are ignored
      } catch {
        // JSON parse error — silently skip
      }
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this._closed) {
        reject(new Error("LSP server is closed"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });

      this.sendMessage({ jsonrpc: "2.0", id, method, params });
    });
  }

  sendNotification(method: string, params?: unknown): void {
    if (this._closed) return;
    this.sendMessage({ jsonrpc: "2.0", method, params });
  }

  // ─── LSP lifecycle ──────────────────────────────────────────────────────────

  async initialize(rootUri: string): Promise<InitializeResult> {
    const params: InitializeParams = {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          definition: { linkSupport: false },
          references: {},
          hover: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          implementation: { linkSupport: false },
          callHierarchy: {},
        },
        workspace: { symbol: {} },
      },
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
    };

    const result = await this.sendRequest<InitializeResult>("initialize", params);
    // Send initialized notification — required by LSP spec
    this.sendNotification("initialized", {});
    return result;
  }

  async shutdown(): Promise<void> {
    if (this._closed) return;
    try {
      await Promise.race([
        this.sendRequest("shutdown"),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("shutdown timeout")), 5_000)),
      ]);
      this.sendNotification("exit");
    } catch {
      // Force-kill if shutdown times out
    } finally {
      this._closed = true;
      this.process.kill("SIGTERM");
    }
  }

  // ─── textDocument notifications ─────────────────────────────────────────────

  didOpen(item: TextDocumentItem): void {
    this.sendNotification("textDocument/didOpen", { textDocument: item });
  }

  didClose(uri: string): void {
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });
  }
}
