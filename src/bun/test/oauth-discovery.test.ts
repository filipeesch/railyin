/**
 * 9.3 – Unit tests for discovery.ts
 *
 * Exercises RFC9728 (Protected Resource Metadata), RFC8414 (Authorization
 * Server Metadata), and RFC7591 (Dynamic Client Registration) against a real
 * local Bun.serve() via the shared fake-oauth-server helper, following the
 * providers.test.ts pattern of real-HTTP-wire testing instead of mocks.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createFakeOAuthServer, type FakeOAuthServerHandle } from "./support/fake-oauth-server.ts";
import {
  parseResourceMetadataUrl,
  discoverProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  registerDynamicClient,
} from "../oauth/discovery.ts";
import { OAuthDiscoveryError } from "../oauth/errors.ts";

describe("9.3 discovery.ts against fake OAuth server", () => {
  let fakeServer: FakeOAuthServerHandle | null = null;

  afterEach(() => {
    fakeServer?.stop();
    fakeServer = null;
  });

  // ─── parseResourceMetadataUrl ───────────────────────────────────────────────

  describe("parseResourceMetadataUrl", () => {
    it("extracts the resource_metadata URL from a valid Bearer challenge", () => {
      const url = parseResourceMetadataUrl(
        'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
      );
      expect(url).toBe("https://example.com/.well-known/oauth-protected-resource");
    });

    it("handles additional parameters in the header", () => {
      const url = parseResourceMetadataUrl(
        'Bearer realm="example", resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource"',
      );
      expect(url).toBe("https://auth.example.com/.well-known/oauth-protected-resource");
    });

    it("throws OAuthDiscoveryError when resource_metadata is absent", () => {
      expect(() =>
        parseResourceMetadataUrl('Bearer realm="example"'),
      ).toThrow(OAuthDiscoveryError);
    });

    it("throws OAuthDiscoveryError for an empty header string", () => {
      expect(() => parseResourceMetadataUrl("")).toThrow(OAuthDiscoveryError);
    });
  });

  // ─── discoverProtectedResourceMetadata ─────────────────────────────────────

  describe("discoverProtectedResourceMetadata", () => {
    it("happy path: returns PRM with a non-empty authorization_servers array", async () => {
      fakeServer = createFakeOAuthServer();
      const prm = await discoverProtectedResourceMetadata(
        `${fakeServer.url}/.well-known/oauth-protected-resource`,
      );
      expect(Array.isArray(prm.authorization_servers)).toBe(true);
      expect(prm.authorization_servers.length).toBeGreaterThan(0);
    });

    it("throws OAuthDiscoveryError when the endpoint returns 404", async () => {
      fakeServer = createFakeOAuthServer({ serveProtectedResourceMetadata: false });
      await expect(
        discoverProtectedResourceMetadata(`${fakeServer.url}/.well-known/oauth-protected-resource`),
      ).rejects.toThrow(OAuthDiscoveryError);
    });

    it("throws OAuthDiscoveryError when authorization_servers is empty", async () => {
      fakeServer = createFakeOAuthServer({
        protectedResourceMetadataBody: {
          resource: "http://localhost/mcp",
          authorization_servers: [],
        },
      });
      await expect(
        discoverProtectedResourceMetadata(`${fakeServer.url}/.well-known/oauth-protected-resource`),
      ).rejects.toThrow(OAuthDiscoveryError);
    });

    it("throws OAuthDiscoveryError when authorization_servers key is missing entirely", async () => {
      fakeServer = createFakeOAuthServer({
        protectedResourceMetadataBody: { resource: "http://localhost/mcp" },
      });
      await expect(
        discoverProtectedResourceMetadata(`${fakeServer.url}/.well-known/oauth-protected-resource`),
      ).rejects.toThrow(OAuthDiscoveryError);
    });
  });

  // ─── discoverAuthorizationServerMetadata ───────────────────────────────────

  describe("discoverAuthorizationServerMetadata", () => {
    it("happy path: returns metadata with required authorization_endpoint and token_endpoint", async () => {
      fakeServer = createFakeOAuthServer();
      const meta = await discoverAuthorizationServerMetadata(fakeServer.url);
      expect(typeof meta.authorization_endpoint).toBe("string");
      expect(typeof meta.token_endpoint).toBe("string");
    });

    it("exposes the registration_endpoint when DCR is supported", async () => {
      fakeServer = createFakeOAuthServer();
      const meta = await discoverAuthorizationServerMetadata(fakeServer.url);
      expect(typeof meta.registration_endpoint).toBe("string");
    });

    it("does not expose registration_endpoint when supportsDcr is false", async () => {
      fakeServer = createFakeOAuthServer({ supportsDcr: false });
      const meta = await discoverAuthorizationServerMetadata(fakeServer.url);
      expect(meta.registration_endpoint).toBeUndefined();
    });

    it("throws OAuthDiscoveryError when the well-known endpoint returns 404", async () => {
      fakeServer = createFakeOAuthServer({ serveAuthServerMetadata: false });
      await expect(
        discoverAuthorizationServerMetadata(fakeServer.url),
      ).rejects.toThrow(OAuthDiscoveryError);
    });

    it("throws OAuthDiscoveryError when token_endpoint is absent from the response", async () => {
      fakeServer = createFakeOAuthServer({
        authServerMetadataBody: {
          issuer: "http://localhost",
          authorization_endpoint: "http://localhost/authorize",
          // token_endpoint intentionally omitted
        },
      });
      await expect(
        discoverAuthorizationServerMetadata(fakeServer.url),
      ).rejects.toThrow(OAuthDiscoveryError);
    });

    it("throws OAuthDiscoveryError when authorization_endpoint is absent from the response", async () => {
      fakeServer = createFakeOAuthServer({
        authServerMetadataBody: {
          issuer: "http://localhost",
          token_endpoint: "http://localhost/token",
          // authorization_endpoint intentionally omitted
        },
      });
      await expect(
        discoverAuthorizationServerMetadata(fakeServer.url),
      ).rejects.toThrow(OAuthDiscoveryError);
    });

    // Regression test for a real-world bug found against Atlassian's MCP server:
    // a path-component issuer (e.g. a per-tenant `https://auth.example.com/<tenant-id>`)
    // must have the well-known suffix inserted *before* its path per RFC8414 §3.1,
    // not appended after the origin (which silently drops the tenant path and
    // returns/404s on the wrong document — e.g. one lacking registration_endpoint).
    it("resolves the RFC8414 well-known URL for a multi-tenant issuer with a path component", async () => {
      fakeServer = createFakeOAuthServer({ issuerPath: "/tenant-abc123" });
      const issuer = `${fakeServer.url}/tenant-abc123`;
      const meta = await discoverAuthorizationServerMetadata(issuer);
      expect(meta.authorization_endpoint).toBe(`${fakeServer.url}/authorize`);
      expect(meta.token_endpoint).toBe(`${fakeServer.url}/token`);
      expect(meta.registration_endpoint).toBe(`${fakeServer.url}/register`);
    });

    it("does not strip a path-component issuer's path when building the well-known URL", async () => {
      fakeServer = createFakeOAuthServer({ issuerPath: "/tenant-abc123" });
      const issuer = `${fakeServer.url}/tenant-abc123`;
      // Serving auth-server metadata only at the tenant-scoped well-known path
      // (not the origin root) means this would 404 if the well-known URL
      // construction incorrectly discarded the issuer's path.
      await expect(discoverAuthorizationServerMetadata(issuer)).resolves.toBeDefined();
    });
  });

  // ─── registerDynamicClient ──────────────────────────────────────────────────

  describe("registerDynamicClient", () => {
    it("happy path: returns a client_id and correct issuer", async () => {
      fakeServer = createFakeOAuthServer();
      const meta = await discoverAuthorizationServerMetadata(fakeServer.url);
      const reg = await registerDynamicClient(
        meta.registration_endpoint!,
        fakeServer.url,
        "http://localhost:3000/callback",
        "TestApp",
      );
      expect(typeof reg.client_id).toBe("string");
      expect(reg.client_id.length).toBeGreaterThan(0);
      expect(reg.issuer).toBe(fakeServer.url);
    });

    it("increments dcrCallCount on each registration", async () => {
      fakeServer = createFakeOAuthServer();
      const meta = await discoverAuthorizationServerMetadata(fakeServer.url);
      expect(fakeServer.dcrCallCount).toBe(0);
      await registerDynamicClient(
        meta.registration_endpoint!,
        fakeServer.url,
        "http://localhost:3000/callback",
        "App",
      );
      expect(fakeServer.dcrCallCount).toBe(1);
    });

    it("registers the client in the server's registeredClients map", async () => {
      fakeServer = createFakeOAuthServer();
      const meta = await discoverAuthorizationServerMetadata(fakeServer.url);
      const reg = await registerDynamicClient(
        meta.registration_endpoint!,
        fakeServer.url,
        "http://localhost:3000/callback",
        "App",
      );
      expect(fakeServer.registeredClients.has(reg.client_id)).toBe(true);
    });

    it("throws OAuthDiscoveryError when DCR returns 400", async () => {
      fakeServer = createFakeOAuthServer({ dcrStatus: 400 });
      const meta = await discoverAuthorizationServerMetadata(fakeServer.url);
      await expect(
        registerDynamicClient(
          meta.registration_endpoint!,
          fakeServer.url,
          "http://localhost:3000/callback",
          "App",
        ),
      ).rejects.toThrow(OAuthDiscoveryError);
    });

    it("throws OAuthDiscoveryError when DCR endpoint returns 404 (supportsDcr: false)", async () => {
      fakeServer = createFakeOAuthServer({ supportsDcr: false });
      await expect(
        registerDynamicClient(
          `${fakeServer.url}/register`,
          fakeServer.url,
          "http://localhost:3000/callback",
          "App",
        ),
      ).rejects.toThrow(OAuthDiscoveryError);
    });
  });
});
