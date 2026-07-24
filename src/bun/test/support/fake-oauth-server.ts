// ─── Shared fake OAuth 2.1 authorization + protected-resource server ──────────
//
// A single local `Bun.serve()` instance that plays both the "protected
// resource" (the MCP server) and its authorization server, following the
// `providers.test.ts` precedent of exercising real HTTP wire formats against
// a local server instead of a mocking framework.
//
// Exposes:
//   GET  /.well-known/oauth-protected-resource   (RFC9728)
//   GET  /.well-known/oauth-authorization-server (RFC8414)
//   POST /register                                (RFC7591 DCR)
//   GET  /authorize                                (issues a code, redirects to redirect_uri)
//   POST /token                                     (authorization_code + refresh_token grants)
//   POST /mcp                                       (the "protected resource" — the MCP JSON-RPC endpoint)
//
// All behaviors are overridable via `FakeOAuthServerOptions` so tests can
// simulate discovery/DCR/token/refresh failures without a mocking framework.

type FakeServer = ReturnType<typeof Bun.serve>;

export interface FakeOAuthServerOptions {
  /** Whether GET /.well-known/oauth-protected-resource is served at all. Default true. */
  serveProtectedResourceMetadata?: boolean;
  /** Replaces the Protected Resource Metadata JSON body wholesale (for malformed/missing-field simulation). */
  protectedResourceMetadataBody?: unknown;
  /** Whether GET /.well-known/oauth-authorization-server is served at all. Default true. */
  serveAuthServerMetadata?: boolean;
  /** Replaces the Authorization Server Metadata JSON body wholesale. */
  authServerMetadataBody?: unknown;
  /** If false, no `registration_endpoint` is advertised and POST /register 404s (server that doesn't support DCR). Default true. */
  supportsDcr?: boolean;
  /** HTTP status POST /register responds with. Default 201. */
  dcrStatus?: number;
  /** HTTP status the token endpoint responds with for every request. Default 200. */
  tokenEndpointStatus?: number;
  /** Called for each /token request; return a partial override merged onto the default success body. */
  onTokenRequest?: (params: URLSearchParams) => Record<string, unknown> | undefined;
  /** Access token TTL in seconds for issued tokens. Default 3600. */
  accessTokenTtlSeconds?: number;
  /** If false, the /mcp protected-resource endpoint accepts any (or no) bearer token. Default true. */
  requireValidToken?: boolean;
  /**
   * Simulates a multi-tenant issuer with a path component (e.g. Atlassian's
   * `https://auth.example.com/<tenant-id>`). When set, the authorization
   * server's well-known metadata is only served at the RFC8414-correct
   * `/.well-known/oauth-authorization-server<issuerPath>` location (not at
   * the origin root), so tests can catch well-known URL construction bugs.
   */
  issuerPath?: string;
}

export interface FakeOAuthServerHandle {
  server: FakeServer;
  /** Base origin, e.g. `http://localhost:54321`. */
  url: string;
  /** Access tokens currently considered valid by the protected resource endpoint. */
  issuedAccessTokens: Set<string>;
  /** Refresh tokens currently considered valid, mapped to the access token they'll mint next. */
  issuedRefreshTokens: Map<string, string>;
  /** DCR registrations by client_id, so tests can assert only one registration happened per issuer. */
  registeredClients: Map<string, { client_id: string; client_secret?: string }>;
  /** Number of times POST /register was called — for asserting DCR-caching behavior. */
  dcrCallCount: number;
  /** Number of times POST /token was called with grant_type=refresh_token. */
  refreshCallCount: number;
  /** Revokes an access token, e.g. to simulate a token becoming invalid server-side. */
  revokeAccessToken(token: string): void;
  /** Revokes a refresh token, so the next refresh attempt fails. */
  revokeRefreshToken(token: string): void;
  stop(): void;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
}

export function createFakeOAuthServer(options: FakeOAuthServerOptions = {}): FakeOAuthServerHandle {
  const issuedAccessTokens = new Set<string>();
  const issuedRefreshTokens = new Map<string, string>();
  const registeredClients = new Map<string, { client_id: string; client_secret?: string }>();
  const pendingCodes = new Map<string, PendingCode>();
  let dcrCallCount = 0;
  let refreshCallCount = 0;
  let tokenCounter = 0;

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const base = `http://${req.headers.get("host") ?? "localhost"}`;

      if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
        if (options.serveProtectedResourceMetadata === false) {
          return new Response("Not found", { status: 404 });
        }
        const body = options.protectedResourceMetadataBody ?? {
          resource: `${base}/mcp`,
          authorization_servers: [options.issuerPath ? `${base}${options.issuerPath}` : base],
        };
        return jsonResponse(body);
      }

      const expectedWellKnownPath = options.issuerPath
        ? `/.well-known/oauth-authorization-server${options.issuerPath}`
        : "/.well-known/oauth-authorization-server";
      if (req.method === "GET" && url.pathname === expectedWellKnownPath) {
        if (options.serveAuthServerMetadata === false) {
          return new Response("Not found", { status: 404 });
        }
        const body = options.authServerMetadataBody ?? {
          issuer: options.issuerPath ? `${base}${options.issuerPath}` : base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          ...(options.supportsDcr === false ? {} : { registration_endpoint: `${base}/register` }),
          code_challenge_methods_supported: ["S256"],
        };
        return jsonResponse(body);
      }

      if (req.method === "POST" && url.pathname === "/register") {
        dcrCallCount++;
        if (options.supportsDcr === false) return new Response("Not found", { status: 404 });
        const status = options.dcrStatus ?? 201;
        if (status >= 400) return new Response(JSON.stringify({ error: "registration_failed" }), { status, headers: { "content-type": "application/json" } });
        const clientId = `client-${++tokenCounter}`;
        registeredClients.set(clientId, { client_id: clientId });
        return jsonResponse({ client_id: clientId }, status);
      }

      if (req.method === "GET" && url.pathname === "/authorize") {
        const clientId = url.searchParams.get("client_id") ?? "";
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const codeChallenge = url.searchParams.get("code_challenge") ?? undefined;
        const code = `code-${++tokenCounter}`;
        pendingCodes.set(code, { clientId, redirectUri, codeChallenge });
        const redirect = new URL(redirectUri);
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", state);
        return new Response(null, { status: 302, headers: { Location: redirect.toString() } });
      }

      if (req.method === "POST" && url.pathname === "/token") {
        return handleToken(req);
      }

      if (url.pathname === "/mcp") {
        return handleMcp(req);
      }

      return new Response("Not found", { status: 404 });
    },
  });

  async function handleToken(req: Request): Promise<Response> {
    const params = new URLSearchParams(await req.text());
    const grantType = params.get("grant_type");
    const status = options.tokenEndpointStatus ?? 200;
    if (status >= 400) {
      return jsonResponse({ error: "invalid_grant" }, status);
    }

    if (grantType === "authorization_code") {
      const code = params.get("code") ?? "";
      const pending = pendingCodes.get(code);
      if (!pending) return jsonResponse({ error: "invalid_grant" }, 400);
      pendingCodes.delete(code);
      return jsonResponse(issueTokenResponse(params));
    }

    if (grantType === "refresh_token") {
      refreshCallCount++;
      const refreshToken = params.get("refresh_token") ?? "";
      if (!issuedRefreshTokens.has(refreshToken)) {
        return jsonResponse({ error: "invalid_grant" }, 400);
      }
      issuedRefreshTokens.delete(refreshToken);
      return jsonResponse(issueTokenResponse(params));
    }

    return jsonResponse({ error: "unsupported_grant_type" }, 400);
  }

  function issueTokenResponse(params: URLSearchParams): Record<string, unknown> {
    const accessToken = `access-${++tokenCounter}`;
    const refreshToken = `refresh-${++tokenCounter}`;
    issuedAccessTokens.add(accessToken);
    issuedRefreshTokens.set(refreshToken, accessToken);
    const defaults = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: options.accessTokenTtlSeconds ?? 3600,
      token_type: "Bearer",
    };
    return { ...defaults, ...(options.onTokenRequest?.(params) ?? {}) };
  }

  async function handleMcp(req: Request): Promise<Response> {
    if (options.requireValidToken !== false) {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (!token || !issuedAccessTokens.has(token)) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer resource_metadata="http://${req.headers.get("host")}/.well-known/oauth-protected-resource"` },
        });
      }
    }
    const body = (await req.json().catch(() => ({}))) as { id?: number; method?: string };
    if (body.method === "tools/list") {
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "echo", description: "Echoes input", inputSchema: { type: "object" } }] } });
    }
    if (body.method === "tools/call") {
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } });
    }
    // initialize / initialized / anything else — acknowledge generically
    return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  return {
    server,
    url: `http://localhost:${server.port}`,
    issuedAccessTokens,
    issuedRefreshTokens,
    registeredClients,
    get dcrCallCount() { return dcrCallCount; },
    get refreshCallCount() { return refreshCallCount; },
    revokeAccessToken(token: string) { issuedAccessTokens.delete(token); },
    revokeRefreshToken(token: string) { issuedRefreshTokens.delete(token); },
    stop() { server.stop(true); },
  } as FakeOAuthServerHandle;
}
