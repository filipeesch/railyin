/**
 * 9.2 – Pure function tests for pkce.ts
 *
 * No I/O involved — just verifies that generateCodeVerifier / generateCodeChallenge /
 * generateState produce values conforming to the PKCE (RFC 7636) and OAuth 2.1 specs.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../oauth/pkce.ts";

// PKCE / CSRF state values must use only unreserved URI characters (base64url alphabet).
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe("9.2 pkce.ts – pure function tests", () => {
  // ─── generateCodeVerifier ───────────────────────────────────────────────────

  describe("generateCodeVerifier", () => {
    it("uses only base64url characters (no +, /, or =)", () => {
      const v = generateCodeVerifier();
      expect(BASE64URL_RE.test(v)).toBe(true);
      expect(v).not.toContain("+");
      expect(v).not.toContain("/");
      expect(v).not.toContain("=");
    });

    it("meets the PKCE minimum length of 43 characters", () => {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
    });

    it("does not exceed the PKCE maximum length of 128 characters", () => {
      const v = generateCodeVerifier();
      expect(v.length).toBeLessThanOrEqual(128);
    });

    it("produces unique values across ten consecutive calls", () => {
      const values = Array.from({ length: 10 }, generateCodeVerifier);
      const unique = new Set(values);
      expect(unique.size).toBe(10);
    });
  });

  // ─── generateCodeChallenge ─────────────────────────────────────────────────

  describe("generateCodeChallenge", () => {
    it("uses only base64url characters (no +, /, or =)", () => {
      const challenge = generateCodeChallenge(generateCodeVerifier());
      expect(BASE64URL_RE.test(challenge)).toBe(true);
      expect(challenge).not.toContain("+");
      expect(challenge).not.toContain("/");
      expect(challenge).not.toContain("=");
    });

    it("derives the correct S256 challenge for a known verifier (cross-checked with node:crypto)", () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const expected = createHash("sha256")
        .update(verifier)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      expect(generateCodeChallenge(verifier)).toBe(expected);
    });

    it("produces distinct challenges for two different verifiers", () => {
      const c1 = generateCodeChallenge(generateCodeVerifier());
      const c2 = generateCodeChallenge(generateCodeVerifier());
      expect(c1).not.toBe(c2);
    });

    it("is deterministic: same verifier always yields same challenge", () => {
      const verifier = generateCodeVerifier();
      expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
    });
  });

  // ─── generateState ─────────────────────────────────────────────────────────

  describe("generateState", () => {
    it("uses only base64url characters (no +, /, or =)", () => {
      const s = generateState();
      expect(BASE64URL_RE.test(s)).toBe(true);
      expect(s).not.toContain("+");
      expect(s).not.toContain("/");
      expect(s).not.toContain("=");
    });

    it("produces unique values across ten consecutive calls", () => {
      const values = Array.from({ length: 10 }, generateState);
      const unique = new Set(values);
      expect(unique.size).toBe(10);
    });

    it("is at least 16 characters long (sufficient CSRF entropy)", () => {
      const s = generateState();
      expect(s.length).toBeGreaterThanOrEqual(16);
    });
  });
});
