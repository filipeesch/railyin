import type { FileStateCache } from "../../engine/claude/file-state-cache.ts";

/**
 * Test double for `FileStateCache`.
 *
 * Follows the same support-class convention as `MockClaudeSdkAdapter`:
 * - Typed interface implementation
 * - Builder API (`preset`)
 * - `trace` record for side-effect observation (no `vi.fn()` needed)
 */
export class StubFileStateCache implements FileStateCache {
  private readonly store = new Map<string, string | null>();
  readonly trace = {
    deleted: [] as string[],
    cleared: 0,
  };

  /** Pre-load a return value for a given callId. */
  preset(callId: string, content: string | null): this {
    this.store.set(callId, content);
    return this;
  }

  get(callId: string): string | null | undefined {
    return this.store.get(callId); // undefined if never preset
  }

  delete(callId: string): void {
    this.store.delete(callId);
    this.trace.deleted.push(callId);
  }

  capture(): void {
    // no-op — stub provides content via preset()
  }

  clear(): void {
    this.store.clear();
    this.trace.cleared++;
  }

  /** Reset store and trace for reuse between test cases. */
  reset(): void {
    this.store.clear();
    this.trace.deleted.length = 0;
    this.trace.cleared = 0;
  }
}
