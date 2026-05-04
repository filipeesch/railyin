import { randomUUID } from "crypto";
import { spawn as ptySpawn } from "node-pty";
import { getDefaultShell, getShellArgs } from "../utils/platform.ts";

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

export function createPtySession(command: string, cwd: string): PtySession {
  const id = randomUUID();

  const shell = getDefaultShell();
  const args = getShellArgs(command);

  const ipty = ptySpawn(shell, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });

  const session: PtySession = {
    id,
    cwd,
    command,
    scrollback: "",
    dataListeners: new Set(),
    exitListeners: new Set(),
    exited: false,
    write(data: string) { ipty.write(data); },
    resize(cols: number, rows: number) { ipty.resize(cols, rows); },
    kill() { ipty.kill(); },
  };

  ipty.onData((chunk: string) => {
    session.scrollback += chunk;
    if (session.scrollback.length > MAX_SCROLLBACK) {
      session.scrollback = session.scrollback.slice(session.scrollback.length - MAX_SCROLLBACK);
    }
    for (const cb of session.dataListeners) {
      try { cb(chunk); } catch { /* ignore */ }
    }
  });

  ipty.onExit(({ exitCode }) => {
    markExited(session, exitCode ?? 0);
  });

  sessions.set(id, session);
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
