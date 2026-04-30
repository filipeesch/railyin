import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, resetConfig } from "../config/index.ts";

// When RAILYN_DB=:memory:, the config loader reads/writes workspace.test.yaml
const CONFIG_FILE = "workspace.test.yaml";

function makeConfigDir(yamlContent: string): { configDir: string; cleanup: () => void } {
  const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-path-validation-"));
  writeFileSync(join(configDir, CONFIG_FILE), yamlContent);
  process.env.RAILYN_DB = ":memory:";
  process.env.RAILYN_CONFIG_DIR = configDir;
  resetConfig();
  return {
    configDir,
    cleanup: () => {
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_CONFIG_DIR;
      delete process.env.RAILYN_DB;
      resetConfig();
    },
  };
}

describe("config path validation", () => {
  afterEach(() => {
    resetConfig();
    delete process.env.RAILYN_CONFIG_DIR;
    delete process.env.RAILYN_DB;
  });

  it("fails when projects are defined but workspace_path is missing", () => {
    const { cleanup } = makeConfigDir(
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        "projects:",
        "  - key: my-app",
        "    name: My App",
        "    project_path: my-app",
        "    default_branch: main",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(config).toBeNull();
    expect(error).toContain("workspace_path is required");

    cleanup();
  });

  it("fails when project_path is absolute, includes migration hint", () => {
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
    const workspacePath = join(configDir, "workspace");
    mkdirSync(join(workspacePath, "my-app"), { recursive: true });

    const { cleanup } = makeConfigDir(
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        `workspace_path: ${workspacePath}`,
        "projects:",
        "  - key: my-app",
        "    name: My App",
        `    project_path: ${join(workspacePath, "my-app")}`,
        "    default_branch: main",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(config).toBeNull();
    expect(error).toContain("project_path must be a relative path");
    expect(error).toContain("Migration:");

    cleanup();
    rmSync(configDir, { recursive: true, force: true });
  });

  it("fails when git_root_path is absolute, includes migration hint", () => {
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
    const workspacePath = join(configDir, "workspace");
    mkdirSync(join(workspacePath, "packages/app"), { recursive: true });

    const { cleanup } = makeConfigDir(
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        `workspace_path: ${workspacePath}`,
        "projects:",
        "  - key: app",
        "    name: App",
        "    project_path: packages/app",
        `    git_root_path: ${workspacePath}`,
        "    default_branch: main",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(config).toBeNull();
    expect(error).toContain("git_root_path must be a relative path");
    expect(error).toContain("Migration:");

    cleanup();
    rmSync(configDir, { recursive: true, force: true });
  });

  it("loads successfully with valid workspace_path and relative project_path", () => {
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
    const workspacePath = join(configDir, "workspace");
    mkdirSync(join(workspacePath, "my-app"), { recursive: true });

    const { cleanup } = makeConfigDir(
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        `workspace_path: ${workspacePath}`,
        "projects:",
        "  - key: my-app",
        "    name: My App",
        "    project_path: my-app",
        "    default_branch: main",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(error).toBeNull();
    expect(config).not.toBeNull();
    expect(config!.projects).toHaveLength(1);
    expect(config!.projects[0]!.projectPath).toBe(join(workspacePath, "my-app"));
    expect(config!.projects[0]!.subPath).toBe("");

    cleanup();
    rmSync(configDir, { recursive: true, force: true });
  });

  it("computes subPath='' for a standalone repo (no git_root_path)", () => {
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
    const workspacePath = join(configDir, "workspace");
    mkdirSync(join(workspacePath, "standalone"), { recursive: true });

    const { cleanup } = makeConfigDir(
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        `workspace_path: ${workspacePath}`,
        "projects:",
        "  - key: standalone",
        "    name: Standalone",
        "    project_path: standalone",
        "    default_branch: main",
      ].join("\n"),
    );

    const { config } = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.projects[0]!.subPath).toBe("");

    cleanup();
    rmSync(configDir, { recursive: true, force: true });
  });

  it("computes subPath='packages/ui' for a monorepo project", () => {
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
    const workspacePath = join(configDir, "workspace");
    mkdirSync(join(workspacePath, "monorepo/packages/ui"), { recursive: true });

    const { cleanup } = makeConfigDir(
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        `workspace_path: ${workspacePath}`,
        "projects:",
        "  - key: ui",
        "    name: UI",
        "    project_path: monorepo/packages/ui",
        "    git_root_path: monorepo",
        "    default_branch: main",
      ].join("\n"),
    );

    const { config } = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.projects[0]!.subPath).toBe("packages/ui");

    cleanup();
    rmSync(configDir, { recursive: true, force: true });
  });

  it("loads successfully when no projects are defined (workspace_path not required)", () => {
    const { cleanup } = makeConfigDir(
      [
        "name: no-projects",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(error).toBeNull();
    expect(config).not.toBeNull();
    expect(config!.projects).toHaveLength(0);

    cleanup();
  });
});
