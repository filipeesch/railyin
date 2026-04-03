import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

// ─── Config types ─────────────────────────────────────────────────────────────

export interface AIProviderConfig {
  provider: string; // "openrouter" | "ollama" | "lmstudio" | "fake"
  base_url: string;
  api_key: string;
  model: string;
  context_window_tokens?: number;
}

export interface WorkspaceYaml {
  name?: string;
  ai: AIProviderConfig;
  worktree_base_path?: string;
  git_path?: string; // absolute path to git binary, e.g. /usr/bin/git
}

export interface WorkflowColumnConfig {
  id: string;
  label: string;
  description?: string;
  on_enter_prompt?: string;
  stage_instructions?: string;
  allowed_transitions?: string[];
  is_backlog?: boolean;
  tools?: string[];
}

export interface WorkflowTemplateConfig {
  id: string;
  name: string;
  columns: WorkflowColumnConfig[];
}

export interface LoadedConfig {
  workspace: WorkspaceYaml;
  workflows: WorkflowTemplateConfig[];
}

// ─── Config singleton ─────────────────────────────────────────────────────────

let _config: LoadedConfig | null = null;
let _configError: string | null = null;

// Injected at build time by electrobun.config.ts for dev builds (via Bun define).
// In production builds this is undefined and the fallback to ~/.railyn/config is used.
declare const __RAILYN_DEV_CONFIG_DIR__: string | undefined;

function getConfigDir(): string {
  // 1. Explicit env override (used by tests and CI)
  if (process.env.RAILYN_CONFIG_DIR) return process.env.RAILYN_CONFIG_DIR;
  // 2. Dev build: absolute path baked in at bundle time by electrobun.config.ts
  if (typeof __RAILYN_DEV_CONFIG_DIR__ !== "undefined" && existsSync(__RAILYN_DEV_CONFIG_DIR__)) {
    return __RAILYN_DEV_CONFIG_DIR__;
  }
  // 3. Production: user's data directory
  const dataDir = process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
  return join(dataDir, "config");
}

// ─── Default file content ────────────────────────────────────────────────────

const DEFAULT_WORKSPACE_YAML = `
name: My Workspace

ai:
  # Switch to your real provider when ready.
  # provider: openrouter
  # base_url: https://openrouter.ai/api/v1
  # api_key: sk-or-YOUR_KEY_HERE
  # model: anthropic/claude-3.5-sonnet
  provider: fake
  base_url: ""
  api_key: ""
  model: fake
  context_window_tokens: 128000
`.trimStart();

const DEFAULT_DELIVERY_YAML = `
id: delivery
name: Delivery Flow
columns:
  - id: backlog
    label: Backlog
    description: Tasks waiting to be started

  - id: plan
    label: Plan
    description: Define what needs to be done
    on_enter_prompt: |
      Create a clear, detailed implementation plan for this task.
      Break it down into concrete steps. Focus on WHAT needs to be
      done and WHY, not implementation details.
    stage_instructions: |
      You are in the Planning phase. Do NOT write code or
      implementation details. Focus only on understanding the
      problem and defining what needs to be done.

  - id: in_progress
    label: In Progress
    description: Active development
    on_enter_prompt: |
      Implement this task according to the plan. Work in the
      provided Git worktree. Make focused, clean changes.
    stage_instructions: |
      You are in the Implementation phase. Work in the Git
      worktree provided. Make minimal, focused changes.

  - id: in_review
    label: In Review
    description: Awaiting human review
    on_enter_prompt: |
      Summarize the changes made, highlight anything that needs
      reviewer attention, and flag any open questions or concerns.
    stage_instructions: |
      You are in the Review phase. Summarize changes clearly.

  - id: done
    label: Done
    description: Task complete
`.trimStart();

function ensureConfigExists(configDir: string): void {
  const workspaceFile = join(configDir, "workspace.yaml");
  const workflowsDir = join(configDir, "workflows");
  const deliveryFile = join(workflowsDir, "delivery.yaml");

  mkdirSync(workflowsDir, { recursive: true });

  if (!existsSync(workspaceFile)) {
    writeFileSync(workspaceFile, DEFAULT_WORKSPACE_YAML, "utf-8");
    console.log(`[config] Created default workspace.yaml at ${workspaceFile}`);
  }
  if (!existsSync(deliveryFile)) {
    writeFileSync(deliveryFile, DEFAULT_DELIVERY_YAML, "utf-8");
    console.log(`[config] Created default delivery.yaml at ${deliveryFile}`);
  }
}

export function loadConfig(): { config: LoadedConfig | null; error: string | null } {
  const configDir = getConfigDir();

  // Auto-create default config files if they don't exist yet
  ensureConfigExists(configDir);

  const workspaceFile = join(configDir, "workspace.yaml");

  let workspace: WorkspaceYaml;
  try {
    const raw = readFileSync(workspaceFile, "utf-8");
    workspace = yaml.load(raw) as WorkspaceYaml;
  } catch (err) {
    _configError = `Failed to parse workspace.yaml: ${err instanceof Error ? err.message : String(err)}`;
    return { config: null, error: _configError };
  }

  // Validate required fields
  if (!workspace?.ai) {
    _configError = "workspace.yaml is missing the required 'ai' section.";
    return { config: null, error: _configError };
  }
  // Skip base_url/model validation when using the fake provider
  const isFake = workspace.ai.provider === "fake";
  if (!isFake && !workspace.ai.base_url) {
    _configError = "workspace.yaml: ai.base_url is required.";
    return { config: null, error: _configError };
  }
  if (!isFake && !workspace.ai.model) {
    _configError = "workspace.yaml: ai.model is required.";
    return { config: null, error: _configError };
  }

  // Load workflow templates from config/workflows/
  const workflowsDir = join(configDir, "workflows");
  const workflows: WorkflowTemplateConfig[] = [];

  if (existsSync(workflowsDir)) {
    const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      try {
        const raw = readFileSync(join(workflowsDir, file), "utf-8");
        const tmpl = yaml.load(raw) as WorkflowTemplateConfig;
        if (tmpl?.id && tmpl?.columns) {
          workflows.push(tmpl);
        }
      } catch (err) {
        console.warn(`[config] Could not parse workflow ${file}: ${err}`);
      }
    }
  }

  // Always include the bundled default template
  const defaultTemplate = getDefaultTemplate();
  if (!workflows.find((w) => w.id === defaultTemplate.id)) {
    workflows.push(defaultTemplate);
  }

  _config = { workspace, workflows };
  _configError = null;
  return { config: _config, error: null };
}

export function getConfig(): LoadedConfig {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() at startup.");
  }
  return _config;
}

export function getConfigError(): string | null {
  return _configError;
}

export function resetConfig(): void {
  _config = null;
  _configError = null;
}

// ─── Bundled default workflow template ───────────────────────────────────────

export function getDefaultTemplate(): WorkflowTemplateConfig {
  return {
    id: "delivery",
    name: "Delivery Flow",
    columns: [
      {
        id: "backlog",
        label: "Backlog",
        description: "Tasks waiting to be started",
        is_backlog: true,
      },
      {
        id: "plan",
        label: "Plan",
        description: "Define what needs to be done",
        on_enter_prompt:
          "Create a clear, detailed implementation plan for this task. Break it down into concrete steps. Focus on WHAT needs to be done and WHY, not the implementation details.",
        stage_instructions:
          "You are in the Planning phase. Do NOT write code or implementation details. Focus only on understanding the problem and defining what needs to be done.",
      },
      {
        id: "in_progress",
        label: "In Progress",
        description: "Active development",
        on_enter_prompt:
          "Implement this task according to the plan. Work in the provided Git worktree. Make focused, clean changes.",
        stage_instructions:
          "You are in the Implementation phase. Work in the Git worktree provided. Make minimal, focused changes. Follow the plan established in the planning phase.",
      },
      {
        id: "in_review",
        label: "In Review",
        description: "Awaiting human review",
        on_enter_prompt:
          "Summarize the changes made, highlight anything that needs reviewer attention, and flag any open questions or concerns.",
        stage_instructions:
          "You are in the Review phase. Summarize changes clearly. Do not make further code changes unless the reviewer requests them.",
      },
      {
        id: "done",
        label: "Done",
        description: "Task complete",
      },
    ],
  };
}
