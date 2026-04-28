import type { Database } from "bun:sqlite";
import type { WaitFn } from "../pipeline/write-buffer.ts";

const defaultWaitFn: WaitFn = (ms) => new Promise((r) => setTimeout(r, ms));

export class RetentionJob {
  private running = false;
  private tickResolve: (() => void) | null = null;
  private readonly waitFn: WaitFn;

  constructor(
    private readonly db: Database,
    waitFn?: WaitFn,
  ) {
    this.waitFn = waitFn ?? defaultWaitFn;
  }

  runNow(): void {
    this.db.run("DELETE FROM model_raw_messages WHERE created_at < datetime('now', '-1 day')");
    this.db.run("DELETE FROM stream_events WHERE created_at < datetime('now', '-4 hours')");
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.runNow();
    void this._loop();
  }

  stop(): void {
    this.running = false;
    this._tick();
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
        this.waitFn(5 * 60_000).then(() => {
          if (this.tickResolve === resolve) {
            this.tickResolve = null;
            resolve();
          }
        });
      });
      if (this.running) this.runNow();
    }
  }
}
