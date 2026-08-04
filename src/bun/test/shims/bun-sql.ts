/**
 * Compatibility shim: makes `import { SQL } from "bun"` resolve when running
 * under Vite/vitest (Stryker mutation runs). The `bun` package is a Bun
 * built-in with no npm equivalent, so Vite cannot resolve it natively.
 *
 * This file is only referenced via the `resolve.alias` in
 * vitest.backend.config.ts — production code always uses the real `bun`
 * module. Every test that runs under vitest uses the SQLite driver (via the
 * `bun:sqlite` shim), which never constructs this class, so a throwing stub
 * is sufficient: it satisfies module resolution and fails loudly if the
 * PostgreSQL path is ever accidentally exercised in this environment.
 */
export class SQL {
  constructor(_config: unknown) {}

  unsafe(..._args: unknown[]): Promise<never> {
    throw new Error(
      "bun's SQL client is not available under the vitest/Node test environment — this shim only exists for module resolution.",
    );
  }

  begin(..._args: unknown[]): Promise<never> {
    throw new Error(
      "bun's SQL client is not available under the vitest/Node test environment — this shim only exists for module resolution.",
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
