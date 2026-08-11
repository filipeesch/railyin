import { getGlobalConfigDir, invalidateConfigCache, loadEnginesConfig } from "../config/index.ts";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import * as jsYaml from "js-yaml";

export function configHandlers() {
  return {
    "config.getEnginesYaml": (_: unknown) => {
      const file = join(getGlobalConfigDir(), "engines.yaml");
      const yaml = readFileSync(file, "utf-8");
      return { yaml };
    },

    "config.saveEnginesYaml": ({ yaml }: { yaml: string }) => {
      jsYaml.load(yaml);
      const file = join(getGlobalConfigDir(), "engines.yaml");
      writeFileSync(file, yaml, "utf-8");
      invalidateConfigCache();
      return { ok: true as const };
    },

    // Structured engine list (parsed from engines.yaml)
    "engines.list": (_: unknown) => {
      const configDir = getGlobalConfigDir();
      const entries = loadEnginesConfig(configDir);
      if (!entries || entries.length === 0) return [];
      return entries.map((entry) => {
        // Reconstruct YAML block from the parsed entry
        return {
          id: entry.id,
          name: entry.id,
          type: entry.config.type,
          yaml: jsYaml.dump({ id: entry.id, ...entry.config }) as string,
        };
      });
    },

    // Import engines from uploaded YAML content
    "engines.importYaml": ({ content }: { content: string }) => {
      const configDir = getGlobalConfigDir();
      // Validate the uploaded YAML
      const parsed = jsYaml.load(content) as { engines?: unknown[] } | undefined;
      if (!parsed?.engines || !Array.isArray(parsed.engines)) {
        throw new Error("Invalid engines.yaml format");
      }

      // Parse existing engines.yaml
      const existingContent = readFileSync(join(configDir, "engines.yaml"), "utf-8");
      const existingDoc = jsYaml.load(existingContent) as { engines?: Record<string, unknown>[] } | undefined;
      const rawExisting = existingDoc?.engines ?? [];
      const existingEngines = rawExisting as Record<string, unknown>[];

      // Build existing ID map
      const existingIds = new Set(existingEngines.map((e) => (e as Record<string, unknown>).id as string));

      // Parse new engines
      const rawNew = parsed.engines ?? [];
      const newEngines = rawNew as Record<string, unknown>[];
      const conflicts: string[] = [];

      for (const engine of newEngines) {
        const id = (engine as Record<string, unknown>).id as string;
        if (existingIds.has(id)) {
          conflicts.push(id);
        }
      }

      // Merge: replace existing + add new
      const merged: Record<string, unknown>[] = [];
      const idMap = new Map<string, Record<string, unknown>>();

      // Add existing engines
      for (const e of existingEngines) {
        const id = (e as Record<string, unknown>).id as string;
        idMap.set(id, { ...e });
      }

      // Add/replace with new engines
      for (const e of newEngines) {
        const id = (e as Record<string, unknown>).id as string;
        idMap.set(id, { ...e });
      }

      // Preserve original order (existing first, then new)
      for (const e of existingEngines) {
        const id = (e as Record<string, unknown>).id as string;
        merged.push(idMap.get(id)!);
      }

      // Add engines not in existing
      for (const e of newEngines) {
        const id = (e as Record<string, unknown>).id as string;
        if (!existingIds.has(id)) {
          merged.push(idMap.get(id)!);
        }
      }

      // Write merged YAML
      const mergedContent = jsYaml.dump({ engines: merged });
      writeFileSync(join(configDir, "engines.yaml"), mergedContent, "utf-8");
      invalidateConfigCache();

      return { ok: true as const, conflicts };
    },
  };
}
