/**
 * Verifies the module-load-time `Cursor.configure({ local: { useHttp1ForAgent: true } })`
 * call in inprocess-adapter.ts (forces the SDK's local-agent streams onto HTTP/1.1
 * instead of HTTP/2 — see the comment above that call for why).
 *
 * That call is a top-level statement using the real static `Cursor` import from
 * `@cursor/sdk` (not the per-instance injectable `CursorSdkClient`), so it can only
 * be observed by mocking `@cursor/sdk` and importing inprocess-adapter.ts fresh
 * afterwards. `vitest`'s `vi.resetModules`/`vi.doMock`/`vi.importActual` aren't
 * implemented by Bun's `bun:test` vitest-compat shim (`vi` here is a thin wrapper
 * around Bun's native mock API — only `fn`/`mock`/`spyOn`/timer helpers exist), so
 * this uses Bun's native `mock.module(specifier, factory)` (exposed here as
 * `vi.mock`) instead: it swaps the module registry entry for `@cursor/sdk` before
 * `inprocess-adapter.ts` is ever imported. Kept in its own file (no static import
 * of inprocess-adapter.ts anywhere else) so the mock is guaranteed to be in place
 * before the module's first — and in this process, only — load, and so it can't
 * affect the real `@cursor/sdk` binding used by the static-import-based tests in
 * inprocess-adapter.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import * as realCursorSdk from "@cursor/sdk";

describe("inprocess-adapter module load", () => {
  it("calls Cursor.configure with { local: { useHttp1ForAgent: true } } exactly once at import time", async () => {
    const configureSpy = vi.fn();

    vi.mock("@cursor/sdk", () => ({
      ...realCursorSdk,
      Cursor: { ...realCursorSdk.Cursor, configure: configureSpy },
    }));

    // Cache-bust: this file's suite may run in the same process as
    // inprocess-adapter.test.ts (which statically imports the real module),
    // so a plain `import("./inprocess-adapter.ts")` could resolve to an
    // already-evaluated, already-cached module instance whose top-level
    // `Cursor.configure(...)` call already ran against the *real* SDK.
    // Appending a unique query forces a fresh module evaluation under the
    // mocked `@cursor/sdk`.
    await import(`./inprocess-adapter.ts?test=${Date.now()}-${Math.random()}`);

    expect(configureSpy).toHaveBeenCalledTimes(1);
    expect(configureSpy).toHaveBeenCalledWith({ local: { useHttp1ForAgent: true } });
  });
});
