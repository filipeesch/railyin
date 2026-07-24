/**
 * 9.4 – Unit tests for token-store.ts
 *
 * File-based I/O tests using a mkdtempSync temp directory, mirroring the
 * mcp-config-loader.test.ts style.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  globalTokensPath,
  projectTokensPath,
  readTokensFile,
  getServerTokens,
  setServerTokens,
  clearServerTokens,
  getDcrClient,
  setDcrClient,
} from "../oauth/token-store.ts";
import type { DcrClientRegistration, OAuthTokenSet } from "../oauth/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTokenSet(overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
  return {
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: Date.now() + 3_600_000,
    token_type: "Bearer",
    issuer: "https://auth.example.com",
    token_endpoint: "https://auth.example.com/token",
    client_id: "client-123",
    ...overrides,
  };
}

const DCR_REG: DcrClientRegistration = {
  client_id: "client-abc",
  issuer: "https://auth.example.com",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("9.4 token-store.ts", () => {
  let tempDir: string;
  let tokensFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "railyn-token-store-test-"));
    tokensFilePath = join(tempDir, "mcp-tokens.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Path helpers ──────────────────────────────────────────────────────────

  describe("path helpers", () => {
    it("globalTokensPath joins dataDir with mcp-tokens.json", () => {
      expect(globalTokensPath("/home/user/.railyn")).toBe("/home/user/.railyn/mcp-tokens.json");
    });

    it("projectTokensPath places file inside <project>/.railyn/", () => {
      expect(projectTokensPath("/projects/my-app")).toBe("/projects/my-app/.railyn/mcp-tokens.json");
    });
  });

  // ─── readTokensFile ────────────────────────────────────────────────────────

  describe("readTokensFile", () => {
    it("returns empty structure when the file does not exist", () => {
      const result = readTokensFile(join(tempDir, "nonexistent.json"));
      expect(result).toEqual({ tokens: {}, dcrClients: {} });
    });

    it("throws SyntaxError when the file contains malformed JSON", () => {
      writeFileSync(tokensFilePath, "not-valid-json", "utf-8");
      expect(() => readTokensFile(tokensFilePath)).toThrow(SyntaxError);
    });

    it("tolerates a file with only a tokens key (back-fills dcrClients)", () => {
      writeFileSync(tokensFilePath, JSON.stringify({ tokens: {} }), "utf-8");
      const result = readTokensFile(tokensFilePath);
      expect(result.dcrClients).toEqual({});
    });

    it("tolerates a file with only a dcrClients key (back-fills tokens)", () => {
      writeFileSync(tokensFilePath, JSON.stringify({ dcrClients: {} }), "utf-8");
      const result = readTokensFile(tokensFilePath);
      expect(result.tokens).toEqual({});
    });
  });

  // ─── setServerTokens / getServerTokens ────────────────────────────────────

  describe("setServerTokens / getServerTokens round-trip", () => {
    it("stores and retrieves a token set by server name", () => {
      const tokenSet = makeTokenSet();
      setServerTokens(tokensFilePath, "my-server", tokenSet);
      expect(getServerTokens(tokensFilePath, "my-server")).toEqual(tokenSet);
    });

    it("returns undefined for an unknown server name", () => {
      expect(getServerTokens(tokensFilePath, "nonexistent")).toBeUndefined();
    });

    it("overwrites an existing entry for the same server name", () => {
      setServerTokens(tokensFilePath, "srv", makeTokenSet({ access_token: "old" }));
      setServerTokens(tokensFilePath, "srv", makeTokenSet({ access_token: "new" }));
      expect(getServerTokens(tokensFilePath, "srv")?.access_token).toBe("new");
    });

    it("stores tokens for two servers without clobbering each other", () => {
      setServerTokens(tokensFilePath, "server-a", makeTokenSet({ access_token: "token-a" }));
      setServerTokens(tokensFilePath, "server-b", makeTokenSet({ access_token: "token-b" }));
      expect(getServerTokens(tokensFilePath, "server-a")?.access_token).toBe("token-a");
      expect(getServerTokens(tokensFilePath, "server-b")?.access_token).toBe("token-b");
    });

    it("interleaved writes for two servers preserve both entries", () => {
      setServerTokens(tokensFilePath, "srv-x", makeTokenSet({ access_token: "x-v1" }));
      setServerTokens(tokensFilePath, "srv-y", makeTokenSet({ access_token: "y-v1" }));
      setServerTokens(tokensFilePath, "srv-x", makeTokenSet({ access_token: "x-v2" }));
      expect(getServerTokens(tokensFilePath, "srv-x")?.access_token).toBe("x-v2");
      expect(getServerTokens(tokensFilePath, "srv-y")?.access_token).toBe("y-v1");
    });
  });

  // ─── clearServerTokens ────────────────────────────────────────────────────

  describe("clearServerTokens", () => {
    it("removes the named server's tokens from the file", () => {
      setServerTokens(tokensFilePath, "srv", makeTokenSet());
      clearServerTokens(tokensFilePath, "srv");
      expect(getServerTokens(tokensFilePath, "srv")).toBeUndefined();
    });

    it("is a no-op when the server has no stored tokens", () => {
      expect(() => clearServerTokens(tokensFilePath, "nonexistent")).not.toThrow();
    });

    it("does not remove other servers' tokens when clearing one", () => {
      setServerTokens(tokensFilePath, "srv-a", makeTokenSet({ access_token: "a" }));
      setServerTokens(tokensFilePath, "srv-b", makeTokenSet({ access_token: "b" }));
      clearServerTokens(tokensFilePath, "srv-a");
      expect(getServerTokens(tokensFilePath, "srv-a")).toBeUndefined();
      expect(getServerTokens(tokensFilePath, "srv-b")?.access_token).toBe("b");
    });
  });

  // ─── setDcrClient / getDcrClient ──────────────────────────────────────────

  describe("setDcrClient / getDcrClient round-trip", () => {
    const issuer = "https://auth.example.com";

    it("stores and retrieves a DCR registration by issuer URL", () => {
      setDcrClient(tokensFilePath, issuer, DCR_REG);
      expect(getDcrClient(tokensFilePath, issuer)).toEqual(DCR_REG);
    });

    it("returns undefined for an unknown issuer", () => {
      expect(getDcrClient(tokensFilePath, "https://unknown.example.com")).toBeUndefined();
    });

    it("DCR client is keyed independently of server tokens", () => {
      setServerTokens(tokensFilePath, "srv", makeTokenSet());
      setDcrClient(tokensFilePath, issuer, DCR_REG);
      // both can be read back independently
      expect(getDcrClient(tokensFilePath, issuer)).toEqual(DCR_REG);
      expect(getServerTokens(tokensFilePath, "srv")).toBeDefined();
    });

    it("two issuers are stored independently", () => {
      const issuerA = "https://auth-a.example.com";
      const issuerB = "https://auth-b.example.com";
      setDcrClient(tokensFilePath, issuerA, { ...DCR_REG, client_id: "a", issuer: issuerA });
      setDcrClient(tokensFilePath, issuerB, { ...DCR_REG, client_id: "b", issuer: issuerB });
      expect(getDcrClient(tokensFilePath, issuerA)?.client_id).toBe("a");
      expect(getDcrClient(tokensFilePath, issuerB)?.client_id).toBe("b");
    });

    it("creates the parent directory if it does not exist (project scope)", () => {
      const nestedPath = join(tempDir, "project", ".railyn", "mcp-tokens.json");
      setDcrClient(nestedPath, issuer, DCR_REG);
      expect(getDcrClient(nestedPath, issuer)).toEqual(DCR_REG);
    });
  });
});
