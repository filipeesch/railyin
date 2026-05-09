import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setupTestConfig, initDb } from "./helpers.ts";
import { loadConfig, resetConfig } from "../config/index.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  initDb();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  resetConfig();
});

// ─── Local helper for low-level error-path tests ──────────────────────────────

function makeConfigDir(workspaceYaml: string, enginesYaml?: string): { configDir: string; cleanup: () => void } {
  const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-ec-"));
  const workspacePath = join(configDir, "workspace");
  mkdirSync(join(workspacePath, "test-project"), { recursive: true });

  writeFileSync(
    join(configDir, "workspace.test.yaml"),
    workspaceYaml.replace("{{workspacePath}}", workspacePath),
  );
  if (enginesYaml !== undefined) {
    writeFileSync(join(configDir, "engines.yaml"), enginesYaml);
  }

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

// ─── engines.yaml loading ─────────────────────────────────────────────────────

describe("engines-config loading", () => {
  it("EC-1: 3 engines loaded from engines.yaml", () => {
    const enginesYaml = `
engines:
  - id: copilot
    type: copilot
    model: copilot/gpt-4.1
  - id: claude
    type: claude
    model: claude/claude-sonnet-4-5
  - id: opencode
    type: opencode
`.trimStart();

    const result = setupTestConfig("", undefined, [], null, [], enginesYaml);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    expect(config.engines).toHaveLength(3);
    expect(config.engines[0].id).toBe("copilot");
    expect(config.engines[1].id).toBe("claude");
    expect(config.engines[2].id).toBe("opencode");
  });

  it("EC-2: first engine is the default", () => {
    const enginesYaml = `
engines:
  - id: claude
    type: claude
    model: claude/claude-sonnet-4-5
  - id: copilot
    type: copilot
    model: copilot/gpt-4.1
`.trimStart();

    const result = setupTestConfig("", undefined, [], null, [], enginesYaml);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    expect(config.engines[0].id).toBe("claude");
  });

  it("EC-5: allowed_engines filters available engines", () => {
    const enginesYaml = `
engines:
  - id: copilot
    type: copilot
    model: copilot/gpt-4.1
  - id: claude
    type: claude
    model: claude/claude-sonnet-4-5
`.trimStart();

    const workspaceExtra = `allowed_engines:\n  - copilot\n`;
    const result = setupTestConfig(workspaceExtra, undefined, [], null, [], enginesYaml);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    expect(config.allowedEngineIds).toEqual(["copilot"]);
  });

  it("EC-6: no allowed_engines → allowedEngineIds is null (all engines available)", () => {
    const enginesYaml = `
engines:
  - id: copilot
    type: copilot
  - id: claude
    type: claude
`.trimStart();

    const result = setupTestConfig("", undefined, [], null, [], enginesYaml);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    expect(config.allowedEngineIds).toBeNull();
  });
});

// ─── error paths ─────────────────────────────────────────────────────────────

describe("engines-config error paths", () => {
  it("EC-ERR-1: workspace.yaml with engine: block → loadConfig returns non-null error with migration hint", () => {
    cleanup = makeConfigDir(
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/gpt-4.1",
        "workspace_path: {{workspacePath}}",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: test-project",
        "    git_root_path: test-project",
        "    default_branch: main",
      ].join("\n"),
      "engines:\n  - id: copilot\n    type: copilot\n",
    ).cleanup;

    const { config, error } = loadConfig();
    expect(error).not.toBeNull();
    expect(error).toContain("engine: block is no longer supported");
    expect(config).toBeNull();
  });

  it("EC-ERR-3: engines.yaml with zero valid entries → loadConfig returns non-null error", () => {
    cleanup = makeConfigDir(
      [
        "name: test",
        "workspace_path: {{workspacePath}}",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: test-project",
        "    git_root_path: test-project",
        "    default_branch: main",
      ].join("\n"),
      "engines: []\n",
    ).cleanup;

    const { config, error } = loadConfig();
    expect(error).not.toBeNull();
    expect(error).toContain("engines.yaml");
    expect(config).toBeNull();
  });

  it("EC-ERR-3b: engines.yaml with only invalid entries (missing id/type) → loadConfig returns non-null error", () => {
    cleanup = makeConfigDir(
      [
        "name: test",
        "workspace_path: {{workspacePath}}",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: test-project",
        "    git_root_path: test-project",
        "    default_branch: main",
      ].join("\n"),
      "engines:\n  - model: copilot/gpt-4.1\n",
    ).cleanup;

    const { config, error } = loadConfig();
    expect(error).not.toBeNull();
    expect(error).toContain("engines.yaml");
    expect(config).toBeNull();
  });
});

// ─── defaultModel resolution ──────────────────────────────────────────────────

describe("defaultModel resolution", () => {
  it("EC-DM-1: workspace.yaml with default_model → config.defaultModel is set", () => {
    const result = setupTestConfig("", undefined, [], "copilot/gpt-4.1");
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    expect(config.defaultModel).toBe("copilot/gpt-4.1");
  });

  it("EC-DM-2: workspace.yaml without default_model → config.defaultModel is null", () => {
    const result = setupTestConfig("", undefined, [], null);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    expect(config.defaultModel).toBeNull();
  });
});
