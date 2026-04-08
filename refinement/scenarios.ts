/**
 * refinement/scenarios.ts
 *
 * YAML scenario parser and loader. Scenarios live in refinement/scenarios/.
 */

import { readFileSync, readdirSync } from "fs";
import { join, basename, extname } from "path";
import yaml from "js-yaml";
import type { Scenario, ProxyMode } from "./types.ts";

const SCENARIOS_DIR = join(import.meta.dir, "scenarios");

const KNOWN_TOOL_GROUPS = new Set([
  "read", "write", "search", "web", "shell", "interactions", "agents", "lsp",
  // tasks_read group
  "tasks_read",
]);

function validate(raw: unknown, filePath: string): Scenario {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Scenario ${filePath}: must be a YAML object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r["name"] !== "string" || !r["name"]) {
    throw new Error(`Scenario ${filePath}: missing required field 'name'`);
  }
  if (typeof r["description"] !== "string" || !r["description"]) {
    throw new Error(`Scenario ${filePath}: missing required field 'description'`);
  }
  if (!Array.isArray(r["assertions"])) {
    throw new Error(`Scenario ${filePath}: missing required field 'assertions' (must be an array)`);
  }
  // Validate codebase + fixtures mutual exclusion
  if (r["codebase"] !== undefined && r["fixtures"] !== undefined) {
    throw new Error(`Scenario ${filePath}: cannot have both 'codebase' and 'fixtures' fields`);
  }
  if (r["codebase"] !== undefined && r["codebase"] !== "railyin") {
    throw new Error(`Scenario ${filePath}: 'codebase' must be "railyin" if set`);
  }
  // Warn about cache assertions on real-codebase scenarios
  if (r["codebase"] === "railyin" && Array.isArray(r["assertions"])) {
    for (const assertion of r["assertions"] as Array<{ type?: string }>) {
      if (assertion.type === "cache_prefix_stable" || assertion.type === "tools_hash_stable") {
        console.warn(`[scenarios] '${r["name"]}': ${assertion.type} assertion is not meaningful for real-codebase scenarios`);
      }
    }
  }
  if (r["column_tools"] !== undefined) {
    if (!Array.isArray(r["column_tools"])) {
      throw new Error(`Scenario ${filePath}: 'column_tools' must be an array`);
    }
    for (const t of r["column_tools"] as unknown[]) {
      if (typeof t !== "string") {
        throw new Error(`Scenario ${filePath}: 'column_tools' entries must be strings`);
      }
      // Warn for unknown group names (individual tool names are also valid)
      if (!KNOWN_TOOL_GROUPS.has(t) && !/^[a-z_]+$/.test(t)) {
        console.warn(`[scenarios] '${t}' in column_tools is not a known group name`);
      }
    }
  }
  return r as unknown as Scenario;
}

export function loadScenario(filePath: string): Scenario {
  const content = readFileSync(filePath, "utf-8");
  const raw = yaml.load(content);
  return validate(raw, filePath);
}

export function loadAllScenarios(mode?: ProxyMode): Scenario[] {
  const files = readdirSync(SCENARIOS_DIR)
    .filter((f) => extname(f) === ".yaml" || extname(f) === ".yml")
    .map((f) => join(SCENARIOS_DIR, f));

  const scenarios: Scenario[] = [];
  for (const f of files) {
    try {
      const scenario = loadScenario(f);
      scenarios.push(scenario);
    } catch (e) {
      console.error(`[runner] failed to load ${basename(f)}: ${(e as Error).message}`);
    }
  }
  return scenarios;
}

export function loadNamedScenario(name: string): Scenario {
  const candidates = [
    join(SCENARIOS_DIR, `${name}.yaml`),
    join(SCENARIOS_DIR, `${name}.yml`),
  ];
  for (const candidate of candidates) {
    try {
      return loadScenario(candidate);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  throw new Error(`Scenario '${name}' not found in ${SCENARIOS_DIR}`);
}
