// ─── OAuth discovery: RFC9728 → RFC8414 → RFC7591 ──────────────────────────────
//
// Given a 401 response's `WWW-Authenticate` header, discovers the Protected
// Resource Metadata, the Authorization Server Metadata for its issuer, and
// (if no cached registration exists) performs Dynamic Client Registration.
//
// All three steps throw `OAuthDiscoveryError` with a human-readable reason on
// any failure — callers (the registry) are expected to catch this and
// transition the server to `auth_required` rather than crash.

import { OAuthDiscoveryError } from "./errors.ts";
import type { AuthorizationServerMetadata, DcrClientRegistration, ProtectedResourceMetadata } from "./types.ts";

/**
 * Extracts the `resource_metadata` URL from a `WWW-Authenticate` header, e.g.:
 *   Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"
 */
export function parseResourceMetadataUrl(wwwAuthenticate: string): string {
  const match = wwwAuthenticate.match(/resource_metadata="([^"]+)"/);
  if (!match) {
    throw new OAuthDiscoveryError(
      `WWW-Authenticate header does not advertise a resource_metadata URL: ${wwwAuthenticate}`,
    );
  }
  return match[1];
}

async function fetchJson(url: string, context: string): Promise<Record<string, unknown>> {
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new OAuthDiscoveryError(`Failed to fetch ${context} from ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!resp.ok) {
    throw new OAuthDiscoveryError(`Failed to fetch ${context} from ${url}: HTTP ${resp.status}`);
  }
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthDiscoveryError(`${context} at ${url} did not return valid JSON`);
  }
}

/** RFC9728: fetches and validates the Protected Resource Metadata document. */
export async function discoverProtectedResourceMetadata(resourceMetadataUrl: string): Promise<ProtectedResourceMetadata> {
  const json = await fetchJson(resourceMetadataUrl, "Protected Resource Metadata");
  const authServers = json.authorization_servers;
  if (!Array.isArray(authServers) || authServers.length === 0) {
    throw new OAuthDiscoveryError(
      `Protected Resource Metadata at ${resourceMetadataUrl} does not advertise any authorization_servers`,
    );
  }
  return json as unknown as ProtectedResourceMetadata;
}

/**
 * Builds the ordered list of well-known metadata URLs to try for an issuer,
 * mirroring the official MCP SDK's `buildDiscoveryUrls` fallback chain. Not
 * every authorization server implements RFC8414's `oauth-authorization-server`
 * well-known endpoint — many real-world identity providers (e.g. Keycloak)
 * only expose OpenID Connect Discovery 1.0's `openid-configuration` instead,
 * and some do so at the origin root with the tenant/realm path *appended
 * after* the well-known segment rather than inserted before it.
 *
 * Per RFC8414 §3.1 / OIDC Discovery 1.0, a path-component issuer (e.g. a
 * multi-tenant `https://auth.example.com/tenant1` or a Keycloak realm
 * `https://auth.example.com/realms/prod`) is tried in this order:
 *   1. `https://auth.example.com/.well-known/oauth-authorization-server/tenant1` (RFC8414-style)
 *   2. `https://auth.example.com/.well-known/openid-configuration/tenant1` (OIDC, RFC8414-style path insertion)
 *   3. `https://auth.example.com/tenant1/.well-known/openid-configuration` (OIDC Discovery 1.0, path appended)
 * A root-path issuer only tries (1) then (2) at the origin root.
 */
function buildAuthServerMetadataUrls(issuer: string): string[] {
  const issuerUrl = new URL(issuer);
  const hasPath = issuerUrl.pathname !== "/";
  if (!hasPath) {
    return [
      `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
      `${issuerUrl.origin}/.well-known/openid-configuration`,
    ];
  }
  const path = issuerUrl.pathname.replace(/\/+$/, "");
  return [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuerUrl.origin}/.well-known/openid-configuration${path}`,
    `${issuerUrl.origin}${path}/.well-known/openid-configuration`,
  ];
}

/**
 * RFC8414 / OpenID Connect Discovery 1.0: fetches and validates the
 * Authorization Server Metadata for a given issuer, trying each well-known
 * URL candidate in turn (see `buildAuthServerMetadataUrls`) and only failing
 * once every candidate has come back 404/unreachable.
 */
export async function discoverAuthorizationServerMetadata(issuer: string): Promise<AuthorizationServerMetadata> {
  const candidates = buildAuthServerMetadataUrls(issuer);
  const attemptErrors: string[] = [];

  for (const wellKnownUrl of candidates) {
    let json: Record<string, unknown>;
    try {
      json = await fetchJson(wellKnownUrl, "Authorization Server Metadata");
    } catch (err) {
      attemptErrors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    if (typeof json.authorization_endpoint !== "string" || typeof json.token_endpoint !== "string") {
      attemptErrors.push(`${wellKnownUrl} is missing authorization_endpoint or token_endpoint`);
      continue;
    }
    return json as unknown as AuthorizationServerMetadata;
  }

  throw new OAuthDiscoveryError(
    `Authorization Server Metadata for issuer ${issuer} could not be discovered at any well-known endpoint (tried ${candidates.length}): ${attemptErrors.join("; ")}`,
  );
}

/** RFC7591: registers a public (PKCE) client with the authorization server. */
export async function registerDynamicClient(
  registrationEndpoint: string,
  issuer: string,
  redirectUri: string,
  clientName: string,
): Promise<DcrClientRegistration> {
  let resp: Response;
  try {
    resp = await fetch(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
  } catch (err) {
    throw new OAuthDiscoveryError(
      `Dynamic Client Registration request to ${registrationEndpoint} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!resp.ok) {
    throw new OAuthDiscoveryError(`Dynamic Client Registration was rejected by ${registrationEndpoint}: HTTP ${resp.status}`);
  }
  let json: Record<string, unknown>;
  try {
    json = (await resp.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthDiscoveryError(`Dynamic Client Registration response from ${registrationEndpoint} was not valid JSON`);
  }
  if (typeof json.client_id !== "string") {
    throw new OAuthDiscoveryError(`Dynamic Client Registration response from ${registrationEndpoint} did not include a client_id`);
  }
  return {
    client_id: json.client_id,
    client_secret: typeof json.client_secret === "string" ? json.client_secret : undefined,
    issuer,
    redirectUri,
  };
}
