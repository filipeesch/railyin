import type { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";

export interface StartupMaintenanceOptions {
  /** Target for the consistent backup snapshot. Defaults to `<dbPath>.backup`. */
  backupPath?: string;
  /** Full VACUUM runs when free space exceeds this many bytes. Default 64 MiB. */
  freeSpaceThresholdBytes?: number;
  /** ...or when free space exceeds this fraction of the file. Default 0.1 (10%). */
  freeSpaceRatioThreshold?: number;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

const DEFAULT_FREE_SPACE_THRESHOLD_BYTES = 64 * 1024 * 1024;
const DEFAULT_FREE_SPACE_RATIO_THRESHOLD = 0.1;

const defaultLog = (msg: string): void => console.log(msg);
const defaultWarn = (msg: string): void => console.warn(msg);

/**
 * Boot-time database maintenance: a consistent `VACUUM INTO` backup on every
 * startup plus threshold-gated compaction that reclaims free pages left by
 * rows deleted during the previous session (conversations, stream events, ...).
 *
 * Phase order is orchestrated by the caller:
 *   1. `backup()`  — before migrations (true pre-change rollback point)
 *   2. migrations
 *   3. `compact()` — after migrations (also reclaims migration-freed pages)
 *
 * Both phases are best-effort: failures (e.g. `SQLITE_BUSY` while another
 * server instance holds the write lock) are logged and swallowed so startup
 * never crashes or blocks on maintenance. In-memory databases are skipped.
 */
export class StartupMaintenance {
  private readonly backupPath: string;
  private readonly freeSpaceThresholdBytes: number;
  private readonly freeSpaceRatioThreshold: number;
  private readonly log: (msg: string) => void;
  private readonly warn: (msg: string) => void;

  constructor(
    private readonly db: Database,
    private readonly dbPath: string,
    opts: StartupMaintenanceOptions = {},
  ) {
    this.backupPath = opts.backupPath ?? `${dbPath}.backup`;
    this.freeSpaceThresholdBytes = opts.freeSpaceThresholdBytes ?? DEFAULT_FREE_SPACE_THRESHOLD_BYTES;
    this.freeSpaceRatioThreshold = opts.freeSpaceRatioThreshold ?? DEFAULT_FREE_SPACE_RATIO_THRESHOLD;
    this.log = opts.log ?? defaultLog;
    this.warn = opts.warn ?? defaultWarn;
  }

  /** True for file-backed databases; in-memory DBs (dev/tests) skip maintenance. */
  private get enabled(): boolean {
    return this.dbPath !== ":memory:";
  }

  /**
   * Writes a consistent, compacted snapshot to `<dbPath>.backup`.
   * `VACUUM INTO` includes all committed data (even uncheckpointed WAL rows)
   * and fails if the target already exists, so a stale snapshot is removed
   * first. Never throws.
   */
  backup(): void {
    if (!this.enabled) return;
    try {
      if (existsSync(this.backupPath)) rmSync(this.backupPath, { force: true });
      const quoted = this.backupPath.replace(/'/g, "''");
      this.db.exec(`VACUUM INTO '${quoted}'`);
      this.log(`[db] Backup created: ${this.backupPath}`);
    } catch (err) {
      this.warn(`[db] Backup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Checkpoints (and truncates) the WAL, then runs a full `VACUUM` when the
   * free space in the file is significant — above `freeSpaceThresholdBytes`
   * OR above `freeSpaceRatioThreshold` of the file. Otherwise logs
   * "nothing to reclaim" and skips. Never throws.
   */
  compact(): void {
    if (!this.enabled) return;
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (err) {
      this.warn(`[db] WAL checkpoint failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    try {
      const pageSize = this.db.query<{ page_size: number }, []>("PRAGMA page_size").get()!.page_size;
      const pageCount = this.db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
      const freelistCount = this.db.query<{ freelist_count: number }, []>("PRAGMA freelist_count").get()!.freelist_count;
      const freeBytes = freelistCount * pageSize;
      const totalBytes = pageCount * pageSize;
      const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0;

      if (freeBytes < this.freeSpaceThresholdBytes && freeRatio < this.freeSpaceRatioThreshold) {
        this.log(
          `[db] Maintenance: nothing to reclaim (${(freeBytes / 1_048_576).toFixed(1)} MiB free of ${(totalBytes / 1_048_576).toFixed(1)} MiB)`,
        );
        return;
      }

      this.db.exec("VACUUM");
      this.log(
        `[db] Maintenance: reclaimed ${(freeBytes / 1_048_576).toFixed(1)} MiB (${(freeRatio * 100).toFixed(0)}% free)`,
      );
    } catch (err) {
      this.warn(`[db] Maintenance VACUUM skipped (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
