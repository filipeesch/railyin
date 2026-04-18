import { randomUUID } from "crypto";

const dec = new TextDecoder();
const MAX_SCROLLBACK = 65536;

export interface PtySession {
    id: string;
    terminal: ReturnType<typeof Bun.spawn>["terminal"];
    proc: ReturnType<typeof Bun.spawn>;
    cwd: string;
    command: string;
    /** Circular buffer of recent output for replaying to new WS connections */
    scrollback: string;
    /** Active per-WS data listeners */
    dataListeners: Set<(chunk: string) => void>;
    /** Called once when the process exits, so WS connections can be closed */
    exitListeners: Set<(exitCode: number) => void>;
    /** True once the underlying process has exited */
    exited: boolean;
}

const sessions = new Map<string, PtySession>();

function markExited(session: PtySession, exitCode: number) {
    if (session.exited) return; // already handled
    session.exited = true;
    const msg = `\r\n\x1b[2m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
    session.scrollback += msg;
    if (session.scrollback.length > MAX_SCROLLBACK) {
        session.scrollback = session.scrollback.slice(session.scrollback.length - MAX_SCROLLBACK);
    }
    // Notify any open WebSocket listeners (writes exit text to the terminal)
    for (const cb of session.dataListeners) {
        try { cb(msg); } catch { /* ignore */ }
    }
    // Tell each WS connection the process is done so the frontend can close the session
    for (const cb of session.exitListeners) {
        try { cb(exitCode); } catch { /* ignore */ }
    }
    session.exitListeners.clear();
}

export function createPtySession(command: string, cwd: string): PtySession {
    const id = randomUUID();

    // Placeholder so the closure below can reference `session`
    const session: PtySession = {
        id, cwd, command, scrollback: "",
        dataListeners: new Set(),
        exitListeners: new Set(),
        exited: false,
        terminal: undefined,
        proc: undefined!,
    };
    sessions.set(id, session);

    const proc = Bun.spawn(["/bin/sh", "-c", command], {
        cwd,
        env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
        terminal: {
            cols: 120,
            rows: 30,
            data(_terminal, data) {
                const chunk = dec.decode(data);
                session.scrollback += chunk;
                if (session.scrollback.length > MAX_SCROLLBACK) {
                    session.scrollback = session.scrollback.slice(session.scrollback.length - MAX_SCROLLBACK);
                }
                for (const cb of session.dataListeners) {
                    try { cb(chunk); } catch { /* ignore */ }
                }
            },
            exit(_terminal, exitCode) {
                markExited(session, exitCode ?? 0);
            },
        },
        onExit(proc) {
            markExited(session, proc.exitCode ?? 0);
        },
    });

    session.proc = proc;
    session.terminal = proc.terminal;
    return session;
}

export function getPtySession(id: string): PtySession | undefined {
    return sessions.get(id);
}

export function killPtySession(id: string): boolean {
    const session = sessions.get(id);
    if (!session) return false;
    if (!session.exited) {
        try { session.proc.kill(); } catch { /* ignore */ }
    }
    sessions.delete(id);
    return true;
}

export function killAllPtySessions(): void {
    for (const session of sessions.values()) {
        try {
            session.proc.kill();
        } catch {
            // ignore errors during shutdown
        }
    }
    sessions.clear();
}
