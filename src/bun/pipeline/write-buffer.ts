export type WaitFn = (ms: number) => Promise<void>;

const defaultWaitFn: WaitFn = (ms) => new Promise((r) => setTimeout(r, ms));

export interface WriteBufferOptions<T> {
  maxBatch?: number;
  intervalMs?: number;
  flushFn: (items: T[]) => void;
  waitFn?: WaitFn;
}

export class WriteBuffer<T> {
  private pending: T[] = [];
  private running = false;
  private readonly maxBatch: number;
  private readonly intervalMs: number;
  private readonly flushFn: (items: T[]) => void;
  private readonly waitFn: WaitFn;
  private tickResolve: (() => void) | null = null;

  constructor(opts: WriteBufferOptions<T>) {
    this.maxBatch = opts.maxBatch ?? 100;
    this.intervalMs = opts.intervalMs ?? 500;
    this.flushFn = opts.flushFn;
    this.waitFn = opts.waitFn ?? defaultWaitFn;
  }

  enqueue(item: T): void {
    this.pending.push(item);
    // Wake the loop to flush soon — do NOT flush synchronously here.
    // A synchronous flush would block the event loop in the caller's context
    // (e.g., the adapter IIFE), preventing WS broadcasts from being sent
    // until the SQLite transaction completes, causing token delivery bursts.
    if (this.pending.length >= this.maxBatch) {
      this._tick();
    }
  }

  flush(): T[] {
    if (this.pending.length === 0) return [];
    const items = this.pending.splice(0);
    this.flushFn(items);
    return items;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this._loop();
  }

  stop(): void {
    this.running = false;
    this._tick();
    this.flush();
  }

  private _tick(): void {
    if (this.tickResolve) {
      const resolve = this.tickResolve;
      this.tickResolve = null;
      resolve();
    }
  }

  private async _loop(): Promise<void> {
    while (this.running) {
      await new Promise<void>((resolve) => {
        this.tickResolve = resolve;
        this.waitFn(this.intervalMs).then(() => {
          if (this.tickResolve === resolve) {
            this.tickResolve = null;
            resolve();
          }
        });
      });
      if (this.running) {
        // Yield to the macrotask queue before flushing so that any pending
        // WS broadcasts (microtask continuations from the stream consumer)
        // complete before the synchronous SQLite write blocks the event loop.
        await new Promise<void>((r) => setImmediate(r));
        this.flush();
      }
    }
  }
}
