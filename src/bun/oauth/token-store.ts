// ─── OAuth token + DCR client registration persistence ─────────────────────────
//
// Mirrors `config-loader.ts`'s file-based, scope-mirrored approach for
// `mcp.json`: one `mcp-tokens.json` per scope (global `~/.railyn/` or
// per-project `<project>/.railyn/`), keyed by server name for tokens and by
// authorization-server issuer URL for cached DCR client registrations.
//
// All read-modify-write helpers are fully synchronous on purpose: Bun/Node is
// single-threaded, so a synchronous read→mutate→write with no `await` in
// between cannot be interleaved by a concurrent call from another in-flight
// async operation, which is what keeps concurrent writes for two different
// servers in the same scope from clobbering each other.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { DcrClientRegistration, McpTokensFile, OAuthTokenSet } from "./types.ts";

export function globalTokensPath(dataDir: string): string {
  return join(dataDir, "mcp-tokens.json");
}

export function projectTokensPath(projectPath: string): string {
  return join(projectPath, ".railyn", "mcp-tokens.json");
}

function emptyTokensFile(): McpTokensFile {
  return { tokens: {}, dcrClients: {} };
}

/** Reads a scope's `mcp-tokens.json`. Returns an empty structure if absent. Throws SyntaxError on malformed JSON, matching `config-loader.ts`'s handling of malformed `mcp.json`. */
export function readTokensFile(filePath: string): McpTokensFile {
  if (!existsSync(filePath)) return emptyTokensFile();
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<McpTokensFile>;
  return {
    tokens: parsed.tokens ?? {},
    dcrClients: parsed.dcrClients ?? {},
  };
}

function writeTokensFile(filePath: string, data: McpTokensFile): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function getServerTokens(filePath: string, serverName: string): OAuthTokenSet | undefined {
  return readTokensFile(filePath).tokens[serverName];
}

export function setServerTokens(filePath: string, serverName: string, tokenSet: OAuthTokenSet): void {
  const data = readTokensFile(filePath);
  data.tokens[serverName] = tokenSet;
  writeTokensFile(filePath, data);
}

export function clearServerTokens(filePath: string, serverName: string): void {
  const data = readTokensFile(filePath);
  if (!(serverName in data.tokens)) return;
  delete data.tokens[serverName];
  writeTokensFile(filePath, data);
}

export function getDcrClient(filePath: string, issuer: string): DcrClientRegistration | undefined {
  return readTokensFile(filePath).dcrClients[issuer];
}

export function setDcrClient(filePath: string, issuer: string, registration: DcrClientRegistration): void {
  const data = readTokensFile(filePath);
  data.dcrClients[issuer] = registration;
  writeTokensFile(filePath, data);
}
