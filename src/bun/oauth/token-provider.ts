// ─── Lazy-refreshing TokenProvider for OAuth-protected MCP servers ─────────────
//
// Implements the `TokenProvider` interface consumed by `HttpMcpClient`.
// Checks the stored access token's expiry before each call and transparently
// refreshes it via the stored refresh token when needed. On refresh failure,
// clears the server's cached tokens and throws `McpAuthRequiredError` so the
// registry can drop the server back to `auth_required`.

import { McpAuthRequiredError } from "./errors.ts";
import { clearServerTokens, getServerTokens, setServerTokens } from "./token-store.ts";
import type { OAuthTokenSet, TokenProvider } from "./types.ts";

/** Access tokens are refreshed this many ms before their actual expiry to avoid racing a request. */
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

export class OAuthTokenProvider implements TokenProvider {
  constructor(
    private readonly serverName: string,
    private readonly tokensFilePath: string,
  ) {}

  async getAuthHeader(): Promise<Record<string, string>> {
    let tokens = getServerTokens(this.tokensFilePath, this.serverName);
    if (!tokens) {
      throw new McpAuthRequiredError(this.serverName, `MCP server "${this.serverName}" has no stored OAuth tokens`);
    }

    if (this._isExpired(tokens)) {
      tokens = await this._refresh(tokens);
    }

    return { Authorization: `${tokens.token_type ?? "Bearer"} ${tokens.access_token}` };
  }

  private _isExpired(tokens: OAuthTokenSet): boolean {
    return tokens.expires_at !== undefined && Date.now() >= tokens.expires_at - EXPIRY_SAFETY_MARGIN_MS;
  }

  private async _refresh(tokens: OAuthTokenSet): Promise<OAuthTokenSet> {
    if (!tokens.refresh_token) {
      clearServerTokens(this.tokensFilePath, this.serverName);
      throw new McpAuthRequiredError(this.serverName, `MCP server "${this.serverName}" access token expired and no refresh token is available`);
    }

    let resp: Response;
    try {
      resp = await fetch(tokens.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: tokens.client_id,
          ...(tokens.client_secret ? { client_secret: tokens.client_secret } : {}),
        }).toString(),
      });
    } catch {
      clearServerTokens(this.tokensFilePath, this.serverName);
      throw new McpAuthRequiredError(this.serverName);
    }

    if (!resp.ok) {
      clearServerTokens(this.tokensFilePath, this.serverName);
      throw new McpAuthRequiredError(this.serverName);
    }

    const json = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    if (typeof json.access_token !== "string") {
      clearServerTokens(this.tokensFilePath, this.serverName);
      throw new McpAuthRequiredError(this.serverName, `MCP server "${this.serverName}" refresh response did not include an access_token`);
    }

    const refreshed: OAuthTokenSet = {
      ...tokens,
      access_token: json.access_token,
      // Some authorization servers do not rotate the refresh token on every
      // refresh — retain the existing one when the response omits a new one.
      refresh_token: json.refresh_token ?? tokens.refresh_token,
      expires_at: typeof json.expires_in === "number" ? Date.now() + json.expires_in * 1000 : undefined,
      token_type: json.token_type ?? tokens.token_type,
      scope: json.scope ?? tokens.scope,
    };
    setServerTokens(this.tokensFilePath, this.serverName, refreshed);
    return refreshed;
  }
}
