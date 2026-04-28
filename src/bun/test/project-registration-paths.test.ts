import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "js-yaml";
import { setupTestConfig } from "./helpers.ts";
import { registerProject, updateProject } from "../project-store.ts";
import { loadConfig, resetConfig, getConfig } from "../config/index.ts";

let cleanup: () => void;

afterEach(() => {
  cleanup?.();
});

function setup(): { configDir: string; workspacePath: string } {
  const result = setupTestConfig();
  cleanup = result.cleanup;
  const configDir = process.env.RAILYN_CONFIG_DIR!;
  const config = getConfig("default");
  const workspacePath = config.workspace.workspace_path!;
  return { configDir, workspacePath };
}

describe("registerProject — path normalization", () => {
  it("accepts an absolute path inside the workspace and stores relative in YAML", () => {
    const { configDir, workspacePath } = setup();
    const newAppDir = join(workspacePath, "new-app");
    mkdirSync(newAppDir, { recursive: true });

    registerProject({
      workspaceKey: "default",
      name: "New App",
      projectPath: newAppDir,
      gitRootPath: newAppDir,
      defaultBranch: "main",
    });

    const yamlFile = join(configDir, "workspace.test.yaml");
    const parsed = yaml.load(readFileSync(yamlFile, "utf-8")) as Record<string, unknown>;
    const projects = parsed.projects as Array<Record<string, unknown>>;
    const registered = projects.find((p) => p.name === "New App");

    expect(registered).toBeDefined();
    expect(registered!.project_path).toBe("new-app");
    expect(registered!.git_root_path).toBe("new-app");
  });

  it("accepts a relative path directly and stores it in YAML", () => {
    const { configDir, workspacePath } = setup();
    mkdirSync(join(workspacePath, "relative-app"), { recursive: true });

    registerProject({
      workspaceKey: "default",
      name: "Relative App",
      projectPath: "relative-app",
      gitRootPath: "relative-app",
      defaultBranch: "main",
    });

    const yamlFile = join(configDir, "workspace.test.yaml");
    const parsed = yaml.load(readFileSync(yamlFile, "utf-8")) as Record<string, unknown>;
    const projects = parsed.projects as Array<Record<string, unknown>>;
    const registered = projects.find((p) => p.name === "Relative App");

    expect(registered!.project_path).toBe("relative-app");
  });

  it("throws when project_path does not exist on disk", () => {
    setup();

    expect(() =>
      registerProject({
        workspaceKey: "default",
        name: "Ghost App",
        projectPath: "does-not-exist",
        gitRootPath: "does-not-exist",
        defaultBranch: "main",
      }),
    ).toThrow("does not exist");
  });

  it("throws when project_path is outside the workspace", () => {
    setup();
    const outsideDir = mkdtempSync(join(tmpdir(), "outside-"));

    try {
      expect(() =>
        registerProject({
          workspaceKey: "default",
          name: "Outside App",
          projectPath: outsideDir,
          gitRootPath: outsideDir,
          defaultBranch: "main",
        }),
      ).toThrow("must be inside workspace_path");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("throws when workspace_path is not set in config", () => {
    // Create a config WITHOUT workspace_path and without projects (so it loads successfully)
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-no-ws-"));
    writeFileSync(
      join(configDir, "workspace.test.yaml"),
      ["name: test", "engine:", "  type: copilot", "  model: copilot/mock-model"].join("\n"),
    );
    process.env.RAILYN_DB = ":memory:";
    process.env.RAILYN_CONFIG_DIR = configDir;
    resetConfig();
    loadConfig();

    try {
      expect(() =>
        registerProject({
          workspaceKey: "default",
          name: "Any App",
          projectPath: "any-app",
          gitRootPath: "any-app",
          defaultBranch: "main",
        }),
      ).toThrow("workspace_path must be set");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_CONFIG_DIR;
      delete process.env.RAILYN_DB;
      resetConfig();
    }
  });

  it("returns structured { absolute, relative } paths in the RPC Project response", () => {
    const { workspacePath } = setup();
    mkdirSync(join(workspacePath, "structured-app"), { recursive: true });

    const project = registerProject({
      workspaceKey: "default",
      name: "Structured App",
      projectPath: "structured-app",
      gitRootPath: "structured-app",
      defaultBranch: "main",
    });

    expect(project.projectPath).toEqual({
      absolute: join(workspacePath, "structured-app"),
      relative: "structured-app",
    });
    expect(project.gitRootPath).toEqual({
      absolute: join(workspacePath, "structured-app"),
      relative: "structured-app",
    });
  });
});

describe("updateProject — path normalization", () => {
  it("normalizes an absolute path to relative when updating project_path", () => {
    const { configDir, workspacePath } = setup();
    mkdirSync(join(workspacePath, "updated-app"), { recursive: true });

    const project = updateProject({
      workspaceKey: "default",
      key: "test-project",
      projectPath: join(workspacePath, "updated-app"),
      gitRootPath: join(workspacePath, "updated-app"),
    });

    expect(project.projectPath.relative).toBe("updated-app");
    expect(project.gitRootPath.relative).toBe("updated-app");

    const yamlFile = join(configDir, "workspace.test.yaml");
    const parsed = yaml.load(readFileSync(yamlFile, "utf-8")) as Record<string, unknown>;
    const projects = parsed.projects as Array<Record<string, unknown>>;
    const found = projects.find((p) => p.key === "test-project");
    expect(found!.project_path).toBe("updated-app");
  });

  it("throws when updated path does not exist on disk", () => {
    setup();

    expect(() =>
      updateProject({
        workspaceKey: "default",
        key: "test-project",
        projectPath: "nonexistent-path",
      }),
    ).toThrow("does not exist");
  });
});

describe("YAML round-trip — relative paths persist after reload", () => {
  it("stores relative path in YAML and reloads to the correct absolute path", () => {
    const { configDir, workspacePath } = setup();
    mkdirSync(join(workspacePath, "round-trip"), { recursive: true });

    registerProject({
      workspaceKey: "default",
      name: "Round Trip",
      projectPath: "round-trip",
      gitRootPath: "round-trip",
      defaultBranch: "main",
    });

    // Verify YAML contains relative path
    const yamlFile = join(configDir, "workspace.test.yaml");
    const parsed = yaml.load(readFileSync(yamlFile, "utf-8")) as Record<string, unknown>;
    const projects = parsed.projects as Array<Record<string, unknown>>;
    const yamlProject = projects.find((p) => p.name === "Round Trip");
    expect(yamlProject!.project_path).toBe("round-trip");

    // Reload config and verify absolute paths are correctly resolved
    resetConfig();
    const { config } = loadConfig();
    const reloadedProject = config!.projects.find((p) => p.name === "Round Trip");
    expect(reloadedProject).toBeDefined();
    expect(reloadedProject!.projectPath).toBe(join(workspacePath, "round-trip"));
  });
});
