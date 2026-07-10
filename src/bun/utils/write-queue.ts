/**
 * A small reusable async write-queue keyed by an arbitrary string key (e.g. conversationId).
 * Ensures that concurrent async operations registered under the same key run strictly
 * sequentially (in call order), while operations under different keys proceed independently.
 *
 * Used to serialize concurrent appends to the same conversation's JSONL file — Bun runs as a
 * single process, so this only needs to guard against interleaving between async I/O calls
 * that are in-flight at the same time (no OS-level file locking required).
 */
export class KeyedWriteQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Enqueue `task` to run after all previously enqueued tasks for the same `key` have settled
   * (whether they resolved or rejected). Returns a promise that resolves/rejects with the
   * result of `task` itself — a failure in an earlier task never blocks later ones, it's only
   * used for ordering.
   */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const settledPrevious = previous.then(
      () => undefined,
      () => undefined,
    );
    const next = settledPrevious.then(task);
    // Store the settled-form of `next` as the new tail so subsequent enqueues wait on it too,
    // regardless of whether this task succeeds or fails.
    const tailForNext = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tailForNext);
    return next;
  }
}
