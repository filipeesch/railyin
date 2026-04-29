export type WaitFn = (ms: number) => Promise<void>;

const defaultWaitFn: WaitFn = (ms) => new Promise((r) => setTimeout(r, ms));

export interface WriteBufferOptions<T> {
  maxBatch?: number;
  intervalMs?: number;
  flushFn: (items: T[]) => void;
  waitFn?: WaitFn;
  /** Fires synchronously on each enqueue, before the item is added to the
   *  pending batch. Use this for side-effects (e.g. WS broadcast) that must
   *  happen immediately and must not wait for the batch flush. */
  onEnqueue?: (item: T) => void;
}

export class WriteBuffer<T> {
  private pending: T[] = [];
  private running = false;
  private readonly maxBatch: number;
  private readonly intervalMs: number;
  private readonly flushFn: (items: T[]) => void;
  private readonly waitFn: WaitFn;
  private readonly onEnqueue?: (item: T) => void;
  private tickResolve: (() => void) | null = null;

  constructor(opts: WriteBufferOptions<T>) {
    this.maxBatch = opts.maxBatch ?? 100;
    this.intervalMs = opts.intervalMs ?? 500;
    this.flushFn = opts.flushFn;
    this.waitFn = opts.waitFn ?? defaultWaitFn;
    this.onEnqueue = opts.onEnqueue;
  }

  enqueue(item: T): void {
    this.onEnqueue?.(item);
    this.pending.push(item);
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
        this.flush();
      }
    }
  }
}
