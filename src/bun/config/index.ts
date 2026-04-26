import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
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

/** Config block for Anthropic-specific settings. */
export interface AnthropicConfig {
  cache_ttl?: "5m" | "1h";
  enable_thinking?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  context_edit_strategy?: { enabled?: boolean };
}

/** Config block for web search. */
export interface SearchConfig {
  engine: string;
  api_key: string;
}

/** Config block for LSP servers. */
export interface LspConfig {
  servers?: Array<{ name: string; command: string; args: string[]; extensions: string[] }>;
}

/** Copilot engine config — uses the GitHub Copilot SDK. */
export interface CopilotEngineConfig {
  type: "copilot";
  /** Copilot model ID (e.g. "gpt-4.1"). Leave unset for the Copilot default. */
  model?: string;
}

/** Claude engine config — uses the Claude Agent SDK / Claude Code environment. */
export interface ClaudeEngineConfig {
  type: "claude";
  /** Claude model ID (e.g. "claude-sonnet-4-6"). Leave unset for Claude defaults. */
  model?: string;
}

export type EngineConfig = CopilotEngineConfig | ClaudeEngineConfig;

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
  projects?: WorkspaceProjectYaml[];
  /**
   * New engine block. Discriminated by `type`:
   *   - `copilot`: GitHub Copilot SDK
   *   - `claude`: Claude Agent SDK / Claude Code
   */
  engine?: EngineConfig;
  /** @deprecated Legacy native-engine config. No longer supported. */
  providers?: ProviderConfig[];
  /** @deprecated Legacy native-engine config. No longer supported. */
  ai?: AIProviderConfig;
  worktree_base_path?: string;
  /** Base path for chat session working directory. All projects should live under this folder. */
  workspace_path?: string;
  git_path?: string; // absolute path to git binary, e.g. /usr/bin/git
  shell_env_timeout_ms?: number; // timeout for shell environment resolution in milliseconds (default: 10000)
  /** @deprecated Legacy native-engine config. No longer supported. */
  default_model?: string;
  /** @deprecated Legacy native-engine config. No longer supported. */
  search?: SearchConfig;
  /** @deprecated Legacy native-engine config. No longer supported. */
  anthropic?: AnthropicConfig;
  /** @deprecated Legacy native-engine config. No longer supported. */
  lsp?: LspConfig;
}

export interface WorkspaceProjectYaml {
  key?: string;
  name: string;
  project_path: string;
  git_root_path?: string;
  default_branch?: string;
  slug?: string;
  description?: string;
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
  limit?: number;
}

export interface WorkflowColumnGroup {
  id?: string;
  label?: string;
  columns: string[];
}

export interface WorkflowTemplateConfig {
  id: string;
  name: string;
  columns: WorkflowColumnConfig[];
  groups?: WorkflowColumnGroup[];
}

export interface LoadedConfig {
  workspaceId: number;
  workspaceKey: string;
  workspaceName: string;
  configDir: string;
  workspace: WorkspaceYaml;
  projects: LoadedProject[];
  /** Normalized, de-duplicated provider list for legacy helpers; supported engines do not rely on it. */
  providers: ProviderConfig[];
  workflows: WorkflowTemplateConfig[];
  /** Resolved engine config — always present after load */
  engine: EngineConfig;
}

// ─── Global config (config.yaml) ────────────────────────────────────────────

/** Machine/user-level global config. Lives at ~/.railyn/config/config.yaml. */
export interface GlobalWorkspaceEntry {
  key?: string;
  name?: string;
  config_dir?: string;
}

export interface GlobalConfig {
  defaults?: Partial<WorkspaceYaml>;
  workspaces?: GlobalWorkspaceEntry[];
}

export interface WorkspaceRegistryEntry {
  id: number;
  key: string;
  name: string;
  configDir: string;
}

export interface LoadedProject {
  id: number;
  key: string;
  workspaceId: number;
  workspaceKey: string;
  name: string;
  projectPath: string;
  gitRootPath: string;
  defaultBranch: string;
  slug?: string;
  description?: string;
}

function getWorkspaceCacheKey(entry: WorkspaceRegistryEntry): string {
  return `${entry.key}:${entry.configDir}`;
}

function stableNumericId(seed: string): number {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 12);
  return parseInt(hex, 16);
}

export function getWorkspaceIdForKey(workspaceKey: string): number {
  return workspaceKey === "default" ? 1 : stableNumericId(`workspace:${workspaceKey}`);
}

export function getProjectIdForKey(workspaceKey: string, projectKey: string): number {
  return stableNumericId(`project:${workspaceKey}:${projectKey}`);
}

/** Read ~/.railyn/config/config.yaml. Returns an empty object if the file is absent or unparseable.
 *  Always reads from the real user data directory — intentionally bypasses the dev config dir
 *  override (__RAILYN_DEV_CONFIG_DIR__) since global config is machine-scoped, not project-scoped. */
export function readGlobalConfig(): GlobalConfig {
  const dataDir = process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
  const configPath = join(dataDir, "config", "config.yaml");
  if (!existsSync(configPath)) return {};
  try {
    const parsed = yaml.load(readFileSync(configPath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as GlobalConfig;
  } catch (err) {
    console.warn("[config] Failed to parse config.yaml:", err);
    return {};
  }
}

// ─── Config singleton ─────────────────────────────────────────────────────────

let _config: LoadedConfig | null = null;
const _configsByKey = new Map<string, LoadedConfig>();
let _configError: string | null = null;
let _workspaceRegistry: WorkspaceRegistryEntry[] | null = null;
const configContext = new AsyncLocalStorage<LoadedConfig>();

// Injected at build time via --define in package.json scripts for dev builds.
// In production builds this is undefined and the fallback to ~/.railyn/config is used.
declare const __RAILYN_DEV_CONFIG_DIR__: string | undefined;

function getDefaultConfigDir(): string {
  // 1. Explicit env override (used by tests and CI)
  if (process.env.RAILYN_CONFIG_DIR) return process.env.RAILYN_CONFIG_DIR;
  // 2. Dev build: absolute path baked in at bundle time via --define
  if (typeof __RAILYN_DEV_CONFIG_DIR__ !== "undefined" && existsSync(__RAILYN_DEV_CONFIG_DIR__)) {
    return __RAILYN_DEV_CONFIG_DIR__;
  }
  // 3. Production: user's data directory
  const dataDir = process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
  return join(dataDir, "config");
}

export function getDataDir(): string {
  return process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
}

export function getWorkspaceRootDir(): string {
  return process.env.RAILYN_WORKSPACES_DIR ?? join(getDataDir(), "workspaces");
}

function sanitizeWorkspaceKey(raw: string | undefined, fallback: string): string {
  const key = (raw ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return key || fallback;
}

export { sanitizeWorkspaceKey };

function sanitizeProjectKey(raw: string | undefined, fallback: string): string {
  const key = (raw ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return key || fallback;
}

function titleizeKey(key: string): string {
  return key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getWorkspaceFileName(): string {
  return process.env.RAILYN_DB === ":memory:" ? "workspace.test.yaml" : "workspace.yaml";
}

function readWorkspaceYamlFile(configDir: string): WorkspaceYaml | null {
  const workspaceFile = join(configDir, getWorkspaceFileName());
  if (!existsSync(workspaceFile)) return null;
  try {
    const parsed = yaml.load(readFileSync(workspaceFile, "utf-8"));
    return (typeof parsed === "object" && parsed !== null ? parsed : {}) as WorkspaceYaml;
  } catch {
    return null;
  }
}

function mergeWorkspaceDefaults(
  workspace: WorkspaceYaml,
  defaults?: Partial<WorkspaceYaml>,
): WorkspaceYaml {
  if (!defaults) return workspace;
  const merged: WorkspaceYaml = {
    ...defaults,
    ...workspace,
  };
  if (defaults.anthropic || workspace.anthropic) {
    merged.anthropic = { ...(defaults.anthropic ?? {}), ...(workspace.anthropic ?? {}) };
  }
  if (defaults.search || workspace.search) {
    merged.search = { ...(defaults.search ?? {} as SearchConfig), ...(workspace.search ?? {} as SearchConfig) };
  }
  if (defaults.lsp || workspace.lsp) {
    merged.lsp = { ...(defaults.lsp ?? {}), ...(workspace.lsp ?? {}) };
  }
  if (defaults.engine || workspace.engine) {
    merged.engine = { ...(defaults.engine ?? {} as EngineConfig), ...(workspace.engine ?? {} as EngineConfig) } as EngineConfig;
  }
  return merged;
}

export function getWorkspaceRegistry(): WorkspaceRegistryEntry[] {
  if (_workspaceRegistry) return _workspaceRegistry;

  if (process.env.RAILYN_CONFIG_DIR) {
    const key = "default";
    const configDir = process.env.RAILYN_CONFIG_DIR;
    const workspace = readWorkspaceYamlFile(configDir) ?? {};
    _workspaceRegistry = [{
      id: getWorkspaceIdForKey(key),
      key,
      name: workspace.name?.trim() || "My Workspace",
      configDir,
    }];
    return _workspaceRegistry;
  }

  const workspaceRootDir = getWorkspaceRootDir();
  const workspaceFileName = getWorkspaceFileName();
  const entries: WorkspaceRegistryEntry[] = [];

  if (existsSync(workspaceRootDir)) {
    for (const entry of readdirSync(workspaceRootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const key = sanitizeWorkspaceKey(entry.name, entry.name);
      const configDir = join(workspaceRootDir, entry.name);
      const workspace = readWorkspaceYamlFile(configDir) ?? {};
      entries.push({
        id: getWorkspaceIdForKey(key),
        key,
        name: workspace.name?.trim() || titleizeKey(key),
        configDir,
      });
    }
  }

  if (entries.length === 0) {
    const defaultDir = join(workspaceRootDir, "default");
    const workspace = readWorkspaceYamlFile(defaultDir) ?? {};
    entries.push({
      id: getWorkspaceIdForKey("default"),
      key: "default",
      name: workspace.name?.trim() || "My Workspace",
      configDir: defaultDir,
    });
  }

  _workspaceRegistry = entries.sort((a, b) => a.key.localeCompare(b.key));

  return _workspaceRegistry;
}

export function getConfigDir(workspaceKey?: string): string {
  const entry = getWorkspaceRegistry().find((item) => item.key === (workspaceKey ?? getWorkspaceRegistry()[0]?.key));
  return entry?.configDir ?? getDefaultConfigDir();
}

// ─── Default file content ────────────────────────────────────────────────────

const DEFAULT_WORKSPACE_YAML = `
name: My Workspace

projects: []

engine:
  type: copilot
  # model: gpt-4.1

# Alternative engine example:
# engine:
#   type: claude
#   model: claude-sonnet-4-6
# Claude auth comes from your local Claude Code session; no API key is stored here.

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

export function ensureConfigExists(configDir: string): void {
  const workspaceFile = join(configDir, getWorkspaceFileName());
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

export function loadConfig(workspaceKey?: string): { config: LoadedConfig | null; error: string | null } {
  const registry = getWorkspaceRegistry();
  const entry = registry.find((item) => item.key === (workspaceKey ?? registry[0]?.key)) ?? registry[0];
  if (!entry) {
    _configError = "No workspace registry entries available.";
    return { config: null, error: _configError };
  }
  const configDir = entry.configDir;
  const cacheKey = getWorkspaceCacheKey(entry);
  if (_configsByKey.has(cacheKey)) {
    const cached = _configsByKey.get(cacheKey)!;
    _config = cached;
    _configError = null;
    return { config: cached, error: null };
  }
  const globalConfig = readGlobalConfig();

  // Auto-create default config files if they don't exist yet
  ensureConfigExists(configDir);

  const workspaceFileName = getWorkspaceFileName();
  const workspaceFile = join(configDir, workspaceFileName);

  let workspace: WorkspaceYaml;
  try {
    const raw = readFileSync(workspaceFile, "utf-8");
    workspace = yaml.load(raw) as WorkspaceYaml;
  } catch (err) {
    _configError = `Failed to parse ${workspaceFileName}: ${err instanceof Error ? err.message : String(err)}`;
    return { config: null, error: _configError };
  }

  workspace = mergeWorkspaceDefaults(workspace ?? {}, globalConfig.defaults);

  // ── Resolve engine config ──────────────────────────────────────────────────

  let engine: EngineConfig;
  const providers: ProviderConfig[] = [];

  if (workspace.engine?.type === "native") {
    _configError = `${workspaceFileName}: engine.type:native is no longer supported. Migrate this workspace to engine.type: copilot or engine.type: claude.`;
    return { config: null, error: _configError };
  }

  if (workspace.providers?.length || workspace.ai || workspace.default_model || workspace.search) {
    _configError = `${workspaceFileName}: legacy native-engine config was removed. Replace providers/ai/default_model/search with a supported engine block (engine.type: copilot or engine.type: claude).`;
    return { config: null, error: _configError };
  }

  if (workspace.engine?.type === "copilot" || workspace.engine?.type === "claude") {
    engine = workspace.engine;
  } else {
    _configError = `${workspaceFileName} is missing 'engine:'. Supported engines are 'copilot' and 'claude'.`;
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

  // Load workflow templates from config/workflows/ (and legacy workflows.yaml)
  const workflowsDir = join(configDir, "workflows");
  const legacyWorkflowsFile = join(configDir, "workflows.yaml");
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
  if (workflows.length === 0 && existsSync(legacyWorkflowsFile)) {
    try {
      const raw = readFileSync(legacyWorkflowsFile, "utf-8");
      const parsed = yaml.load(raw);
      const templates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of templates) {
        const tmpl = item as WorkflowTemplateConfig;
        if (tmpl?.id && tmpl?.columns) workflows.push(tmpl);
      }
    } catch (err) {
      console.warn(`[config] Could not parse legacy workflows.yaml: ${err}`);
    }
  }

  // Always include the bundled default template
  const defaultTemplate = getDefaultTemplate();
  if (!workflows.find((w) => w.id === defaultTemplate.id)) {
    workflows.push(defaultTemplate);
  }

  const rawProjects = workspace.projects ?? [];
  const projects: LoadedProject[] = rawProjects.map((project, index) => {
    const key = sanitizeProjectKey(project.key ?? project.slug, project.name || `project-${index + 1}`);
    return {
      id: getProjectIdForKey(entry.key, key),
      key,
      workspaceId: entry.id,
      workspaceKey: entry.key,
      name: project.name,
      projectPath: project.project_path,
      gitRootPath: project.git_root_path ?? project.project_path,
      defaultBranch: project.default_branch ?? "main",
      ...(project.slug ? { slug: project.slug } : {}),
      ...(project.description ? { description: project.description } : {}),
    };
  });

  _config = {
    workspaceId: entry.id,
    workspaceKey: entry.key,
    workspaceName: workspace.name ?? entry.name,
    configDir,
    workspace,
    projects,
    providers: deduped,
    workflows,
    engine,
  };
  _configsByKey.set(cacheKey, _config);
  _configError = null;
  return { config: _config, error: null };
}

export function getConfig(workspaceKey?: string): LoadedConfig {
  if (workspaceKey) {
    const entry = getWorkspaceRegistry().find((item) => item.key === workspaceKey);
    if (entry) {
      const cached = _configsByKey.get(getWorkspaceCacheKey(entry));
      if (cached) return cached;
    }
    const { config } = loadConfig(workspaceKey);
    if (config) return config;
  }
  const scoped = configContext.getStore();
  if (scoped) return scoped;
  if (!_config) {
    const { config } = loadConfig();
    if (config) return config;
    throw new Error("Config not loaded. Call loadConfig() at startup.");
  }
  return _config;
}

export function runWithConfig<T>(config: LoadedConfig, fn: () => T): T {
  return configContext.run(config, fn);
}

export function resetConfig(): void {
  _config = null;
  _configError = null;
  _configsByKey.clear();
  _workspaceRegistry = null;
}

/**
 * Persist a partial update to the workspace.yaml file by merging the given
 * fields into the existing parsed document and writing it back.
 * This does not preserve comments in the yaml file.
 */
export function patchWorkspaceYaml(patch: Partial<WorkspaceYaml>, workspaceKey?: string): void {
  const configDir = getConfigDir(workspaceKey);
  const isTestMode = process.env.RAILYN_DB === ":memory:";
  const workspaceFileName = isTestMode ? "workspace.test.yaml" : "workspace.yaml";
  const workspaceFile = join(configDir, workspaceFileName);

  let current: WorkspaceYaml = {};
  try {
    const raw = readFileSync(workspaceFile, "utf-8");
    current = yaml.load(raw) as WorkspaceYaml ?? {};
  } catch { /* file may not exist yet */ }

  const merged = { ...current, ...patch };
  // Deep-merge nested objects (anthropic, engine)
  if (patch.anthropic && current.anthropic) {
    merged.anthropic = { ...current.anthropic, ...patch.anthropic };
  }
  if (patch.engine && current.engine) {
    merged.engine = { ...current.engine, ...patch.engine } as EngineConfig;
  }
  // Strip deprecated fields that are no longer functional
  delete (merged as Record<string, unknown>).git_path;
  delete (merged as Record<string, unknown>).shell_env_timeout_ms;

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
