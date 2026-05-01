import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@bun": resolve(__dirname, "src/bun"),
      // bun:sqlite is a Bun built-in that Vite cannot resolve.  Map it to a
      // compatibility shim wrapping better-sqlite3 for the Vite transform
      // phase (Stryker/vitest runs).  Production code always uses bun:sqlite
      // natively via the Bun runtime.
      "bun:sqlite": resolve(__dirname, "src/bun/test/shims/bun-sqlite.ts"),
    },
  },
  test: {
    include: ["src/bun/test/**/*.test.ts"],
    // forks pool gives each test file an isolated subprocess with its own
    // module registry — same isolation guarantees as bun test.
    pool: "forks",
    // poolMatchGlobs is checked before pool in vitest's getFilePoolName().
    // Stryker overrides pool to 'threads' but never sets poolMatchGlobs, so
    // this survives Stryker's deepMerge and routes all test files to forks
    // even in a Stryker mutation run. This avoids better-sqlite3's native
    // Addon::Cleanup hook firing during worker thread isolate teardown (SIGSEGV
    // on macOS/arm64).
    poolMatchGlobs: [["**", "forks"]],
    environment: "node",
    globals: false,
    setupFiles: ["src/bun/test/shims/bun-globals.ts", "src/bun/test/shims/vitest-teardown.ts"],
  },
});
