import { readFileSync, statSync, existsSync } from "fs";
import { extname, relative } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { LSPClient } from "./client.ts";
import type { InitializeResult } from "./types.ts";

// ─── Config types (mirrors workspace.yaml lsp.servers entries) ────────────────

export interface LspServerConfig {
  name: string;
  command: string;
  args: string[];
  extensions: string[];
}

// ─── Server state machine ─────────────────────────────────────────────────────

type ServerState = "idle" | "starting" | "running" | "error" | "disabled";

interface ServerInstance {
  config: LspServerConfig;
  state: ServerState;
  client: LSPClient | null;
  /** Set of URIs that have been sent via didOpen for this server */
  openedUris: Set<string>;
  /** URI → mtimeMs at time of last didOpen */
  openedMtimes: Map<string, number>;
  consecutiveFailures: number;
  capabilities?: InitializeResult["capabilities"];
}

const MAX_CONSECUTIVE_FAILURES = 3;

// ─── LSPServerManager ─────────────────────────────────────────────────────────

export class LSPServerManager {
  /** Map from file extension (e.g. ".ts") → server name */
  private extensionMap = new Map<string, string>();
  /** Map from server name → instance */
  private servers = new Map<string, ServerInstance>();
  private worktreePath: string;

  constructor(serverConfigs: LspServerConfig[], worktreePath: string) {
    this.worktreePath = worktreePath;
    for (const cfg of serverConfigs) {
      this.servers.set(cfg.name, {
        config: cfg,
        state: "idle",
        client: null,
        openedUris: new Set(),
        openedMtimes: new Map(),
        consecutiveFailures: 0,
      });
      for (const ext of cfg.extensions) {
        this.extensionMap.set(ext.toLowerCase(), cfg.name);
      }
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Send an LSP request for the given absolute file path.
   * Handles lazy server start, file open tracking, and stale-file re-sync.
   */
  async request<T = unknown>(absFilePath: string, method: string, params: unknown): Promise<T> {
    const ext = extname(absFilePath).toLowerCase();
    const serverName = this.extensionMap.get(ext);

    if (!serverName) {
      throw new Error(
        `No LSP server configured for ${ext || "(no extension)"} files. ` +
        `Add a server entry in workspace.yaml under lsp.servers with an extensions list including "${ext || absFilePath}".`,
      );
    }

    const instance = this.servers.get(serverName)!;

    if (instance.state === "disabled") {
      throw new Error(
        `LSP server "${serverName}" is disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`,
      );
    }

    // Lazy initialization
    if (instance.state === "idle" || (instance.state === "error" && instance.consecutiveFailures < MAX_CONSECUTIVE_FAILURES)) {
      await this.startServer(instance);
    }

    if (instance.state !== "running" || !instance.client) {
      throw new Error(`LSP server "${serverName}" failed to start.`);
    }

    // Ensure file is open (handling stale content)
    await this.ensureFileOpen(instance, absFilePath);

    return instance.client.sendRequest<T>(method, params);
  }

  /**
   * workspace/symbol is not file-scoped — route to any running (or lazyly-started) server.
   * Prefer a server whose extension map includes `anchorPath`'s extension; fall back
   * to the first configured server so workspace-wide queries always work even without
   * a file path hint.
   */
  async requestWorkspaceSymbol<T = unknown>(anchorPath: string, query: string): Promise<T> {
    const ext = extname(anchorPath).toLowerCase();
    const preferredName = this.extensionMap.get(ext);
    const serverName = preferredName ?? [...this.servers.keys()][0];

    if (!serverName) throw new Error("No LSP server configured");

    const instance = this.servers.get(serverName)!;

    if (instance.state === "disabled") {
      throw new Error(`LSP server "${serverName}" is disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
    }

    if (instance.state === "idle" || (instance.state === "error" && instance.consecutiveFailures < MAX_CONSECUTIVE_FAILURES)) {
      await this.startServer(instance);
    }

    if (instance.state !== "running" || !instance.client) {
      throw new Error(`LSP server "${serverName}" failed to start.`);
    }

    return instance.client.sendRequest<T>("workspace/symbol", { query });
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.servers.values()]
        .filter((s) => s.state === "running" && s.client)
        .map((s) => s.client!.shutdown()),
    );
  }

  /**
   * Mark a file as stale so the next request forces a fresh didClose + didOpen.
   * Call this after writing a file to disk (e.g. after applyWorkspaceEdit)
   * to ensure the LSP server sees updated content on the very next request.
   */
  markStale(absPath: string): void {
    const uri = pathToFileURL(absPath).toString();
    for (const instance of this.servers.values()) {
      instance.openedUris.delete(uri);
      instance.openedMtimes.delete(uri);
    }
  }

  // ─── Server lifecycle ────────────────────────────────────────────────────────

  private async startServer(instance: ServerInstance): Promise<void> {
    instance.state = "starting";
    try {
      const client = new LSPClient(
        instance.config.command,
        instance.config.args,
        this.worktreePath,
      );
      const rootUri = pathToFileURL(this.worktreePath).toString();
      const result = await client.initialize(rootUri);

      instance.client = client;
      instance.state = "running";
      instance.capabilities = result.capabilities;
      instance.consecutiveFailures = 0;

      // Watch for unexpected exit — transition to error state
      client["process"].on("exit", () => {
        if (instance.state === "running") {
          instance.state = "error";
          instance.consecutiveFailures++;
          if (instance.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            instance.state = "disabled";
          }
          instance.client = null;
          instance.openedUris.clear();
          instance.openedMtimes.clear();
        }
      });
    } catch (e) {
      instance.state = "error";
      instance.consecutiveFailures++;
      if (instance.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        instance.state = "disabled";
      }
      instance.client = null;
      throw new Error(
        `Failed to start LSP server "${instance.config.name}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ─── File open tracking ──────────────────────────────────────────────────────

  private async ensureFileOpen(instance: ServerInstance, absPath: string): Promise<void> {
    if (!existsSync(absPath)) return;
    const uri = pathToFileURL(absPath).toString();
    const ext = extname(absPath).slice(1).toLowerCase();

    let currentMtime = 0;
    try { currentMtime = statSync(absPath).mtimeMs; } catch { /* file may have just been deleted */ }

    const cachedMtime = instance.openedMtimes.get(uri);
    const isOpen = instance.openedUris.has(uri);
    const isStale = isOpen && cachedMtime !== undefined && cachedMtime !== currentMtime;

    if (isStale) {
      // Close and re-open with fresh content
      instance.client!.didClose(uri);
      instance.openedUris.delete(uri);
      instance.openedMtimes.delete(uri);
    }

    if (!instance.openedUris.has(uri)) {
      let text = "";
      try {
        const buf = readFileSync(absPath);
        if (buf.length > 10 * 1024 * 1024) {
          // File too large — don't open it in LSP
          return;
        }
        text = buf.toString("utf-8");
      } catch {
        return;
      }

      instance.client!.didOpen({ uri, languageId: ext, version: 1, text });
      instance.openedUris.add(uri);
      instance.openedMtimes.set(uri, currentMtime);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Convert absolute path to file URI string */
  static toUri(absPath: string): string {
    return pathToFileURL(absPath).toString();
  }

  /** Convert file URI to workspace-relative path */
  static toRelPath(uri: string, worktreePath: string): string {
    try {
      const abs = fileURLToPath(uri);
      return relative(worktreePath, abs);
    } catch {
      return uri;
    }
  }
}
