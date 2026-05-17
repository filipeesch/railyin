import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig, resetConfig, ensureWorkspaceConfigExists, ensureGlobalConfigExists } from "../config/index.ts";

const ENGINES_YAML_COPILOT = "engines:\n  - id: copilot\n    type: copilot\n";
const ENGINES_YAML_OPENCODE = "engines:\n  - id: opencode\n    type: opencode\n";

function makeDataDirEnv() {
  const dataDir = mkdtempSync(join(tmpdir(), "railyn-data-"));
  const workspaceDir = join(dataDir, "workspaces", "default");
  const globalConfigDir = join(dataDir, "config");

  process.env.RAILYN_DATA_DIR = dataDir;
  process.env.RAILYN_DB = ":memory:";
  delete process.env.RAILYN_CONFIG_DIR;
  resetConfig();

  return {
    dataDir,
    workspaceDir,
    globalConfigDir,
    cleanup: () => {
      rmSync(dataDir, { recursive: true, force: true });
      delete process.env.RAILYN_DATA_DIR;
      delete process.env.RAILYN_DB;
      resetConfig();
    },
  };
}

describe("global engines config — dir separation", () => {
  it("GEC-1: engines.yaml in global dir only loads correctly", () => {
    const { globalConfigDir, cleanup } = makeDataDirEnv();

    mkdirSync(globalConfigDir, { recursive: true });
    writeFileSync(join(globalConfigDir, "engines.yaml"), ENGINES_YAML_COPILOT);

    const { config, error } = loadConfig();

    expect(error).toBeNull();
    expect(config).not.toBeNull();
    expect(config!.engines.some((e) => e.id === "copilot")).toBe(true);

    cleanup();
  });

  it("GEC-2: engines.yaml in workspace dir is silently ignored — global dir wins", () => {
    const { workspaceDir, globalConfigDir, cleanup } = makeDataDirEnv();

    // Write opencode to workspace dir only; global dir gets auto-created with copilot
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, "engines.yaml"), ENGINES_YAML_OPENCODE);

    const { config, error } = loadConfig();

    // Auto-creation fills global dir — success
    expect(error).toBeNull();
    expect(config).not.toBeNull();
    // The workspace-dir opencode engine must NOT appear in the loaded config
    expect(config!.engines.some((e) => e.id === "opencode")).toBe(false);
    // The auto-created global copilot engine IS present
    expect(config!.engines.some((e) => e.id === "copilot")).toBe(true);
    // Global engines.yaml was created; workspace-dir one is untouched but unused
    expect(existsSync(join(globalConfigDir, "engines.yaml"))).toBe(true);
    expect(existsSync(join(workspaceDir, "engines.yaml"))).toBe(true);

    cleanup();
  });

  it("GEC-3: engines.yaml in both dirs — global dir wins", () => {
    const { workspaceDir, globalConfigDir, cleanup } = makeDataDirEnv();

    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, "engines.yaml"), ENGINES_YAML_OPENCODE);
    mkdirSync(globalConfigDir, { recursive: true });
    writeFileSync(join(globalConfigDir, "engines.yaml"), ENGINES_YAML_COPILOT);

    const { config, error } = loadConfig();

    expect(error).toBeNull();
    expect(config!.engines.some((e) => e.id === "copilot")).toBe(true);
    expect(config!.engines.some((e) => e.id === "opencode")).toBe(false);

    cleanup();
  });

  it("GEC-4: ensureWorkspaceConfigExists does not create engines.yaml", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "railyn-ws-"));
    process.env.RAILYN_DB = ":memory:";

    ensureWorkspaceConfigExists(tempDir);

    expect(existsSync(join(tempDir, "workspace.test.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, "workflows", "delivery.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, "engines.yaml"))).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.RAILYN_DB;
  });

  it("GEC-5: ensureGlobalConfigExists creates engines.yaml but no workspace files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "railyn-global-"));

    ensureGlobalConfigExists(tempDir);

    expect(existsSync(join(tempDir, "engines.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, "workspace.yaml"))).toBe(false);
    expect(existsSync(join(tempDir, "workspace.test.yaml"))).toBe(false);
    expect(existsSync(join(tempDir, "workflows"))).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("GEC-6: loadConfig auto-creates engines.yaml in global dir, not workspace dir", () => {
    const { workspaceDir, globalConfigDir, cleanup } = makeDataDirEnv();

    loadConfig();

    expect(existsSync(join(globalConfigDir, "engines.yaml"))).toBe(true);
    expect(existsSync(join(workspaceDir, "engines.yaml"))).toBe(false);

    cleanup();
  });
});
