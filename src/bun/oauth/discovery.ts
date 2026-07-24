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

/** RFC8414: fetches and validates the Authorization Server Metadata for a given issuer. */
export async function discoverAuthorizationServerMetadata(issuer: string): Promise<AuthorizationServerMetadata> {
  const wellKnownUrl = new URL("/.well-known/oauth-authorization-server", issuer).toString();
  const json = await fetchJson(wellKnownUrl, "Authorization Server Metadata");
  if (typeof json.authorization_endpoint !== "string" || typeof json.token_endpoint !== "string") {
    throw new OAuthDiscoveryError(
      `Authorization Server Metadata for issuer ${issuer} is missing authorization_endpoint or token_endpoint`,
    );
  }
  return json as unknown as AuthorizationServerMetadata;
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
  };
}
