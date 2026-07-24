// ─── OAuth `scope` request parameter resolution ────────────────────────────────
//
// The Authorization Code request (`/authorize`) MAY include a `scope`
// parameter (RFC6749 §3.3). Omitting it entirely leaves the choice to the
// authorization server, which for some real-world providers (Atlassian's
// Rovo MCP server included) results in a token that's missing scopes the
// protected resource actually requires — surfacing later as an opaque
// "scope does not match" error on the first authenticated tool call, rather
// than as a discovery-time failure.
//
// This module picks the scope to request, in priority order, mirroring the
// precedent set by `mcp-remote` (the reference client Atlassian's own docs
// point to for generic AI clients):
//   1. The `scope` attribute on the 401's `WWW-Authenticate` challenge, if the
//      resource itself told us exactly which scope(s) it needs.
//   2. RFC9728 Protected Resource Metadata's `scopes_supported` — the
//      resource-authoritative list of scopes it accepts.
//   3. RFC8414 Authorization Server Metadata's `scopes_supported` — a weaker
//      signal (what the *authorization server* supports generally), used only
//      if the resource itself didn't say.
// Returns `undefined` if none of these sources advertise anything, in which
// case the `scope` parameter is simply omitted, preserving today's behavior
// for servers that never advertise scopes at all.

import type { AuthorizationServerMetadata, ProtectedResourceMetadata } from "./types.ts";

/** Extracts the `scope="..."` attribute from a `WWW-Authenticate: Bearer ...` header, if present. */
export function parseWwwAuthenticateScope(wwwAuthenticate: string): string | undefined {
  const match = wwwAuthenticate.match(/scope="([^"]*)"/);
  return match && match[1].trim().length > 0 ? match[1] : undefined;
}

export function resolveAuthorizationScope(
  wwwAuthenticate: string,
  protectedResourceMetadata: ProtectedResourceMetadata,
  authServerMetadata: AuthorizationServerMetadata,
): string | undefined {
  const challengeScope = parseWwwAuthenticateScope(wwwAuthenticate);
  if (challengeScope) return challengeScope;

  const resourceScopes = protectedResourceMetadata.scopes_supported;
  if (Array.isArray(resourceScopes) && resourceScopes.length > 0) return resourceScopes.join(" ");

  const authServerScopes = authServerMetadata.scopes_supported;
  if (Array.isArray(authServerScopes) && authServerScopes.length > 0) return authServerScopes.join(" ");

  return undefined;
}
