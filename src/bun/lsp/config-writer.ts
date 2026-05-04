import { readFileSync, writeFileSync, existsSync } from "fs";
import yaml from "js-yaml";
import type { LanguageEntry } from "./registry.ts";

// ─── workspace.yaml lsp.servers writer ───────────────────────────────────────

interface LspServerEntry {
  name: string;
  command: string;
  args: string[];
  extensions: string[];
  projects?: string[];
}

/**
 * Reads workspace.yaml, merges the language server entry into `lsp.servers`
 * (deduplicating by `name`), and writes it back.
 *
 * If `lsp` or `lsp.servers` keys don't exist they are created.
 * Uses `js-yaml` to preserve existing structure (lineWidth: -1 avoids unwanted line wrapping).
 *
 * When `projectKey` is provided it is added to (or creates) the `projects` array on the entry,
 * scoping the server to that project. Existing project keys are preserved.
 */
export function addServerToConfig(workspaceYamlPath: string, entry: LanguageEntry, projectKey?: string): void {
  let raw = "";
  if (existsSync(workspaceYamlPath)) {
    raw = readFileSync(workspaceYamlPath, "utf-8");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any = {};
  try {
    doc = yaml.load(raw) ?? {};
  } catch {
    doc = {};
  }

  if (typeof doc !== "object" || doc === null) doc = {};

  // Ensure lsp.servers array exists
  if (!doc.lsp || typeof doc.lsp !== "object") {
    doc.lsp = {};
  }
  if (!Array.isArray(doc.lsp.servers)) {
    doc.lsp.servers = [];
  }

  const existing = doc.lsp.servers as LspServerEntry[];
  const existingEntry = existing.find((s) => s.name === entry.serverName);

  if (existingEntry) {
    // If already present and we have a projectKey, append it if not already there
    if (projectKey) {
      if (!Array.isArray(existingEntry.projects)) {
        existingEntry.projects = [projectKey];
      } else if (!existingEntry.projects.includes(projectKey)) {
        existingEntry.projects.push(projectKey);
      }
    }
  } else {
    const newServer: LspServerEntry = {
      name: entry.serverName,
      command: entry.serverName,
      args: ["--stdio"],
      extensions: entry.extensions,
    };
    if (projectKey) {
      newServer.projects = [projectKey];
    }
    doc.lsp.servers.push(newServer);
  }

  const dumped = yaml.dump(doc, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  writeFileSync(workspaceYamlPath, dumped, "utf-8");
}

/**
 * Returns true if the named language server already has an entry in
 * `workspace.yaml lsp.servers`. Does not modify the file.
 */
export function isServerInConfig(workspaceYamlPath: string, serverName: string): boolean {
  if (!existsSync(workspaceYamlPath)) return false;
  let doc: unknown;
  try {
    doc = yaml.load(readFileSync(workspaceYamlPath, "utf-8")) ?? {};
  } catch {
    return false;
  }
  if (typeof doc !== "object" || doc === null) return false;
  const servers = (doc as Record<string, unknown>)?.lsp;
  if (typeof servers !== "object" || servers === null) return false;
  const arr = (servers as Record<string, unknown>).servers;
  if (!Array.isArray(arr)) return false;
  return arr.some((s) => (s as { name: string }).name === serverName);
}
