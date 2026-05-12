import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, isAbsolute, resolve, relative } from "path";
import { createHash } from "crypto";
import yaml from "js-yaml";
import { resolveConfigPath } from "./path-utils.ts";
import { getDataDir as platformGetDataDir, getHomeDir } from "../utils/platform.ts";
import { seedWorkflows } from "./workflows.ts";

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

/** Scripted engine config — echoes prompts; no credentials required. For dev and test only. */
export interface ScriptedEngineConfig {
  type: "scripted";
}

/** OpenCode engine config — uses the OpenCode AI SDK with configurable providers. */
export interface OpenCodeEngineConfig {
  type: "opencode";
  /** Default model in "providerID/modelID" format, e.g. "anthropic/claude-sonnet-4-5". */
  model?: string;
  /**
   * Provider configuration map. Keys are OpenCode provider IDs (e.g. "anthropic", "openai", "ollama").
   * Supports custom base URLs for local LLMs (Ollama, LM Studio, OpenAI-compatible endpoints).
   */
  providers?: Record<string, OpenCodeProviderConfig>;
}

export interface OpenCodeProviderConfig {
  /** API key for the provider. */
  api_key?: string;
  /** Custom base URL, useful for local LLMs (e.g. http://localhost:11434/v1). */
  base_url?: string;
  /** Optional npm package override for the provider SDK. */
  npm?: string;
  /** Per-model configuration overrides. */
  models?: Record<string, { name?: string }>;
}

/** A named set of LLM sampling parameters for the Pi engine. All fields are optional. */
export interface SamplingPreset {
  /** Optional human-readable display name shown in the preset selector. Falls back to the YAML key. */
  label?: string;
  /** Optional description shown as subtitle in the preset selector dropdown option. */
  description?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  /** Penalizes tokens based on how often they appear, reducing repetition. Supported by vLLM, SGLang, OpenRouter. */
  repetition_penalty?: number;
  /** Penalizes tokens based on frequency in the text so far. Supported by OpenAI, vLLM, SGLang, OpenRouter. */
  frequency_penalty?: number;
  /** Seed for reproducible outputs. Supported by vLLM, SGLang, OpenRouter, Ollama. */
  seed?: number;
  /** Alternative to temperature/top_p, more stable across models. Supported by vLLM, SGLang. */
  min_p?: number;
}


/** Per-provider concurrency and connection settings for the Pi engine. */
export interface PiProviderConfig {
  base_url: string;
  api_key?: string;
  /**
   * Maximum concurrent in-flight LLM requests to this provider across all
   * Pi sessions (parent, children, background compaction). Default: 8 (vLLM-shaped).
   * Recommended values: vLLM/SGLang 8, Ollama 4, LM Studio 2.
   */
  max_inflight?: number;
  /**
   * Maximum time in milliseconds a request may wait in the queue before being
   * rejected with a timeout error. Default: 60_000 (1 minute).
   */
  queue_timeout_ms?: number;
}

/** Harness-level config for the delegate fan-out tool. */
export interface PiDelegateConfig {
  /** When false, the delegate tool is not registered. Default: true. */
  enabled?: boolean;
  /**
   * Maximum number of sub-jobs the model may submit in a single delegate call.
   * Must be between 1 and 10. Default: 5.
   */
  max_per_call?: number;
  /**
   * Override for the effective concurrency cap per delegate call.
   * When omitted, derived as min(max_per_call, provider.max_inflight).
   */
  max_concurrency?: number;
  /**
   * Tool groups children are allowed to use. Allowed values: "read", "write", "shell", "web".
   * Default: ["read", "write", "shell"]. Children operate on the shared parent worktree and
   * may edit files and run shell commands, but NEVER receive the `delegate` tool (no recursive
   * fan-out) or board-mutating common tools.
   */
  allow_tools?: ("read" | "write" | "shell" | "web")[];
}

/** Harness-level config for opportunistic background compaction. */
export interface PiBackgroundCompactionConfig {
  /** When false, background compaction is disabled. Default: true. */
  enabled?: boolean;
  /**
   * Additional token margin added to the SDK's reserveTokens (16,384) to compute
   * the soft compaction threshold. Background compaction fires when context usage
   * exceeds contextWindow - (reserveTokens + early_margin_tokens).
   * Must be ≥ 1024. Default: 8192.
   */
  early_margin_tokens?: number;
}

/** Pi engine config — uses the Pi agent SDK for local LLMs (LM Studio, Ollama, OpenAI-compatible). */
export interface PiEngineConfig {
  type: "pi";
  /** Default model in "provider/model" format, e.g. "lmstudio/qwen3-8b". */
  model?: string;
  /**
   * Context window size in tokens for the model. Used to calibrate the Pi SDK's
   * auto-compaction threshold (fires at contextWindow - 16,384 tokens).
   * Default: 128_000. Override for smaller models (e.g. 8192 for Mistral-7B).
   */
  context_window?: number;
  /**
   * OpenAI-compatible provider endpoints keyed by provider name.
   * e.g. lmstudio: { base_url: "http://localhost:1234/v1" }
   */
  providers?: Record<string, PiProviderConfig>;
  /** Harness-level tuning options. */
  harness?: {
    /** Maximum undo stack depth per conversation. Default: 50. */
    undo_stack_size?: number;
    /** Fan-out delegate tool settings. */
    delegate?: PiDelegateConfig;
    /** Opportunistic background compaction settings. */
    background_compaction?: PiBackgroundCompactionConfig;
  };
  /**
   * Slash-command dialect to use for command discovery and resolution.
   * - "copilot" — scans .github/prompts/*.prompt.md (GitHub Copilot convention)
   * - "claude"  — scans .claude/commands/ recursively (Claude convention, colon-namespaced subdirs)
   * - "none"    — no slash commands (default when omitted)
   */
  dialect?: "copilot" | "claude" | "none";
  /** Named sampling parameter presets for this Pi engine instance. */
  sampling_presets?: Record<string, SamplingPreset>;
  /** Name of the preset to use when a column does not specify one. */
  default_sampling_preset?: string;
}

/** Cursor engine config — uses the Cursor Agent SDK. */
export interface CursorEngineConfig {
  type: "cursor";
  /** Default model for the Cursor agent. If unset, Cursor uses its default model. */
  model?: string;
}
export type EngineConfig = CopilotEngineConfig | ClaudeEngineConfig | ScriptedEngineConfig | OpenCodeEngineConfig | PiEngineConfig | CursorEngineConfig;

/**
 * A single engine entry from `engines.yaml`.
 * The `id` field must match the engine type (e.g. "copilot", "claude", "opencode").
 */
export interface EngineEntry {
  /** Unique identifier for this engine — equals the engine type in v1. */
  id: string;
  /** Merged engine configuration (type + model + any provider-specific fields). */
  config: EngineConfig;
}

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
  /** Optional list of engine IDs (from engines.yaml) that are available in this workspace. When absent, all engines are available. */
  allowed_engines?: string[];
  /** @deprecated Legacy native-engine config. No longer supported. */
  providers?: ProviderConfig[];
  /** @deprecated Legacy native-engine config. No longer supported. */
  ai?: AIProviderConfig;
  worktree_base_path?: string;
  /** Base path for chat session working directory. All projects should live under this folder. */
  workspace_path?: string;
  git_path?: string; // absolute path to git binary, e.g. /usr/bin/git
  shell_env_timeout_ms?: number; // timeout for shell environment resolution in milliseconds (default: 10000)
  /** Workspace default model in `<engineId>/<modelId>` format (e.g. `copilot/gpt-4.1`). Used to seed new conversation models. */
  default_model?: string;
  /** @deprecated Legacy native-engine config. No longer supported. */
  search?: SearchConfig;
  /** @deprecated Legacy native-engine config. No longer supported. */
  anthropic?: AnthropicConfig;
  /** LSP language server configuration for this workspace. */
  lsp?: LspConfig;
  /** @deprecated Use engines.yaml instead. Kept for backward-compat detection only. */
  engine?: EngineConfig;
  /** When true, new tasks are created with shell_auto_approve enabled by default. */
  shell_auto_approve?: boolean;
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
  /** Name of a sampling preset defined in the active Pi engine's config. */
  sampling_preset?: string;
}

export interface WorkflowColumnGroup {
  id?: string;
  label?: string;
  columns: string[];
}

export interface WorkflowTemplateConfig {
  id: string;
  name: string;
  /** Inline instructions prepended to every AI execution in this workflow. */
  workflow_instructions?: string;
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
  /**
   * Ordered list of all engine instances available in this workspace.
   * Populated from `engines.yaml`.
   */
  engines: EngineEntry[];
  /** Default model for this workspace, from workspace.yaml default_model. Null when unset. */
  defaultModel: string | null;
  /**
   * Subset of engine IDs permitted for this workspace (from `allowed_engines` in workspace.yaml).
   * `null` means no restriction — all engines from `engines.yaml` are available.
   */
  allowedEngineIds: string[] | null;
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
  /** Path from gitRootPath to projectPath. Empty string for standalone repos. */
  subPath: string;
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
  const dataDir = platformGetDataDir();
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

// Track which workflow directories have already been seeded in this process.
// Intentionally NOT cleared by resetConfig() so that config resets triggered
// by workflow.create / delete / saveYaml do not cause unnecessary repeated
// filesystem scans of the bundled source directory.
const _seededWorkflowDirs = new Set<string>();

export function invalidateConfigCache(): void {
  _configsByKey.clear();
  _config = null;
  _configError = null;
}
let _workspaceRegistry: WorkspaceRegistryEntry[] | null = null;
const configContext = new AsyncLocalStorage<LoadedConfig>();

// Injected at build time via --define in package.json scripts for dev builds.
// In production builds this is undefined and the fallback to ~/.railyn/config is used.
declare const __RAILYN_DEV_CONFIG_DIR__: string | undefined;

export function getGlobalConfigDir(): string {
  // 1. Explicit env override (used by tests and CI)
  if (process.env.RAILYN_CONFIG_DIR) return process.env.RAILYN_CONFIG_DIR;
  // 2. Dev build: absolute path baked in at bundle time via --define
  if (typeof __RAILYN_DEV_CONFIG_DIR__ !== "undefined" && existsSync(__RAILYN_DEV_CONFIG_DIR__)) {
    return __RAILYN_DEV_CONFIG_DIR__;
  }
  // 3. Production: user's data directory
  return join(platformGetDataDir(), "config");
}

export function getDataDir(): string {
  return platformGetDataDir();
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
  return entry?.configDir ?? getGlobalConfigDir();
}

// ─── Default file content ────────────────────────────────────────────────────

const DEFAULT_WORKSPACE_YAML = `
name: My Workspace

projects: []

# default_model: copilot/gpt-4.1   # workspace default model (<engineId>/<modelId>)

# Web search (used by the search_internet tool)
# search:
#   engine: tavily   # "tavily" is the only supported engine in v1
#   api_key: ""      # get a free key at https://tavily.com
`.trimStart();

/**
 * Parsed shape of a single entry in `engines.yaml`.
 * The raw YAML has `id` plus all engine config fields at the top level.
 */
interface RawEngineYamlEntry {
  id: string;
  type: string;
  model?: string;
  providers?: Record<string, OpenCodeProviderConfig>;
  [key: string]: unknown;
}

interface EnginesYaml {
  engines: RawEngineYamlEntry[];
}

/**
 * Load `engines.yaml` from the config directory.
 *
 * - If `engines.yaml` is present: returns parsed `EngineEntry[]` (order preserved).
 * - If absent: returns `null`.
 */
export function loadEnginesConfig(configDir: string): EngineEntry[] | null {
  const enginesFile = join(configDir, "engines.yaml");
  if (!existsSync(enginesFile)) return null;

  let raw: EnginesYaml | null = null;
  try {
    const content = readFileSync(enginesFile, "utf-8");
    raw = yaml.load(content) as EnginesYaml;
  } catch (err) {
    console.warn(`[config] Failed to parse engines.yaml: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  if (!raw || !Array.isArray(raw.engines) || raw.engines.length === 0) {
    console.warn("[config] engines.yaml is empty or missing 'engines:' list — ignoring.");
    return null;
  }

  const entries: EngineEntry[] = [];
  for (const entry of raw.engines) {
    if (!entry.id || !entry.type) {
      console.warn("[config] engines.yaml entry missing 'id' or 'type' — skipping:", entry);
      continue;
    }
    const { id, ...rest } = entry;
    entries.push({ id, config: rest as EngineConfig });
  }

  if (entries.length === 0) {
    console.warn("[config] engines.yaml contained no valid engine entries — ignoring.");
    return null;
  }

  return entries;
}

export function ensureGlobalConfigExists(globalConfigDir: string): void {
  mkdirSync(globalConfigDir, { recursive: true });
  const enginesFile = join(globalConfigDir, "engines.yaml");
  if (!existsSync(enginesFile)) {
    writeFileSync(enginesFile, "engines:\n  - id: copilot\n    type: copilot\n", "utf-8");
    console.log(`[config] Created default engines.yaml at ${enginesFile}`);
  }
}

export function ensureWorkspaceConfigExists(configDir: string): void {
  const workspaceFile = join(configDir, getWorkspaceFileName());
  const workflowsDir = join(configDir, "workflows");

  mkdirSync(workflowsDir, { recursive: true });

  if (!existsSync(workspaceFile)) {
    writeFileSync(workspaceFile, DEFAULT_WORKSPACE_YAML, "utf-8");
    console.log(`[config] Created default workspace.yaml at ${workspaceFile}`);
  }

  // Seed workflows only once per unique workflows directory per process.
  // Using a module-level set means config resets triggered by workflow
  // create/delete/saveYaml will not cause repeated bundled-source scans.
  // Tests use unique temp dirs so each test's dir is always unseeded.
  if (!_seededWorkflowDirs.has(workflowsDir)) {
    _seededWorkflowDirs.add(workflowsDir);
    seedWorkflows(workflowsDir);
  }
}

/** Mark a workflows directory as already seeded. Used by the startup seed loop
 *  in index.ts so that subsequent loadConfig calls for those workspaces do not
 *  re-run seedWorkflows unnecessarily. */
export function markWorkflowDirSeeded(workflowsDir: string): void {
  _seededWorkflowDirs.add(workflowsDir);
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
  const globalConfigDir = getGlobalConfigDir();

  // Auto-create default config files if they don't exist yet
  ensureWorkspaceConfigExists(configDir);
  ensureGlobalConfigExists(globalConfigDir);

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

  const providers: ProviderConfig[] = [];

  // Hard error if legacy engine: block is present
  if (workspace.engine !== undefined) {
    _configError = [
      `${workspaceFileName}: engine: block is no longer supported.`,
      `Replace it with:`,
      `  default_model: <engineId>/<modelId>   # e.g. copilot/gpt-4.1`,
      `and ensure engines.yaml declares the engines you want available.`,
      `See config/engines.yaml.sample.`,
    ].join("\n");
    return { config: null, error: _configError };
  }

  if (workspace.providers?.length || workspace.ai || workspace.search) {
    _configError = `${workspaceFileName}: legacy native-engine config was removed. Replace providers/ai/search with a supported engine in engines.yaml.`;
    return { config: null, error: _configError };
  }

  const engines = loadEnginesConfig(globalConfigDir);

  if (!engines || engines.length === 0) {
    _configError = [
      `engines.yaml is required but was not found or contained no valid entries.`,
      `See config/engines.yaml.sample for an example.`,
    ].join("\n");
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

  // Load workflow templates from config/workflows/. The directory is seeded
  // from the bundled source by ensureWorkspaceConfigExists(), so it always
  // contains at least one workflow file.
  const workflowsDir = join(configDir, "workflows");
  const workflows: WorkflowTemplateConfig[] = [];

  if (existsSync(workflowsDir)) {
    const files = readdirSync(workflowsDir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort();
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

  const rawProjects = workspace.projects ?? [];

  // Validate workspace_path is set when projects are defined
  if (rawProjects.length > 0 && !workspace.workspace_path) {
    _configError = `workspace_path is required when projects are defined. Add a workspace_path to your workspace.yaml.`;
    return { config: null, error: _configError };
  }

  const workspacePath = workspace.workspace_path!;

  const projects: LoadedProject[] = [];
  for (let index = 0; index < rawProjects.length; index++) {
    const project = rawProjects[index]!;
    const key = sanitizeProjectKey(project.key ?? project.slug, project.name || `project-${index + 1}`);

    if (isAbsolute(project.project_path)) {
      _configError = `project "${project.name}": project_path must be a relative path (relative to workspace_path).\nFound: ${project.project_path}\nMigration: change project_path to the path relative to your workspace_path.\nExample: if workspace_path is ${workspacePath}, use project_path: ${relative(workspacePath, project.project_path)}`;
      return { config: null, error: _configError };
    }

    const resolvedProjectPath = resolveConfigPath(workspacePath, project.project_path);

    let resolvedGitRootPath: string;
    if (project.git_root_path) {
      if (isAbsolute(project.git_root_path)) {
        _configError = `project "${project.name}": git_root_path must be a relative path (relative to workspace_path).\nFound: ${project.git_root_path}\nMigration: change git_root_path to the path relative to your workspace_path.\nExample: if workspace_path is ${workspacePath}, use git_root_path: ${relative(workspacePath, project.git_root_path)}`;
        return { config: null, error: _configError };
      }
      resolvedGitRootPath = resolveConfigPath(workspacePath, project.git_root_path);
    } else {
      resolvedGitRootPath = resolvedProjectPath;
    }

    const subPath = relative(resolvedGitRootPath, resolvedProjectPath);

    projects.push({
      id: getProjectIdForKey(entry.key, key),
      key,
      workspaceId: entry.id,
      workspaceKey: entry.key,
      name: project.name,
      projectPath: resolvedProjectPath,
      gitRootPath: resolvedGitRootPath,
      subPath,
      defaultBranch: project.default_branch ?? "main",
      ...(project.slug ? { slug: project.slug } : {}),
      ...(project.description ? { description: project.description } : {}),
    });
  }

  _config = {
    workspaceId: entry.id,
    workspaceKey: entry.key,
    workspaceName: workspace.name ?? entry.name,
    configDir,
    workspace,
    projects,
    providers: deduped,
    workflows,
    engines,
    defaultModel: workspace.default_model ?? null,
    allowedEngineIds: workspace.allowed_engines?.length ? workspace.allowed_engines : null,
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
  // Deep-merge nested objects (anthropic)
  if (patch.anthropic && current.anthropic) {
    merged.anthropic = { ...current.anthropic, ...patch.anthropic };
  }
  // Strip deprecated fields that are no longer functional
  delete (merged as Record<string, unknown>).git_path;
  delete (merged as Record<string, unknown>).shell_env_timeout_ms;

  writeFileSync(workspaceFile, yaml.dump(merged), "utf-8");
  // Invalidate the in-memory config so the next getConfig() call re-reads it
  resetConfig();
}
