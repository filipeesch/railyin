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
  /** Max consecutive SQLITE_BUSY flush failures before a batch is dropped.
   *  Defaults to 3. Bounds memory growth when the DB stays locked. */
  maxBusyRetries?: number;
  /** Called when a batch is dropped after retry exhaustion or a non-busy
   *  flush error. Defaults to console.error. Injectable for tests. */
  onError?: (err: unknown, items: T[]) => void;
}

function isBusyError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: unknown }).code === "SQLITE_BUSY"
  );
}

export class WriteBuffer<T> {
  private pending: T[] = [];
  private running = false;
  private readonly maxBatch: number;
  private readonly intervalMs: number;
  private readonly flushFn: (items: T[]) => void;
  private readonly waitFn: WaitFn;
  private readonly onEnqueue?: (item: T) => void;
  private readonly maxBusyRetries: number;
  private readonly onError: (err: unknown, items: T[]) => void;
  private consecutiveBusyFailures = 0;
  private tickResolve: (() => void) | null = null;

  constructor(opts: WriteBufferOptions<T>) {
    this.maxBatch = opts.maxBatch ?? 100;
    this.intervalMs = opts.intervalMs ?? 500;
    this.flushFn = opts.flushFn;
    this.waitFn = opts.waitFn ?? defaultWaitFn;
    this.onEnqueue = opts.onEnqueue;
    this.maxBusyRetries = opts.maxBusyRetries ?? 3;
    this.onError = opts.onError ?? ((err, _items) => console.error("[write-buffer] flush failed:", err));
  }

  enqueue(item: T): void {
    this.onEnqueue?.(item);
    this.pending.push(item);
    if (this.pending.length >= this.maxBatch) {
      this._tick();
    }
  }

  /**
   * Flushes the pending batch through `flushFn`. Never throws: SQLITE_BUSY
   * failures requeue the batch (bounded by `maxBusyRetries`), other errors
   * drop the batch via `onError`. Returns the items that were handed to
   * `flushFn` (empty when the flush failed).
   */
  flush(): T[] {
    if (this.pending.length === 0) return [];
    const items = this.pending.splice(0);
    try {
      this.flushFn(items);
      this.consecutiveBusyFailures = 0;
      return items;
    } catch (err) {
      if (isBusyError(err) && this.consecutiveBusyFailures < this.maxBusyRetries) {
        // Requeue at the front and retry on the next flush. The failure
        // counter bounds how long a persistently-locked DB can hold memory.
        this.consecutiveBusyFailures++;
        this.pending.unshift(...items);
      } else {
        this.consecutiveBusyFailures = 0;
        this.onError(err, items);
      }
      return [];
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this._loop();
  }

  stop(): void {
    this.running = false;
    this._tick();
    // flush() never throws, so shutdown cannot crash on a locked database.
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
      try {
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
      } catch (err) {
        // A transient failure (e.g. a custom waitFn rejecting) must never kill
        // the flush pipeline — log and keep looping.
        console.error("[write-buffer] background loop error:", err);
      }
    }
  }
}
