import { existsSync, readFileSync } from "fs";
import type { McpConfig, McpServerConfig, McpOAuthStaticClientConfig } from "./types.ts";

/**
 * Accepts common real-world casings for the static OAuth client override
 * (`client_id`/`CLIENT_ID`/`clientId`, `client_secret`/`CLIENT_SECRET`/`clientSecret`).
 * Hand-edited `mcp.json` is exactly where a user is likely to type `CLIENT_ID`
 * (as an env-var-style constant) instead of the JSON-conventional `client_id` —
 * silently dropping that value would leave OAuth Dynamic Client Registration
 * to run (and potentially be rejected) instead of using the intended override.
 */
function normalizeAuthConfig(raw: unknown): McpOAuthStaticClientConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const clientId = a.client_id ?? a.CLIENT_ID ?? a.clientId;
  const clientSecret = a.client_secret ?? a.CLIENT_SECRET ?? a.clientSecret;
  if (typeof clientId !== "string" || clientId.length === 0) return undefined;
  return {
    client_id: clientId,
    ...(typeof clientSecret === "string" && clientSecret.length > 0 ? { client_secret: clientSecret } : {}),
  };
}

export function normalizeToMcpConfig(parsed: unknown): McpConfig {
  const p = parsed as Record<string, unknown>;
  if (!p || typeof p !== "object" || !p.servers) return { servers: [] };
  if (Array.isArray(p.servers)) return { servers: p.servers as McpServerConfig[] };
  // VS Code object-map format
  const servers: McpServerConfig[] = Object.entries(p.servers as Record<string, unknown>).map(
    ([name, entry]) => {
      const e = entry as Record<string, unknown>;
      const transport = e.url
        ? {
            type: "http" as const,
            url: e.url as string,
            headers: e.headers as Record<string, string> | undefined,
            auth: normalizeAuthConfig(e.auth),
          }
        : { type: "stdio" as const, command: e.command as string, args: e.args as string[] | undefined, env: e.env as Record<string, string> | undefined };
      return {
        name,
        transport,
        ...(typeof e.description === "string" ? { description: e.description } : {}),
        ...(typeof e.enabled === "boolean" ? { enabled: e.enabled } : {}),
      };
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
