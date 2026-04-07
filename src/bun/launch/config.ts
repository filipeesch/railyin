import { existsSync, readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import type { LaunchConfig, LaunchEntry } from "../../shared/rpc-types.ts";

interface RawEntry {
  label?: unknown;
  icon?: unknown;
  command?: unknown;
}

function parseEntries(raw: unknown, section: string): LaunchEntry[] {
  if (!Array.isArray(raw)) return [];
  const results: LaunchEntry[] = [];
  for (const item of raw) {
    const entry = item as RawEntry;
    if (typeof entry.icon !== "string" || typeof entry.command !== "string") {
      console.warn(`[launch] Skipping invalid ${section} entry (missing icon/command):`, item);
      continue;
    }
    results.push({
      label: typeof entry.label === "string" ? entry.label : undefined,
      icon: entry.icon,
      command: entry.command,
    });
  }
  return results;
}

/** Read and parse railyin.yaml from the given project path. Returns null if absent or has no run section. */
export function readLaunchConfig(projectPath: string): LaunchConfig | null {
  const configPath = join(projectPath, "railyin.yaml");
  if (!existsSync(configPath)) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.warn("[launch] Failed to parse railyin.yaml:", err);
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const root = parsed as Record<string, unknown>;
  const run = root["run"];
  if (typeof run !== "object" || run === null) return null;

  const runSection = run as Record<string, unknown>;
  const profiles = parseEntries(runSection["profiles"], "profiles");
  const tools = parseEntries(runSection["tools"], "tools");

  if (profiles.length === 0 && tools.length === 0) return null;

  return { profiles, tools };
}
