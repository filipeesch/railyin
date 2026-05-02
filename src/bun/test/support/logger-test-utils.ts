import type { Logger, LogLevel, LogOptions } from "../../logger.ts";

export interface SpyLogCall {
  level: LogLevel;
  message: string;
  opts?: LogOptions;
}

export interface SpyLogger extends Logger {
  calls: SpyLogCall[];
  reset(): void;
}

export function makeSpyLogger(): SpyLogger {
  const spy: SpyLogger = {
    calls: [],
    log(level: LogLevel, message: string, opts?: LogOptions): void {
      spy.calls.push({ level, message, opts });
    },
    reset(): void {
      spy.calls.length = 0;
    },
  };
  return spy;
}
