import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, resetConfig } from "../config/index.ts";

const CONFIG_FILE = "workspace.test.yaml";

function makeConfigDir(
  workspaceYaml: string,
  enginesYaml: string,
): { configDir: string; cleanup: () => void } {
  const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-opencode-"));
  const workspacePath = join(configDir, "workspace");
  mkdirSync(join(workspacePath, "test-project"), { recursive: true });

  writeFileSync(join(configDir, CONFIG_FILE), workspaceYaml.replace("{{workspacePath}}", workspacePath));
  writeFileSync(join(configDir, "engines.yaml"), enginesYaml);

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

afterEach(() => {
  resetConfig();
  delete process.env.RAILYN_CONFIG_DIR;
  delete process.env.RAILYN_DB;
});

describe("OpenCode engine config — valid configurations", () => {
  it("loads successfully with engine.type: opencode and a provider with api_key", () => {
    const { cleanup } = makeConfigDir(
      [
        "name: opencode-test",
        "default_model: opencode/anthropic/claude-sonnet-4-5",
        "workspace_path: {{workspacePath}}",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: test-project",
        "    git_root_path: test-project",
        "    default_branch: main",
      ].join("\n"),
      [
        "engines:",
        "  - id: opencode",
        "    type: opencode",
        "    model: anthropic/claude-sonnet-4-5",
        "    providers:",
        "      anthropic:",
        "        api_key: sk-test-key-12345",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(error).toBeNull();
    expect(config).not.toBeNull();
    expect(config!.engines[0].id).toBe("opencode");

    cleanup();
  });

  it("loads successfully with engine.type: opencode and no providers (uses env defaults)", () => {
    const { cleanup } = makeConfigDir(
      [
        "name: opencode-minimal",
        "workspace_path: {{workspacePath}}",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: test-project",
        "    git_root_path: test-project",
        "    default_branch: main",
      ].join("\n"),
      [
        "engines:",
        "  - id: opencode",
        "    type: opencode",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(error).toBeNull();
    expect(config).not.toBeNull();
    expect(config!.engines[0].id).toBe("opencode");

    cleanup();
  });

  it("loads successfully with local LLM provider using npm and base_url", () => {
    const { cleanup } = makeConfigDir(
      [
        "name: opencode-local-llm",
        "workspace_path: {{workspacePath}}",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: test-project",
        "    git_root_path: test-project",
        "    default_branch: main",
      ].join("\n"),
      [
        "engines:",
        "  - id: opencode",
        "    type: opencode",
        "    model: ollama/llama3",
        "    providers:",
        "      ollama:",
        '        npm: "@opencode-ai/provider-ollama"',
        '        base_url: "http://localhost:11434/v1"',
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(error).toBeNull();
    expect(config).not.toBeNull();

    const engine = config!.engines[0].config;
    if (engine.type === "opencode") {
      expect(engine.providers?.ollama?.base_url).toBe("http://localhost:11434/v1");
      expect(engine.providers?.ollama?.npm).toBe("@opencode-ai/provider-ollama");
    }

    cleanup();
  });

  it("loads successfully with multiple providers configured", () => {
    const { cleanup } = makeConfigDir(
      [
        "name: opencode-multi-provider",
        "workspace_path: {{workspacePath}}",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: test-project",
        "    git_root_path: test-project",
        "    default_branch: main",
      ].join("\n"),
      [
        "engines:",
        "  - id: opencode",
        "    type: opencode",
        "    model: anthropic/claude-sonnet-4-5",
        "    providers:",
        "      anthropic:",
        "        api_key: sk-ant-key",
        "      openai:",
        "        api_key: sk-oai-key",
      ].join("\n"),
    );

    const { config, error } = loadConfig();
    expect(error).toBeNull();
    expect(config).not.toBeNull();

    const engine = config!.engines[0].config;
    if (engine.type === "opencode") {
      expect(Object.keys(engine.providers ?? {})).toContain("anthropic");
      expect(Object.keys(engine.providers ?? {})).toContain("openai");
    }

    cleanup();
  });
});
