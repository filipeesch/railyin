export const LOOP_WINDOW_SIZE = 15;
export const LOOP_MAX_REPEAT = 3;

export class ToolLoopDetector {
  private readonly window: string[] = [];
  private readonly counts = new Map<string, number>();

  /**
   * Records a tool call and returns true if the call's fingerprint has appeared
   * LOOP_MAX_REPEAT or more times within the last LOOP_WINDOW_SIZE calls.
   */
  record(toolName: string, args: unknown): boolean {
    const fp = this.fingerprint(toolName, args);

    if (this.window.length === LOOP_WINDOW_SIZE) {
      const evicted = this.window.shift()!;
      const prev = this.counts.get(evicted)! - 1;
      if (prev <= 0) {
        this.counts.delete(evicted);
      } else {
        this.counts.set(evicted, prev);
      }
    }

    this.window.push(fp);
    this.counts.set(fp, (this.counts.get(fp) ?? 0) + 1);

    return this.counts.get(fp)! >= LOOP_MAX_REPEAT;
  }

  reset(): void {
    this.window.length = 0;
    this.counts.clear();
  }

  private fingerprint(toolName: string, args: unknown): string {
    const normalizedArgs = args != null && typeof args === "object" && !Array.isArray(args)
      ? Object.fromEntries(Object.keys(args as Record<string, unknown>).sort().map((k) => [k, (args as Record<string, unknown>)[k]]))
      : args;
    return `${toolName}:${JSON.stringify(normalizedArgs)}`;
  }
}
