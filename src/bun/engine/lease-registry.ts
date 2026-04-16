import type { EngineLeaseMetadata, EngineLeaseState, EngineShutdownOptions } from "./types.ts";

type LeaseEntry = {
  metadata: EngineLeaseMetadata;
  idleTimer: ReturnType<typeof setTimeout>;
};

type Logger = (message: string, payload?: Record<string, unknown>) => void;

export class LeaseRegistry {
  private readonly entries = new Map<string, LeaseEntry>();

  constructor(
    private readonly engine: "copilot" | "claude",
    private readonly idleTimeoutMs: number,
    private readonly onExpire: (leaseKey: string, metadata: EngineLeaseMetadata) => Promise<void>,
    private readonly logger: Logger = (message, payload) => {
      if (payload) console.log(message, payload);
      else console.log(message);
    },
  ) { }

  touch(leaseKey: string, state?: EngineLeaseState): EngineLeaseMetadata {
    const now = Date.now();
    const existing = this.entries.get(leaseKey);
    if (!existing) {
      const metadata: EngineLeaseMetadata = {
        leaseKey,
        engine: this.engine,
        lastActivityAt: now,
        state: state ?? "running",
      };
      const entry: LeaseEntry = {
        metadata,
        idleTimer: this.schedule(leaseKey),
      };
      this.entries.set(leaseKey, entry);
      this.logger(`[${this.engine}] lease created`, { leaseKey, state: metadata.state });
      return metadata;
    }

    clearTimeout(existing.idleTimer);
    existing.idleTimer = this.schedule(leaseKey);
    existing.metadata.lastActivityAt = now;
    if (state) existing.metadata.state = state;
    return { ...existing.metadata };
  }

  setState(leaseKey: string, state: EngineLeaseState): void {
    const existing = this.entries.get(leaseKey);
    if (!existing) return;
    existing.metadata.state = state;
  }

  release(leaseKey: string, reason: "manual" | "expired" | "shutdown" = "manual"): void {
    const existing = this.entries.get(leaseKey);
    if (!existing) return;
    clearTimeout(existing.idleTimer);
    this.entries.delete(leaseKey);
    this.logger(`[${this.engine}] lease released`, { leaseKey, reason });
  }

  get(leaseKey: string): EngineLeaseMetadata | undefined {
    const entry = this.entries.get(leaseKey);
    return entry ? { ...entry.metadata } : undefined;
  }

  getAll(): EngineLeaseMetadata[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.metadata }));
  }

  async shutdownAll(
    closer: (leaseKey: string, metadata: EngineLeaseMetadata) => Promise<void>,
    options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 },
  ): Promise<void> {
    const leases = this.getAll();
    if (leases.length === 0) return;

    this.logger(`[${this.engine}] shutdown requested`, {
      leaseCount: leases.length,
      reason: options.reason,
      deadlineMs: options.deadlineMs ?? 3_000,
    });

    const perLease = leases.map(async (metadata) => {
      this.setState(metadata.leaseKey, "closing");
      const closePromise = closer(metadata.leaseKey, metadata);
      const deadlineMs = options.deadlineMs ?? 3_000;
      await Promise.race([
        closePromise,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            this.logger(`[${this.engine}] lease shutdown timed out`, {
              leaseKey: metadata.leaseKey,
              deadlineMs,
            });
            resolve();
          }, deadlineMs);
        }),
      ]);
      this.release(metadata.leaseKey, "shutdown");
    });

    await Promise.all(perLease);
  }

  private schedule(leaseKey: string): ReturnType<typeof setTimeout> {
    return setTimeout(async () => {
      const entry = this.entries.get(leaseKey);
      if (!entry) return;
      const ageMs = Date.now() - entry.metadata.lastActivityAt;
      if (ageMs < this.idleTimeoutMs) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = this.schedule(leaseKey);
        return;
      }

      this.logger(`[${this.engine}] lease expired`, {
        leaseKey,
        ageMs,
        timeoutMs: this.idleTimeoutMs,
      });

      entry.metadata.state = "closing";
      try {
        await this.onExpire(leaseKey, { ...entry.metadata });
      } catch (err) {
        this.logger(`[${this.engine}] lease expiry close failed`, {
          leaseKey,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.release(leaseKey, "expired");
      }
    }, this.idleTimeoutMs);
  }
}
