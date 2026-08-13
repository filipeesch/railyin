export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogOptions {
  taskId?: number;
  executionId?: number;
  data?: unknown;
}

export interface Logger {
  log(level: LogLevel, message: string, opts?: LogOptions): void;
}

export const noopLogger: Logger = {
  log() {},
};

/**
 * Write a structured log entry as a single JSON line via console.
 * In production, setupFileLogging() captures console output into
 * `~/.railyn/logs/bun.log`; in dev it prints to the terminal.
 * The legacy `logs` DB table was dropped — logging no longer touches the DB.
 */
export function log(level: LogLevel, message: string, opts?: LogOptions): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    taskId: opts?.taskId ?? null,
    executionId: opts?.executionId ?? null,
    data: opts?.data !== undefined ? opts.data : null,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const realLogger: Logger = {
  log(level, message, opts) {
    log(level, message, opts);
  },
};
