// ─── OAuth-related typed errors ────────────────────────────────────────────────

/**
 * Thrown when an MCP server requires (re-)authorization before a request can
 * proceed — either because no token exists yet, or because lazy refresh
 * failed. Callers should surface this distinctly from generic connection
 * errors (e.g. prompt the user to sign in again) rather than treating it as
 * an opaque `error` state.
 */
export class McpAuthRequiredError extends Error {
  readonly serverName: string;

  constructor(serverName: string, message?: string) {
    super(message ?? `MCP server "${serverName}" requires re-authentication`);
    this.name = "McpAuthRequiredError";
    this.serverName = serverName;
  }
}

/**
 * Thrown internally by `HttpMcpClient` when an HTTP MCP server responds
 * `401 Unauthorized` with a `WWW-Authenticate` header, signaling that OAuth
 * discovery should be attempted. Distinguishable from a generic HTTP error
 * so `McpClientRegistry` can react by triggering discovery instead of
 * transitioning the server to `error`.
 */
export class McpOAuthChallengeError extends Error {
  readonly wwwAuthenticate: string;

  constructor(wwwAuthenticate: string) {
    super(`MCP server requires OAuth authorization (401 + WWW-Authenticate)`);
    this.name = "McpOAuthChallengeError";
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

/**
 * Thrown when OAuth discovery (Protected Resource Metadata, Authorization
 * Server Metadata, or Dynamic Client Registration) fails. Carries a
 * human-readable reason so the registry can record it as the server's
 * `auth_required` error message.
 */
export class OAuthDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthDiscoveryError";
  }
}
