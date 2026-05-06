import { randomUUID } from "crypto";

const dec = new TextDecoder();
const MAX_SCROLLBACK = 65536;

export interface PtySession {
  id: string;
  cwd: string;
  command: string;
  scrollback: string;
  dataListeners: Set<(chunk: string) => void>;
  exitListeners: Set<(exitCode: number) => void>;
  exited: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

const sessions = new Map<string, PtySession>();

function markExited(session: PtySession, exitCode: number) {
  if (session.exited) return;
  session.exited = true;
  const msg = `\r\n\x1b[2m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
  session.scrollback += msg;
  if (session.scrollback.length > MAX_SCROLLBACK) {
    session.scrollback = session.scrollback.slice(session.scrollback.length - MAX_SCROLLBACK);
  }
  for (const cb of session.dataListeners) {
    try { cb(msg); } catch { /* ignore */ }
  }
  for (const cb of session.exitListeners) {
    try { cb(exitCode); } catch { /* ignore */ }
  }
  session.exitListeners.clear();
}

/**
 * Spawn a PTY session using Bun's native terminal API.
 * Bun uses openpty() on macOS/Linux and ConPTY on Windows — no external dependency needed.
 *
 * @param args - Full argv for the process, e.g. ["/bin/zsh"] for interactive or
 *               ["/bin/zsh", "-c", "npm run dev"] for a one-shot command.
 */
export function createPtySession(args: string[], cwd: string): PtySession {
  const id = randomUUID();
  let _proc: ReturnType<typeof Bun.spawn> | undefined;

  const session: PtySession = {
    id,
    cwd,
    command: args.join(" "),
    scrollback: "",
    dataListeners: new Set(),
    exitListeners: new Set(),
    exited: false,
    write(data) { _proc?.terminal?.write(data); },
    resize(cols, rows) { _proc?.terminal?.resize(cols, rows); },
    kill() { _proc?.kill(); },
  };
  sessions.set(id, session);

  _proc = Bun.spawn(args, {
    cwd,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    terminal: {
      cols: 120,
      rows: 30,
      data(_t, data) {
        const chunk = dec.decode(data);
        session.scrollback += chunk;
        if (session.scrollback.length > MAX_SCROLLBACK) {
          session.scrollback = session.scrollback.slice(session.scrollback.length - MAX_SCROLLBACK);
        }
        for (const cb of session.dataListeners) {
          try { cb(chunk); } catch { /* ignore */ }
        }
      },
      exit(_t, exitCode) {
        markExited(session, exitCode ?? 0);
      },
    },
    onExit(p) {
      markExited(session, p.exitCode ?? 0);
    },
  });

  return session;
}

export function getPtySession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function killPtySession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  if (!session.exited) {
    try { session.kill(); } catch { /* ignore */ }
  }
  sessions.delete(id);
  return true;
}

export function killAllPtySessions(): void {
  for (const session of sessions.values()) {
    try {
      session.kill();
    } catch {
      // ignore errors during shutdown
    }
  }
  sessions.clear();
}
