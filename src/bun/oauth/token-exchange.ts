// ─── Authorization Code → token exchange ───────────────────────────────────────
//
// Completes an Authorization Code + PKCE flow by exchanging the code (and the
// original PKCE code verifier) for an access/refresh token pair. Kept
// separate from `token-provider.ts` (which owns ongoing *refresh*) and
// `discovery.ts` (which owns metadata/DCR discovery) — this module has the
// single responsibility of the one-time code-for-token exchange.

import { OAuthDiscoveryError } from "./errors.ts";
import type { PendingAuthFlow } from "./types.ts";

export interface TokenExchangeResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export async function exchangeAuthorizationCode(flow: PendingAuthFlow, code: string): Promise<TokenExchangeResponse> {
  let resp: Response;
  try {
    resp = await fetch(flow.authServerMetadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: flow.redirectUri,
        client_id: flow.clientId,
        code_verifier: flow.codeVerifier,
        ...(flow.clientSecret ? { client_secret: flow.clientSecret } : {}),
      }).toString(),
    });
  } catch (err) {
    throw new OAuthDiscoveryError(
      `Token exchange request to ${flow.authServerMetadata.token_endpoint} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!resp.ok) {
    throw new OAuthDiscoveryError(`Token exchange was rejected by ${flow.authServerMetadata.token_endpoint}: HTTP ${resp.status}`);
  }
  let json: Record<string, unknown>;
  try {
    json = (await resp.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthDiscoveryError(`Token exchange response from ${flow.authServerMetadata.token_endpoint} was not valid JSON`);
  }
  if (typeof json.access_token !== "string") {
    throw new OAuthDiscoveryError(`Token exchange response from ${flow.authServerMetadata.token_endpoint} did not include an access_token`);
  }
  return {
    access_token: json.access_token,
    refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expires_in: typeof json.expires_in === "number" ? json.expires_in : undefined,
    token_type: typeof json.token_type === "string" ? json.token_type : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
  };
}
