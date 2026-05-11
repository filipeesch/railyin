/**
 * AsyncQueue — a buffered async channel.
 *
 * push() always buffers items; a waiting consumer receives them immediately.
 * close() signals end-of-stream; any pending or future next() calls resolve with done:true.
 *
 * Invariant: a push() is NEVER lost. If nobody is waiting, the item is buffered.
 * This eliminates the lost-wakeup race that a single-callback bridge suffers when
 * the generator is suspended at a yield point.
 */
export class AsyncQueue<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T, void>) => void> = [];
  private _closed = false;

  push(item: T): void {
    if (this._closed) return;
    if (this.waiters.length > 0) {
      this.waiters.shift()!({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  /** Terminate the iteration. Idempotent — safe to call multiple times. */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T, void>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this._closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<T, void>> => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
