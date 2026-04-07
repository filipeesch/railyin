import { readFileSync, writeFileSync, existsSync } from "fs";
import yaml from "js-yaml";
import type { LanguageEntry } from "./registry.ts";

// ─── workspace.yaml lsp.servers writer ───────────────────────────────────────

interface LspServerEntry {
  name: string;
  command: string;
  args: string[];
  extensions: string[];
}

/**
 * Reads workspace.yaml, merges the language server entry into `lsp.servers`
 * (deduplicating by `name`), and writes it back.
 *
 * If `lsp` or `lsp.servers` keys don't exist they are created.
 * Uses `js-yaml` to preserve existing structure (lineWidth: -1 avoids unwanted line wrapping).
 */
export function addServerToConfig(workspaceYamlPath: string, entry: LanguageEntry): void {
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

  const newServer: LspServerEntry = {
    name: entry.serverName,
    command: entry.serverName,
    args: ["--stdio"],
    extensions: entry.extensions,
  };

  // Deduplicate by name
  const existing = doc.lsp.servers as LspServerEntry[];
  const alreadyPresent = existing.some((s) => s.name === newServer.name);
  if (alreadyPresent) return;

  doc.lsp.servers.push(newServer);

  const dumped = yaml.dump(doc, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  writeFileSync(workspaceYamlPath, dumped, "utf-8");
}
