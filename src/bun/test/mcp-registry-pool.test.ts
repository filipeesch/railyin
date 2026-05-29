import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { McpRegistryPool } from "../mcp/registry-pool.ts";
import type { McpClientRegistry } from "../mcp/registry.ts";
import type { McpConfig } from "../mcp/types.ts";

function makeRegistry(): McpClientRegistry {
  return {
    getStatus: vi.fn().mockResolvedValue([]),
    reload: vi.fn().mockResolvedValue([]),
    startAll: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpClientRegistry;
}

describe("McpRegistryPool", () => {
  let tempDir: string;
  let globalDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "railyn-registry-pool-test-"));
    globalDir = join(tempDir, "global");
    mkdirSync(globalDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makePool(factory?: (config: McpConfig) => McpClientRegistry) {
    const f = factory ?? (() => makeRegistry());
    const pool = new McpRegistryPool(f);
    // Override getDataDir to use our temp global dir
    (pool as unknown as { _globalConfigPath: string })._globalConfigPath = undefined!;
    return pool;
  }

  it("getGlobalRegistry() calls factory with parsed config when file exists", () => {
    const globalConfigPath = join(globalDir, "mcp.json");
    writeFileSync(globalConfigPath, JSON.stringify({
      servers: [{ name: "g", transport: { type: "stdio", command: "echo" } }],
    }), "utf-8");

    const captured: McpConfig[] = [];
    const registry = makeRegistry();
    const pool = new McpRegistryPool((config) => { captured.push(config); return registry; });

    // Use a custom global dir by env
    const origDir = process.env.RAILYN_DATA_DIR;
    process.env.RAILYN_DATA_DIR = globalDir;
    try {
      const result = pool.getGlobalRegistry();
      expect(result).toBe(registry);
      expect(captured).toHaveLength(1);
      expect(captured[0].servers).toHaveLength(1);
      expect(captured[0].servers[0].name).toBe("g");
    } finally {
      if (origDir === undefined) delete process.env.RAILYN_DATA_DIR;
      else process.env.RAILYN_DATA_DIR = origDir;
    }
  });

  it("getGlobalRegistry() calls factory with empty config when no file exists", () => {
    const captured: McpConfig[] = [];
    const registry = makeRegistry();
    const pool = new McpRegistryPool((config) => { captured.push(config); return registry; });

    const emptyDir = join(tempDir, "empty");
    mkdirSync(emptyDir, { recursive: true });

    const origDir = process.env.RAILYN_DATA_DIR;
    process.env.RAILYN_DATA_DIR = emptyDir;
    try {
      pool.getGlobalRegistry();
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({ servers: [] });
    } finally {
      if (origDir === undefined) delete process.env.RAILYN_DATA_DIR;
      else process.env.RAILYN_DATA_DIR = origDir;
    }
  });

  it("getForProject() when project config exists calls factory with project config and returns project-specific instance", () => {
    const projectPath = join(tempDir, "project");
    const railynDir = join(projectPath, ".railyn");
    mkdirSync(railynDir, { recursive: true });
    writeFileSync(join(railynDir, "mcp.json"), JSON.stringify({
      servers: [{ name: "proj", transport: { type: "stdio", command: "proj-cmd" } }],
    }), "utf-8");

    const registries: McpClientRegistry[] = [];
    const pool = new McpRegistryPool(() => {
      const r = makeRegistry();
      registries.push(r);
      return r;
    });

    const origDir = process.env.RAILYN_DATA_DIR;
    process.env.RAILYN_DATA_DIR = join(tempDir, "empty");
    mkdirSync(join(tempDir, "empty"), { recursive: true });
    try {
      const global = pool.getGlobalRegistry(); // call global first
      const proj = pool.getForProject(projectPath);
      expect(proj).not.toBe(global);
      expect(registries).toHaveLength(2);
    } finally {
      if (origDir === undefined) delete process.env.RAILYN_DATA_DIR;
      else process.env.RAILYN_DATA_DIR = origDir;
    }
  });

  it("getForProject() when project config absent returns same instance as global", () => {
    const projectPath = join(tempDir, "no-config-project");
    mkdirSync(projectPath, { recursive: true });

    let callCount = 0;
    const registry = makeRegistry();
    const pool = new McpRegistryPool(() => { callCount++; return registry; });

    const emptyDir = join(tempDir, "empty2");
    mkdirSync(emptyDir, { recursive: true });
    const origDir = process.env.RAILYN_DATA_DIR;
    process.env.RAILYN_DATA_DIR = emptyDir;
    try {
      const global = pool.getGlobalRegistry();
      const proj = pool.getForProject(projectPath);
      expect(proj).toBe(global);
      expect(callCount).toBe(1);
    } finally {
      if (origDir === undefined) delete process.env.RAILYN_DATA_DIR;
      else process.env.RAILYN_DATA_DIR = origDir;
    }
  });

  it("getForProject() called twice with same path returns same instance (cached)", () => {
    const projectPath = join(tempDir, "cached-project");
    const railynDir = join(projectPath, ".railyn");
    mkdirSync(railynDir, { recursive: true });
    writeFileSync(join(railynDir, "mcp.json"), JSON.stringify({ servers: [] }), "utf-8");

    let callCount = 0;
    const pool = new McpRegistryPool(() => { callCount++; return makeRegistry(); });

    const emptyDir = join(tempDir, "empty3");
    mkdirSync(emptyDir, { recursive: true });
    const origDir = process.env.RAILYN_DATA_DIR;
    process.env.RAILYN_DATA_DIR = emptyDir;
    try {
      const first = pool.getForProject(projectPath);
      const second = pool.getForProject(projectPath);
      expect(first).toBe(second);
      expect(callCount).toBe(1);
    } finally {
      if (origDir === undefined) delete process.env.RAILYN_DATA_DIR;
      else process.env.RAILYN_DATA_DIR = origDir;
    }
  });

  it("getForProject() with different paths returns distinct instances", () => {
    const pathA = join(tempDir, "project-a");
    const pathB = join(tempDir, "project-b");
    [pathA, pathB].forEach((p) => {
      mkdirSync(join(p, ".railyn"), { recursive: true });
      writeFileSync(join(p, ".railyn", "mcp.json"), JSON.stringify({ servers: [] }), "utf-8");
    });

    let callCount = 0;
    const pool = new McpRegistryPool(() => { callCount++; return makeRegistry(); });

    const emptyDir = join(tempDir, "empty4");
    mkdirSync(emptyDir, { recursive: true });
    const origDir = process.env.RAILYN_DATA_DIR;
    process.env.RAILYN_DATA_DIR = emptyDir;
    try {
      const a = pool.getForProject(pathA);
      const b = pool.getForProject(pathB);
      expect(a).not.toBe(b);
      expect(callCount).toBe(2);
    } finally {
      if (origDir === undefined) delete process.env.RAILYN_DATA_DIR;
      else process.env.RAILYN_DATA_DIR = origDir;
    }
  });

  it("shutdown() calls shutdown on all distinct cached registries", async () => {
    const projectPath = join(tempDir, "shutdown-project");
    mkdirSync(join(projectPath, ".railyn"), { recursive: true });
    writeFileSync(join(projectPath, ".railyn", "mcp.json"), JSON.stringify({ servers: [] }), "utf-8");

    const registries: McpClientRegistry[] = [];
    const pool = new McpRegistryPool(() => {
      const r = makeRegistry();
      registries.push(r);
      return r;
    });

    const emptyDir = join(tempDir, "empty5");
    mkdirSync(emptyDir, { recursive: true });
    const origDir = process.env.RAILYN_DATA_DIR;
    process.env.RAILYN_DATA_DIR = emptyDir;
    try {
      pool.getGlobalRegistry();
      pool.getForProject(projectPath);

      await pool.shutdown();

      for (const r of registries) {
        expect(r.shutdown).toHaveBeenCalledOnce();
      }
    } finally {
      if (origDir === undefined) delete process.env.RAILYN_DATA_DIR;
      else process.env.RAILYN_DATA_DIR = origDir;
    }
  });
});
