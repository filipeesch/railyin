/**
 * refinement/providers.ts
 *
 * Loads and validates provider configuration from config/providers.yaml.
 * Resolves backendUrl for each provider based on type and host/port.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import type { ProviderConfig, ProvidersYaml } from "./types.ts";

// Default Sonnet pricing (fallback when provider does not specify pricing)
export const DEFAULT_PRICING = {
  input: 3.0,
  cache_write: 6.0,
  cache_read: 0.30,
  output: 15.0,
} as const;

const CONFIG_PATH = join(import.meta.dir, "..", "config", "providers.yaml");

function resolveBackendUrl(provider: ProviderConfig): string {
  if (provider.type === "mock") return "";
  if (provider.type === "anthropic") return "https://api.anthropic.com";
  // openai or lmstudio
  const host = provider.host ?? "localhost";
  const port = provider.port ?? 1234;
  return `http://${host}:${port}`;
}

function validateProvider(p: Record<string, unknown>, filePath: string): ProviderConfig {
  if (typeof p["id"] !== "string" || !p["id"]) {
    throw new Error(`${filePath}: provider missing required field 'id'`);
  }
  const type = p["type"];
  if (type !== "mock" && type !== "lmstudio" && type !== "anthropic" && type !== "openai") {
    throw new Error(`${filePath}: provider '${p["id"]}' has invalid type '${type}'. Must be mock, lmstudio, openai, or anthropic.`);
  }
  if (type === "lmstudio" && !p["model_key"]) {
    throw new Error(`${filePath}: lmstudio provider '${p["id"]}' requires 'model_key'`);
  }
  if (type === "anthropic") {
    const apiKey = p["api_key"] ?? process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new Error(`${filePath}: anthropic provider '${p["id"]}' requires 'api_key' or ANTHROPIC_API_KEY environment variable`);
    }
  }
  const config = p as unknown as ProviderConfig;
  config.backendUrl = resolveBackendUrl(config);

  // Add api_key from env if not in config
  if (type === "anthropic" && !config.api_key) {
    config.api_key = process.env["ANTHROPIC_API_KEY"];
  }

  return config;
}

export function loadProviders(configPath: string = CONFIG_PATH): ProvidersYaml {
  if (!existsSync(configPath)) {
    throw new Error(
      `config/providers.yaml not found. Copy config/providers.yaml.sample and configure your providers.`,
    );
  }

  const content = readFileSync(configPath, "utf-8");
  const raw = yaml.load(content) as Record<string, unknown>;

  if (!raw || typeof raw !== "object") {
    throw new Error(`${configPath}: must be a YAML object`);
  }
  if (typeof raw["stable_commit"] !== "string" || !raw["stable_commit"]) {
    throw new Error(`${configPath}: missing required field 'stable_commit'`);
  }
  if (!Array.isArray(raw["providers"]) || raw["providers"].length === 0) {
    throw new Error(`${configPath}: 'providers' must be a non-empty array`);
  }

  const providers: ProviderConfig[] = [];
  for (const entry of raw["providers"] as unknown[]) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${configPath}: each provider entry must be an object`);
    }
    providers.push(validateProvider(entry as Record<string, unknown>, configPath));
  }

  return {
    stable_commit: raw["stable_commit"] as string,
    runs_per_scenario: typeof raw["runs_per_scenario"] === "number" ? raw["runs_per_scenario"] : 2,
    default_providers: Array.isArray(raw["default_providers"])
      ? (raw["default_providers"] as string[])
      : undefined,
    providers,
  };
}

/**
 * Select active providers from the loaded config based on a comma-separated
 * --providers flag value. Falls back to default_providers, then all providers.
 */
export function selectProviders(
  config: ProvidersYaml,
  providersFlag?: string,
): ProviderConfig[] {
  const allById = new Map(config.providers.map((p) => [p.id, p]));

  let ids: string[];
  if (providersFlag) {
    ids = providersFlag.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (config.default_providers && config.default_providers.length > 0) {
    ids = config.default_providers;
  } else {
    return config.providers;
  }

  const selected: ProviderConfig[] = [];
  for (const id of ids) {
    const provider = allById.get(id);
    if (!provider) {
      const available = config.providers.map((p) => p.id).join(", ");
      throw new Error(`Unknown provider: ${id}. Available: ${available}`);
    }
    selected.push(provider);
  }
  return selected;
}

/**
 * Get the effective model ID string to use for engine-runner and proxy config.
 * Uses provider.model if set, otherwise synthesizes from type and model_key.
 */
export function getModelId(provider: ProviderConfig): string {
  if (provider.type === "openai") {
    // For openai type, derive a qualified model ID using the provider id as prefix
    // so the engine's resolveProvider can parse it. The actual model sent to the
    // backend is resolved separately (model_key or model stripped of prefix).
    const key = provider.model_key ?? provider.model ?? "model";
    return `${provider.id}/${key}`;
  }
  if (provider.model) return provider.model;
  if (provider.type === "lmstudio" && provider.model_key) {
    return `lmstudio/${provider.model_key}`;
  }
  if (provider.type === "anthropic") {
    return "anthropic/claude-3-5-sonnet-20241022";
  }
  return "anthropic/claude-3-5-sonnet-20241022"; // mock default
}
