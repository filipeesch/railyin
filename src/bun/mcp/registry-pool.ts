import { existsSync } from "fs";
import { join } from "path";
import type { McpConfig } from "./types.ts";
import { McpClientRegistry } from "./registry.ts";
import { loadMcpConfigFile } from "./config-loader.ts";
import { getDataDir } from "../config/index.ts";

export type McpRegistryFactory = (config: McpConfig) => McpClientRegistry;

export class McpRegistryPool {
  private readonly factory: McpRegistryFactory;
  private globalRegistry: McpClientRegistry | null = null;
  private readonly projectRegistries = new Map<string, McpClientRegistry>();

  constructor(factory: McpRegistryFactory = (config) => new McpClientRegistry(config)) {
    this.factory = factory;
  }

  getGlobalRegistry(): McpClientRegistry {
    if (!this.globalRegistry) {
      const globalConfigPath = join(getDataDir(), "mcp.json");
      const config = loadMcpConfigFile(globalConfigPath);
      this.globalRegistry = this.factory(config);
    }
    return this.globalRegistry;
  }

  getForProject(projectPath: string): McpClientRegistry {
    if (this.projectRegistries.has(projectPath)) {
      return this.projectRegistries.get(projectPath)!;
    }
    const projectConfigPath = join(projectPath, ".railyn", "mcp.json");
    if (existsSync(projectConfigPath)) {
      const config = loadMcpConfigFile(projectConfigPath);
      const registry = this.factory(config);
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
