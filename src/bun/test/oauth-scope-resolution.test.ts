/**
 * 9.8 – OAuth `scope` request-parameter resolution
 *
 * Regression coverage for the real-world Atlassian failure: we never sent a
 * `scope` param on /authorize, so the authorization server issued a token
 * missing scopes the protected resource actually required, surfacing as an
 * opaque "scope does not match" error on the first authenticated call.
 */

import { describe, it, expect } from "vitest";
import { parseWwwAuthenticateScope, resolveAuthorizationScope } from "../oauth/scope-resolution.ts";
import type { AuthorizationServerMetadata, ProtectedResourceMetadata } from "../oauth/types.ts";

const prm = (scopes?: string[]): ProtectedResourceMetadata => ({
  resource: "https://api.example.com/mcp",
  authorization_servers: ["https://auth.example.com"],
  ...(scopes ? { scopes_supported: scopes } : {}),
});

const asm = (scopes?: string[]): AuthorizationServerMetadata => ({
  issuer: "https://auth.example.com",
  authorization_endpoint: "https://auth.example.com/authorize",
  token_endpoint: "https://auth.example.com/token",
  ...(scopes ? { scopes_supported: scopes } : {}),
});

describe("parseWwwAuthenticateScope", () => {
  it("extracts the scope attribute when present", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", scope="read write"';
    expect(parseWwwAuthenticateScope(header)).toBe("read write");
  });

  it("returns undefined when no scope attribute is present", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"';
    expect(parseWwwAuthenticateScope(header)).toBeUndefined();
  });

  it("returns undefined for an empty scope attribute", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", scope=""';
    expect(parseWwwAuthenticateScope(header)).toBeUndefined();
  });
});

describe("resolveAuthorizationScope", () => {
  it("prefers the scope advertised on the WWW-Authenticate challenge over any other source", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", scope="challenge:scope"';
    const scope = resolveAuthorizationScope(header, prm(["resource:scope"]), asm(["as:scope"]));
    expect(scope).toBe("challenge:scope");
  });

  it("falls back to the Protected Resource Metadata's scopes_supported when the challenge has none", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"';
    const scope = resolveAuthorizationScope(header, prm(["read:jira-work", "write:jira-work"]), asm(["as:scope"]));
    expect(scope).toBe("read:jira-work write:jira-work");
  });

  it("falls back to the Authorization Server Metadata's scopes_supported when neither the challenge nor the resource advertise scope", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"';
    const scope = resolveAuthorizationScope(header, prm(), asm(["as:scope"]));
    expect(scope).toBe("as:scope");
  });

  it("returns undefined when no source advertises any scope, preserving today's no-scope behavior", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"';
    const scope = resolveAuthorizationScope(header, prm(), asm());
    expect(scope).toBeUndefined();
  });

  it("ignores an empty scopes_supported array on the resource and falls through to the authorization server", () => {
    const header = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"';
    const scope = resolveAuthorizationScope(header, prm([]), asm(["as:scope"]));
    expect(scope).toBe("as:scope");
  });
});
