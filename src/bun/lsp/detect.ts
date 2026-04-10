import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { LANGUAGE_REGISTRY, getRegistryForPlatform } from "./registry.ts";
import type { LanguageEntry } from "./registry.ts";

// ─── Language detection ───────────────────────────────────────────────────────

/**
 * Scans the project root directory (depth 1, no recursion) for language
 * indicator files and returns matching registry entries.
 * Uses the current process platform to filter install options.
 */
export function detectLanguages(projectPath: string): LanguageEntry[] {
  if (!existsSync(projectPath)) return [];

  let entries: string[];
  try {
    entries = readdirSync(projectPath);
  } catch {
    return [];
  }

  const filesSet = new Set(entries);
  const registry = getRegistryForPlatform(process.platform);
  const detected: LanguageEntry[] = [];

  for (const entry of registry) {
    if (matchesAnyGlob(filesSet, entry.detectionGlobs)) {
      detected.push(entry);
    }
  }

  return detected;
}

/**
 * Checks whether any file in the root entries set matches any of the given globs.
 * Supports exact file names and simple extension globs like `*.ts`.
 * No recursive walk — root depth only.
 */
function matchesAnyGlob(filesSet: Set<string>, globs: string[]): boolean {
  for (const glob of globs) {
    if (glob.startsWith("*.")) {
      // Extension glob: check if any file ends with the extension
      const ext = glob.slice(1); // e.g. ".ts"
      for (const file of filesSet) {
        if (file.endsWith(ext)) return true;
      }
    } else {
      // Exact file name
      if (filesSet.has(glob)) return true;
    }
  }
  return false;
}

// ─── Binary probe ─────────────────────────────────────────────────────────────

/**
 * Checks whether a binary is available on $PATH using `which` (macOS/Linux)
 * or `where` (Windows). Returns true if found.
 */
export function probeInstalled(serverName: string): boolean {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(cmd, [serverName], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}
