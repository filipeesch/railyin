import type { WaitFn } from "../../pipeline/write-buffer.ts";

export interface MockWait {
  waitFn: WaitFn;
  /** Resolve the currently pending waitFn promise (if any). */
  tick: () => void;
}

/**
 * Returns a controllable WaitFn for tests. Each call to `waitFn(ms)` returns a
 * promise that only resolves when `tick()` is called — no real timers involved.
 * Calling `tick()` when no waitFn promise is pending is a no-op.
 *
 * MW-1: each waitFn(ms) call returns a new pending promise
 * MW-2: tick() resolves the promise; next tick() is a no-op until next waitFn call
 */
export function createMockWait(): MockWait {
  let pending: (() => void) | null = null;

  const waitFn: WaitFn = (_ms: number) =>
    new Promise<void>((resolve) => {
      pending = resolve;
    });

  const tick = () => {
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve();
    }
  };

  return { waitFn, tick };
}
