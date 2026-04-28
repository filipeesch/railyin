import { resolve, relative, isAbsolute } from "node:path";
import type { LoadedConfig } from "./index.ts";

/**
 * Resolves a config-relative path to an absolute path.
 * Used at config load time to expand relative project_path / git_root_path values.
 */
export function resolveConfigPath(base: string, relativePath: string): string {
  return resolve(base, relativePath);
}

/**
 * Converts an absolute path to a path relative to the workspace root.
 * Used when normalizing paths for YAML storage.
 */
export function toWorkspaceRelativePath(workspacePath: string, absolutePath: string): string {
  return relative(workspacePath, absolutePath);
}

/**
 * Returns the effective workspace path for a loaded config.
 * Replaces the repeated `config.workspace.workspace_path ?? config.configDir` pattern.
 */
export function getEffectiveWorkspacePath(config: LoadedConfig): string {
  return config.workspace.workspace_path ?? config.configDir;
}

/**
 * Returns true if the given path is strictly inside the workspace directory
 * (i.e. relative path does not escape via "..").
 */
export function isInsideWorkspace(workspacePath: string, absolutePath: string): boolean {
  const rel = relative(workspacePath, absolutePath);
  return !isAbsolute(rel) && !rel.startsWith("..");
}
