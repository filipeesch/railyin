import { getConfig, getWorkspaceRegistry, loadConfig, runWithConfig, type LoadedConfig } from "./config/index.ts";

export function getDefaultWorkspaceKey(): string {
  return getWorkspaceRegistry()[0]?.key ?? "default";
}

export function getWorkspaceConfig(workspaceKey: string): LoadedConfig {
  const loaded = loadConfig(workspaceKey).config;
  return loaded ?? getConfig(workspaceKey);
}

export function runWithWorkspaceKey<T>(workspaceKey: string, fn: () => T): T {
  return runWithConfig(getWorkspaceConfig(workspaceKey), fn);
}
