import { existsSync, readFileSync } from "fs";
import type { McpConfig, McpServerConfig } from "./types.ts";

export function normalizeToMcpConfig(parsed: unknown): McpConfig {
  const p = parsed as Record<string, unknown>;
  if (!p || typeof p !== "object" || !p.servers) return { servers: [] };
  if (Array.isArray(p.servers)) return { servers: p.servers as McpServerConfig[] };
  // VS Code object-map format
  const servers: McpServerConfig[] = Object.entries(p.servers as Record<string, unknown>).map(
    ([name, entry]) => {
      const e = entry as Record<string, unknown>;
      const transport = e.url
        ? { type: "http" as const, url: e.url as string, headers: e.headers as Record<string, string> | undefined }
        : { type: "stdio" as const, command: e.command as string, args: e.args as string[] | undefined, env: e.env as Record<string, string> | undefined };
      return { name, transport };
    }
  );
  return { servers };
}

export function loadMcpConfigFile(filePath: string): McpConfig {
  if (!existsSync(filePath)) return { servers: [] };
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return normalizeToMcpConfig(parsed);
}
