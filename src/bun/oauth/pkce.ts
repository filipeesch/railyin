// ─── PKCE (RFC7636) + CSRF state helpers ───────────────────────────────────────
//
// Pure functions, no I/O — used by `McpClientRegistry.authorize()` to build
// an Authorization Code + PKCE request, and by tests directly.

import { randomBytes, createHash } from "node:crypto";

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generates a PKCE code verifier: a random string using unreserved characters, 43-128 chars. */
export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

/** Derives the S256 PKCE code challenge for a given code verifier. */
export function generateCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
}

/** Generates an opaque, unguessable CSRF `state` value for an authorization request. */
export function generateState(): string {
  return base64UrlEncode(randomBytes(24));
}
