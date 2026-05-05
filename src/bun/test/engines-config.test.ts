import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupTestConfig, initDb } from "./helpers.ts";
import { resetConfig } from "../config/index.ts";
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

  it("EC-3: no engines.yaml → falls back to workspace.yaml engine block", () => {
    const result = setupTestConfig();
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    expect(config.engines).toHaveLength(1);
    expect(config.engines[0].id).toBe("copilot");
  });

  it("EC-4: both files → engines.yaml wins (engine in workspace.yaml is ignored)", () => {
    const enginesYaml = `
engines:
  - id: claude
    type: claude
    model: claude/claude-sonnet-4-5
`.trimStart();

    // workspace.yaml will have engine: copilot (default from setupTestConfig)
    const result = setupTestConfig("", undefined, [], "copilot/gpt-4.1", [], enginesYaml);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    // engines.yaml takes precedence: only claude engine is present
    expect(config.engines).toHaveLength(1);
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

  it("EC-7: engines.yaml with only invalid entries (missing id/type) → falls back to workspace engine", () => {
    const enginesYaml = `
engines:
  - model: copilot/gpt-4.1
`.trimStart();

    const result = setupTestConfig("", undefined, [], "copilot/gpt-4.1", [], enginesYaml);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    // Falls back to workspace.yaml engine block (copilot)
    expect(config.engines).toHaveLength(1);
    expect(config.engines[0].id).toBe("copilot");
  });

  it("EC-8: engines.yaml with empty engines list → falls back to workspace engine", () => {
    const enginesYaml = `engines: []\n`;

    const result = setupTestConfig("", undefined, [], "copilot/gpt-4.1", [], enginesYaml);
    cleanup = result.cleanup;

    const config = getWorkspaceConfig(getDefaultWorkspaceKey());
    // Falls back to workspace.yaml engine block
    expect(config.engines).toHaveLength(1);
    expect(config.engines[0].id).toBe("copilot");
  });
});
