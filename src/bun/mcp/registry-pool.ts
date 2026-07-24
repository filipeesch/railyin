import { existsSync } from "fs";
import { join } from "path";
import type { McpConfig } from "./types.ts";
import { McpClientRegistry } from "./registry.ts";
import { loadMcpConfigFile } from "./config-loader.ts";
import { getDataDir } from "../config/index.ts";

/**
 * Constructs a registry for a config + the directory that config lives in
 * (`~/.railyn` for global, `<project>/.railyn` for project scope). The scope
 * directory is what the default factory uses to resolve this scope's
 * `mcp-tokens.json` path — kept as a second parameter (rather than baked into
 * `McpClientRegistry` itself) so the pool remains the single place that knows
 * about global vs. project scoping.
 */
export type McpRegistryFactory = (config: McpConfig, scopeDir: string) => McpClientRegistry;

export interface McpRegistryPoolOptions {
  /** Resolves the OAuth redirect URI at authorize()-time; forwarded to every constructed registry. */
  getRedirectUri?: () => string;
}

export class McpRegistryPool {
  private readonly factory: McpRegistryFactory;
  private globalRegistry: McpClientRegistry | null = null;
  private readonly projectRegistries = new Map<string, McpClientRegistry>();

  constructor(factory?: McpRegistryFactory, options: McpRegistryPoolOptions = {}) {
    const { getRedirectUri } = options;
    this.factory =
      factory ??
      ((config, scopeDir) =>
        new McpClientRegistry(config, {
          tokensFilePath: join(scopeDir, "mcp-tokens.json"),
          getRedirectUri,
        }));
  }

  getGlobalRegistry(): McpClientRegistry {
    if (!this.globalRegistry) {
      const dataDir = getDataDir();
      const globalConfigPath = join(dataDir, "mcp.json");
      const config = loadMcpConfigFile(globalConfigPath);
      this.globalRegistry = this.factory(config, dataDir);
    }
    return this.globalRegistry;
  }

  getForProject(projectPath: string): McpClientRegistry {
    if (this.projectRegistries.has(projectPath)) {
      return this.projectRegistries.get(projectPath)!;
    }
    const railynDir = join(projectPath, ".railyn");
    const projectConfigPath = join(railynDir, "mcp.json");
    if (existsSync(projectConfigPath)) {
      const config = loadMcpConfigFile(projectConfigPath);
      const registry = this.factory(config, railynDir);
      this.projectRegistries.set(projectPath, registry);
      return registry;
    }
    // No project config — fall back to global
    const global = this.getGlobalRegistry();
    this.projectRegistries.set(projectPath, global);
    return global;
  }

  invalidate(projectPath: string): void {
    const existing = this.projectRegistries.get(projectPath);
    if (existing && existing !== this.globalRegistry) {
      void existing.shutdown().catch(() => {});
    }
    this.projectRegistries.delete(projectPath);
  }

  resetGlobal(): void {
    const old = this.globalRegistry;
    if (old) {
      void old.shutdown().catch(() => {});
      this.globalRegistry = null;
    }
    // Clear any project registries that were pointing at the old global
    for (const [key, registry] of this.projectRegistries) {
      if (registry === old) {
        this.projectRegistries.delete(key);
      }
    }
  }

  async shutdown(): Promise<void> {
    const toShutdown = new Set<McpClientRegistry>();
    if (this.globalRegistry) toShutdown.add(this.globalRegistry);
    for (const registry of this.projectRegistries.values()) {
      toShutdown.add(registry);
    }
    await Promise.allSettled([...toShutdown].map((r) => r.shutdown()));
    this.globalRegistry = null;
    this.projectRegistries.clear();
  }
}
