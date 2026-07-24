import type { McpConfig, McpServerConfig, McpToolDef, McpServerStatus, ServerState } from "./types.ts";
import { StdioMcpClient, HttpMcpClient, type McpClient } from "./client.ts";
import { getDataDir } from "../config/index.ts";
import { McpAuthRequiredError, McpOAuthChallengeError, OAuthDiscoveryError } from "../oauth/errors.ts";
import {
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  parseResourceMetadataUrl,
  registerDynamicClient,
} from "../oauth/discovery.ts";
import { exchangeAuthorizationCode } from "../oauth/token-exchange.ts";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "../oauth/pkce.ts";
import { PendingAuthFlowStore } from "../oauth/pending-flow-store.ts";
import { OAuthTokenProvider } from "../oauth/token-provider.ts";
import { getDcrClient, getServerTokens, globalTokensPath, setDcrClient, setServerTokens } from "../oauth/token-store.ts";
import { systemBrowserOpener } from "../utils/browser.ts";
import type { AuthorizationServerMetadata, BrowserOpener, OAuthTokenSet, TokenProvider } from "../oauth/types.ts";

/** Constructs the underlying transport for a server config. Injectable so tests can substitute a fake `McpClient` and drive the registry's state machine deterministically. */
export type McpClientFactory = (config: McpServerConfig, tokenProvider?: TokenProvider) => McpClient;

function defaultClientFactory(config: McpServerConfig, tokenProvider?: TokenProvider): McpClient {
  const { transport } = config;
  if (transport.type === "stdio") {
    return new StdioMcpClient(config.name, transport);
  } else if (transport.type === "http") {
    return new HttpMcpClient(config.name, transport, tokenProvider);
  }
  throw new Error(`Unsupported MCP transport type: ${(transport as { type: string }).type}`);
}

export interface McpClientRegistryOptions {
  /** Defaults to real `StdioMcpClient`/`HttpMcpClient` construction. */
  clientFactory?: McpClientFactory;
  /** Defaults to the real `open`-package-backed system browser launcher. */
  browserOpener?: BrowserOpener;
  /** Absolute path to this scope's `mcp-tokens.json`. Defaults to the global scope. */
  tokensFilePath?: string;
  /** Resolves the OAuth redirect URI at authorize()-time (the server's bound port is only known once it starts listening). */
  getRedirectUri?: () => string;
  pendingAuthFlowStore?: PendingAuthFlowStore;
}

/** Auth server metadata + registered client, cached on a server instance while it's `auth_required` so `authorize()` doesn't need to re-run discovery. */
interface AuthContext {
  authServerMetadata: AuthorizationServerMetadata;
  clientId: string;
  clientSecret?: string;
}

interface ServerInstance {
  config: McpServerConfig;
  client: McpClient | null;
  state: ServerState;
  tools: McpToolDef[];
  error?: string;
  authContext?: AuthContext;
}

export class McpClientRegistry {
  private servers = new Map<string, ServerInstance>();
  private config: McpConfig;
  private readonly clientFactory: McpClientFactory;
  private readonly browserOpener: BrowserOpener;
  private readonly tokensFilePath: string;
  private readonly getRedirectUri: () => string;
  private readonly pendingAuthFlowStore: PendingAuthFlowStore;

  constructor(config: McpConfig, options: McpClientRegistryOptions = {}) {
    this.config = config;
    this.clientFactory = options.clientFactory ?? defaultClientFactory;
    this.browserOpener = options.browserOpener ?? systemBrowserOpener;
    this.tokensFilePath = options.tokensFilePath ?? globalTokensPath(getDataDir());
    this.getRedirectUri = options.getRedirectUri ?? (() => "http://127.0.0.1/api/mcp/oauth/callback");
    this.pendingAuthFlowStore = options.pendingAuthFlowStore ?? new PendingAuthFlowStore();

    for (const serverConfig of config.servers) {
      if (serverConfig.enabled === false) {
        this.servers.set(serverConfig.name, {
          config: serverConfig,
          client: null,
          state: "disabled",
          tools: [],
        });
      } else {
        this.servers.set(serverConfig.name, {
          config: serverConfig,
          client: null,
          state: "idle",
          tools: [],
        });
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async startAll(): Promise<void> {
    const starts = [...this.servers.values()]
      .filter((s) => s.state !== "disabled")
      .map((s) => this._startServer(s.config.name));
    await Promise.allSettled(starts);
  }

  async shutdown(): Promise<void> {
    const shutdowns = [...this.servers.values()]
      .filter((s) => s.client !== null)
      .map((s) => this._stopServer(s.config.name));
    await Promise.allSettled(shutdowns);
  }

  async reload(serverName?: string): Promise<void> {
    if (serverName) {
      await this._stopServer(serverName);
      await this._startServer(serverName);
    } else {
      await this.shutdown();
      await this.startAll();
    }
  }

  listTools(filter?: string[] | null): McpToolDef[] {
    const tools: McpToolDef[] = [];
    for (const instance of this.servers.values()) {
      if (instance.state !== "running") continue;
      for (const tool of instance.tools) {
        if (!filter || filter.includes(`${instance.config.name}:${tool.name}`)) {
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const instance = this.servers.get(serverName);
    if (!instance) throw new Error(`MCP server "${serverName}" not found`);
    if (instance.state !== "running" || !instance.client) {
      throw new Error(`MCP server "${serverName}" is not running (state: ${instance.state})`);
    }
    try {
      return await instance.client.callTool(toolName, args);
    } catch (err) {
      if (err instanceof McpAuthRequiredError) {
        await this._enterAuthRequired(serverName, err);
      }
      throw err;
    }
  }

  getStatus(): McpServerStatus[] {
    return [...this.servers.values()].map((s) => ({
      name: s.config.name,
      state: s.state,
      tools: s.tools,
      error: s.error,
    }));
  }

  getServerConfig(name: string): McpServerConfig | undefined {
    return this.servers.get(name)?.config;
  }

  /** Begins the OAuth authorization flow for a server currently in `auth_required` state. No-op for any other state. */
  async authorize(serverName: string): Promise<void> {
    const instance = this.servers.get(serverName);
    if (!instance || instance.state !== "auth_required" || !instance.authContext) return;

    const { authServerMetadata, clientId, clientSecret } = instance.authContext;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const redirectUri = this.getRedirectUri();

    this.pendingAuthFlowStore.create(state, {
      serverName,
      codeVerifier,
      authServerMetadata,
      clientId,
      clientSecret,
      redirectUri,
      createdAt: Date.now(),
    });

    const authorizationUrl = new URL(authServerMetadata.authorization_endpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("state", state);

    await this.browserOpener.open(authorizationUrl.toString());
  }

  /** Completes an OAuth flow started by `authorize()` — called from the `/api/mcp/oauth/callback` route. */
  async completeAuthorization(state: string, code: string): Promise<void> {
    const flow = this.pendingAuthFlowStore.consume(state);
    if (!flow) throw new Error("Unknown or expired OAuth authorization state");

    const tokenResponse = await exchangeAuthorizationCode(flow, code);
    const tokenSet: OAuthTokenSet = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: typeof tokenResponse.expires_in === "number" ? Date.now() + tokenResponse.expires_in * 1000 : undefined,
      token_type: tokenResponse.token_type,
      scope: tokenResponse.scope,
      issuer: flow.authServerMetadata.issuer,
      token_endpoint: flow.authServerMetadata.token_endpoint,
      client_id: flow.clientId,
      client_secret: flow.clientSecret,
    };
    setServerTokens(this.tokensFilePath, flow.serverName, tokenSet);

    await this._startServer(flow.serverName);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async _startServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance || instance.state === "disabled") return;

    instance.state = "starting";
    instance.error = undefined;

    const { transport } = instance.config;
    let tokenProvider: TokenProvider | undefined;
    if (transport.type === "http" && getServerTokens(this.tokensFilePath, name)) {
      tokenProvider = new OAuthTokenProvider(name, this.tokensFilePath);
    }

    try {
      const client = this.clientFactory(instance.config, tokenProvider);
      instance.client = client;
      await client.initialize();
      const rawTools = await client.listTools();
      instance.tools = rawTools.map((t) => ({
        ...t,
        serverName: name,
        qualifiedName: `mcp__${name}__${t.name}`,
      }));
      instance.state = "running";
      instance.authContext = undefined;
    } catch (err) {
      if (transport.type === "http" && (err instanceof McpOAuthChallengeError || err instanceof McpAuthRequiredError)) {
        await this._enterAuthRequired(name, err);
        return;
      }
      instance.state = "error";
      instance.error = err instanceof Error ? err.message : String(err);
      instance.client = null;
    }
  }

  private async _stopServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) return;
    try {
      await instance.client?.close();
    } catch {
      // ignore close errors
    }
    instance.client = null;
    instance.tools = [];
    instance.state = "idle";
    instance.error = undefined;
    instance.authContext = undefined;
    this.pendingAuthFlowStore.invalidateForServer(name);
  }

  /** Transitions an HTTP server to `auth_required`, running OAuth discovery to populate the `authContext` that `authorize()` needs. */
  private async _enterAuthRequired(name: string, triggerError: Error): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) return;

    await instance.client?.close().catch(() => {});
    instance.client = null;
    instance.tools = [];

    try {
      const wwwAuthenticate =
        triggerError instanceof McpOAuthChallengeError ? triggerError.wwwAuthenticate : await this._probeChallenge(instance);
      instance.authContext = await this._discover(wwwAuthenticate);
      instance.state = "auth_required";
      instance.error = undefined;
    } catch (discoveryErr) {
      instance.state = "auth_required";
      instance.authContext = undefined;
      instance.error = discoveryErr instanceof Error ? discoveryErr.message : String(discoveryErr);
    }
  }

  /** Makes an unauthenticated connection attempt purely to obtain a fresh `WWW-Authenticate` challenge (used when a stored token is invalid and no live challenge is already at hand). */
  private async _probeChallenge(instance: ServerInstance): Promise<string> {
    const client = this.clientFactory(instance.config, undefined);
    try {
      await client.initialize();
      // Server accepted an unauthenticated connection this time — no challenge to discover.
      throw new OAuthDiscoveryError(`MCP server "${instance.config.name}" no longer requires authorization`);
    } catch (err) {
      if (err instanceof McpOAuthChallengeError) return err.wwwAuthenticate;
      throw err;
    } finally {
      await client.close().catch(() => {});
    }
  }

  private async _discover(wwwAuthenticate: string): Promise<AuthContext> {
    const resourceMetadataUrl = parseResourceMetadataUrl(wwwAuthenticate);
    const protectedResourceMetadata = await discoverProtectedResourceMetadata(resourceMetadataUrl);
    const issuer = protectedResourceMetadata.authorization_servers[0];
    const authServerMetadata = await discoverAuthorizationServerMetadata(issuer);

    let dcr = getDcrClient(this.tokensFilePath, issuer);
    if (!dcr) {
      if (!authServerMetadata.registration_endpoint) {
        throw new OAuthDiscoveryError(`Authorization server "${issuer}" does not support Dynamic Client Registration`);
      }
      dcr = await registerDynamicClient(authServerMetadata.registration_endpoint, issuer, this.getRedirectUri(), "Railyin");
      setDcrClient(this.tokensFilePath, issuer, dcr);
    }

    return { authServerMetadata, clientId: dcr.client_id, clientSecret: dcr.client_secret };
  }
}
