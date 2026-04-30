/** Portable text-hashing abstraction used by CacheBreakTracker.
 *
 * Production code uses the Bun implementation (zero extra deps).
 * Test code (Node.js vitest workers) uses the node:crypto implementation.
 */
export type TextHasher = (text: string) => string;

/** Default hasher — uses Bun.CryptoHasher (available in production). */
export function createBunHasher(): TextHasher {
  return (text: string): string =>
    new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 8);
}

/** Node.js-compatible hasher — suitable for vitest workers that run under Node. */
export function createNodeHasher(): TextHasher {
  return (text: string): string => {
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    return createHash("sha256").update(text).digest("hex").slice(0, 8);
  };
}
