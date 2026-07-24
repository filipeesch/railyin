// ─── OAuth 2.1 / MCP Authorization types ───────────────────────────────────────
//
// Shapes for RFC9728 (Protected Resource Metadata), RFC8414 (Authorization
// Server Metadata), RFC7591 (Dynamic Client Registration), and the resulting
// token/pending-flow bookkeeping used by the registry's OAuth collaborators.

/** OAuth 2.0 Protected Resource Metadata (RFC9728), as referenced by a 401's WWW-Authenticate header. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  [key: string]: unknown;
}

/** OAuth 2.0 Authorization Server Metadata (RFC8414). */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  [key: string]: unknown;
}

/** Result of Dynamic Client Registration (RFC7591), cached per authorization-server issuer. */
export interface DcrClientRegistration {
  client_id: string;
  client_secret?: string;
  issuer: string;
}

/** Access/refresh token pair persisted per MCP server name. */
export interface OAuthTokenSet {
  access_token: string;
  refresh_token?: string;
  /** Absolute epoch-ms expiry of the access token. */
  expires_at?: number;
  token_type?: string;
  scope?: string;
  /** Authorization server issuer URL this token was obtained from — needed to refresh after a process restart without re-running discovery. */
  issuer: string;
  /** Token endpoint for refresh requests, cached alongside the token (denormalized on purpose: tokens are never shared across servers, so duplicating this is harmless). */
  token_endpoint: string;
  client_id: string;
  client_secret?: string;
}

/** In-flight Authorization Code + PKCE flow, keyed by the CSRF `state` value. */
export interface PendingAuthFlow {
  serverName: string;
  codeVerifier: string;
  authServerMetadata: AuthorizationServerMetadata;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scope?: string;
  createdAt: number;
}

/** On-disk shape of a scope's `mcp-tokens.json` file. */
export interface McpTokensFile {
  /** Access/refresh tokens, keyed by MCP server name. */
  tokens: Record<string, OAuthTokenSet>;
  /** Cached DCR client registrations, keyed by authorization server issuer URL. */
  dcrClients: Record<string, DcrClientRegistration>;
}

/** Collaborator injected into `HttpMcpClient` to attach a live bearer token. */
export interface TokenProvider {
  getAuthHeader(): Promise<Record<string, string>>;
}

/** Collaborator that launches a URL in the user's system default browser. */
export interface BrowserOpener {
  open(url: string): Promise<void>;
}
