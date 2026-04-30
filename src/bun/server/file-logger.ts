import { homedir } from "os";
import { mkdirSync, renameSync, createWriteStream } from "fs";
import { join } from "path";

export function setupFileLogging(logDir?: string): { restore(): void } {
  const dir = logDir ?? join(homedir(), ".railyn", "logs");
  const logFile = join(dir, "bun.log");

  mkdirSync(dir, { recursive: true });
  try { renameSync(logFile, logFile + ".prev"); } catch { /* first run */ }

  const logStream = createWriteStream(logFile, { flags: "a" });

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origErr = console.error.bind(console);

  const write = (prefix: string, args: unknown[]) => {
    const line = `[${new Date().toISOString()}] ${prefix} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a, null, 2)).join(" ")}\n`;
    logStream.write(line);
  };

  console.log = (...a) => { origLog(...a); write("INFO ", a); };
  console.warn = (...a) => { origWarn(...a); write("WARN ", a); };
  console.error = (...a) => { origErr(...a); write("ERROR", a); };

  console.log("[railyin] Log started. pid:", process.pid, "execPath:", process.execPath, "PATH:", process.env.PATH);

  return {
    restore() {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
    },
  };
}
