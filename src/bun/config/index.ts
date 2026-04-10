import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

// ─── Config types ─────────────────────────────────────────────────────────────

/** Per-entry provider config in the `providers:` list */
export interface ProviderConfig {
  id: string;   // unique name used as the prefix in qualified model IDs
  type: string; // "anthropic" | "openrouter" | "lmstudio" | "openai-compatible" | "fake"
  base_url?: string;
  api_key?: string;
  context_window_tokens?: number; // manual override; auto-detected from provider when absent
  provider_args?: Record<string, unknown>; // forwarded verbatim as the `provider` key in every OpenAI-compat request body
  /** Fully-qualified model ID to fall back to when this provider returns 529 (overloaded) 3 consecutive times. */
  fallback_model?: string;
}

// ─── Engine config types ─────────────────────────────────────────────────────

/** Config block for Anthropic-specific settings (shared between WorkspaceYaml and NativeEngineConfig). */
export interface AnthropicConfig {
  cache_ttl?: "5m" | "1h";
  enable_thinking?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  context_edit_strategy?: { enabled?: boolean };
}

/** Config block for web search (shared between WorkspaceYaml and NativeEngineConfig). */
export interface SearchConfig {
  engine: string;
  api_key: string;
}

/** Config block for LSP servers (shared between WorkspaceYaml and NativeEngineConfig). */
export interface LspConfig {
  servers?: Array<{ name: string; command: string; args: string[]; extensions: string[] }>;
}

/** Native engine config — same provider-based setup as today. */
export interface NativeEngineConfig {
  type: "native";
  providers?: ProviderConfig[];
  default_model?: string;
  search?: SearchConfig;
  anthropic?: AnthropicConfig;
  lsp?: LspConfig;
  worktree_base_path?: string;
}

/** Copilot engine config — uses the GitHub Copilot SDK. */
export interface CopilotEngineConfig {
  type: "copilot";
  /** Copilot model ID (e.g. "gpt-4.1"). Leave unset for the Copilot default. */
  model?: string;
}

export type EngineConfig = NativeEngineConfig | CopilotEngineConfig;

/**
 * @deprecated Use `ProviderConfig` and `WorkspaceYaml.providers` instead.
 * Kept for backward-compat auto-migration of old `ai:` blocks.
 */
export interface AIProviderConfig {
  provider: string;
  base_url: string;
  api_key: string;
  model?: string;
  context_window_tokens?: number;
}

export interface WorkspaceYaml {
  name?: string;
  /**
   * New engine block. Discriminated by `type`:
   *   - `native`  (default): built-in provider-based loop
   *   - `copilot`: GitHub Copilot SDK
   * When absent, legacy top-level fields are auto-migrated to `engine.type:native` in memory.
   */
  engine?: EngineConfig;
  /** @deprecated Top-level providers list. Use `engine.type:native.providers` instead.
   *  Still supported — auto-migrated to `engine.type:native` on load. */
  providers?: ProviderConfig[];
  /** @deprecated Single-provider legacy format. Auto-migrated on load. */
  ai?: AIProviderConfig;
  worktree_base_path?: string;
  git_path?: string; // absolute path to git binary, e.g. /usr/bin/git
  /** @deprecated Use engine.type:native.default_model. Still supported for legacy configs. */
  default_model?: string;
  /** @deprecated Use engine.type:native.search. Still supported for legacy configs. */
  search?: SearchConfig;
  /** @deprecated Use engine.type:native.anthropic. Still supported for legacy configs. */
  anthropic?: AnthropicConfig;
  /** @deprecated Use engine.type:native.lsp. Still supported for legacy configs. */
  lsp?: LspConfig;
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
  model?: string;
}

export interface WorkflowTemplateConfig {
  id: string;
  name: string;
  columns: WorkflowColumnConfig[];
}

export interface LoadedConfig {
  workspace: WorkspaceYaml;
  /** Normalized, de-duplicated provider list — always populated after load (native engine only) */
  providers: ProviderConfig[];
  workflows: WorkflowTemplateConfig[];
  /** Resolved engine config — always present after load */
  engine: EngineConfig;
}

// ─── Config singleton ─────────────────────────────────────────────────────────

let _config: LoadedConfig | null = null;
let _configError: string | null = null;

// Injected at build time by electrobun.config.ts for dev builds (via Bun define).
// In production builds this is undefined and the fallback to ~/.railyn/config is used.
declare const __RAILYN_DEV_CONFIG_DIR__: string | undefined;

export function getConfigDir(): string {
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

# List all AI providers you want to use simultaneously.
providers:
  # Fake provider — used for local UI development. Remove when using a real provider.
  - id: fake
    type: fake

  # Anthropic direct API (Claude models)
  # - id: anthropic
  #   type: anthropic
  #   api_key: sk-ant-YOUR_KEY_HERE

  # OpenRouter (access to many models via one API key)
  # - id: openrouter
  #   type: openrouter
  #   base_url: https://openrouter.ai/api/v1
  #   api_key: sk-or-YOUR_KEY_HERE
  #   # provider_args: forwarded as the "provider" key in every request body (OpenRouter routing preferences)
  #   # provider_args:
  #   #   ignore: [google-vertex, azure]

  # LM Studio (local models)
  # - id: lmstudio
  #   type: lmstudio
  #   base_url: http://localhost:1234/

# Web search (used by the search_internet tool)
# search:
#   engine: tavily   # "tavily" is the only supported engine in v1
#   api_key: ""      # get a free key at https://tavily.com
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

  const isTestMode = process.env.RAILYN_DB === ":memory:";
  const workspaceFileName = isTestMode ? "workspace.test.yaml" : "workspace.yaml";
  const workspaceFile = join(configDir, workspaceFileName);

  let workspace: WorkspaceYaml;
  try {
    const raw = readFileSync(workspaceFile, "utf-8");
    workspace = yaml.load(raw) as WorkspaceYaml;
  } catch (err) {
    _configError = `Failed to parse ${workspaceFileName}: ${err instanceof Error ? err.message : String(err)}`;
    return { config: null, error: _configError };
  }

  // ── Resolve engine config ──────────────────────────────────────────────────
  //
  // Priority:
  //   1. New `engine:` block (discriminated by type)
  //   2. Legacy top-level `providers:` list → auto-migrate to native engine in memory
  //   3. Legacy top-level `ai:` block → auto-migrate to native engine in memory
  //
  // For the native engine, workspace.anthropic / search / lsp are also promoted
  // from engine.* into workspace.* so all existing consumers continue to work.

  let engine: EngineConfig;
  let providers: ProviderConfig[];

  if (workspace.engine) {
    engine = workspace.engine;
    if (engine.type === "copilot") {
      // Copilot engine — no local providers needed
      providers = [];
    } else {
      // Native engine block
      const nativeCfg = engine as NativeEngineConfig;
      if (!nativeCfg.providers || nativeCfg.providers.length === 0) {
        _configError = `${workspaceFileName}: engine.type:native requires at least one entry in engine.providers.`;
        return { config: null, error: _configError };
      }
      providers = nativeCfg.providers;
      // Promote engine-nested fields into workspace.* so all existing consumers work
      if (nativeCfg.anthropic && !workspace.anthropic) workspace.anthropic = nativeCfg.anthropic;
      if (nativeCfg.search && !workspace.search) workspace.search = nativeCfg.search;
      if (nativeCfg.lsp && !workspace.lsp) workspace.lsp = nativeCfg.lsp;
      if (nativeCfg.default_model && !workspace.default_model) workspace.default_model = nativeCfg.default_model;
      if (nativeCfg.worktree_base_path && !workspace.worktree_base_path) workspace.worktree_base_path = nativeCfg.worktree_base_path;
    }
  } else if (workspace.providers && workspace.providers.length > 0) {
    // Legacy top-level providers: auto-migrate to native engine in memory
    if (workspace.ai) {
      console.warn(`[config] Both 'providers:' and 'ai:' found in ${workspaceFileName} — using 'providers:' and ignoring 'ai:'.`);
    }
    providers = workspace.providers;
    engine = {
      type: "native",
      providers,
      default_model: workspace.default_model,
      search: workspace.search,
      anthropic: workspace.anthropic,
      lsp: workspace.lsp,
      worktree_base_path: workspace.worktree_base_path,
    };
    // Attach so consumers can read config.engine
    workspace.engine = engine;
  } else if (workspace.ai) {
    // Oldest legacy format: single `ai:` block
    const ai = workspace.ai;
    providers = [{
      id: "default",
      type: ai.provider ?? "fake",
      base_url: ai.base_url || undefined,
      api_key: ai.api_key || undefined,
      context_window_tokens: ai.context_window_tokens,
    }];
    engine = {
      type: "native",
      providers,
      default_model: workspace.default_model,
      search: workspace.search,
      anthropic: workspace.anthropic,
      lsp: workspace.lsp,
      worktree_base_path: workspace.worktree_base_path,
    };
    workspace.engine = engine;
  } else {
    _configError = `${workspaceFileName} is missing 'engine:', 'providers:', or legacy 'ai:' section.`;
    return { config: null, error: _configError };
  }

  // Validate provider entries & detect duplicates
  const seen = new Set<string>();
  const deduped: ProviderConfig[] = [];
  for (const p of providers) {
    if (!p.id) { console.warn("[config] Provider entry missing 'id' — skipping."); continue; }
    if (seen.has(p.id)) {
      console.warn(`[config] Duplicate provider id '${p.id}' — ignoring subsequent entries.`);
      continue;
    }
    seen.add(p.id);
    // Validate base_url for non-fake, non-anthropic providers
    if (p.type !== "fake" && p.type !== "anthropic" && !p.base_url) {
      console.warn(`[config] Provider '${p.id}' (type: ${p.type}) is missing 'base_url' — it may not function correctly.`);
    }
    deduped.push(p);
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

  _config = { workspace, providers: deduped, workflows, engine };
  _configError = null;
  return { config: _config, error: null };
}

export function getConfig(): LoadedConfig {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() at startup.");
  }
  return _config;
}

export function resetConfig(): void {
  _config = null;
  _configError = null;
}

/**
 * Persist a partial update to the workspace.yaml file by merging the given
 * fields into the existing parsed document and writing it back.
 * This does not preserve comments in the yaml file.
 */
export function patchWorkspaceYaml(patch: Partial<WorkspaceYaml>): void {
  const configDir = getConfigDir();
  const isTestMode = process.env.RAILYN_DB === ":memory:";
  const workspaceFileName = isTestMode ? "workspace.test.yaml" : "workspace.yaml";
  const workspaceFile = join(configDir, workspaceFileName);

  let current: WorkspaceYaml = {};
  try {
    const raw = readFileSync(workspaceFile, "utf-8");
    current = yaml.load(raw) as WorkspaceYaml ?? {};
  } catch { /* file may not exist yet */ }

  const merged = { ...current, ...patch };
  // Deep-merge nested objects (anthropic)
  if (patch.anthropic && current.anthropic) {
    merged.anthropic = { ...current.anthropic, ...patch.anthropic };
  }

  writeFileSync(workspaceFile, yaml.dump(merged), "utf-8");
  // Invalidate the in-memory config so the next getConfig() call re-reads it
  resetConfig();
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
