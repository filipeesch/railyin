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
}

const sessions = new Map<string, PtySession>();

export function createPtySession(command: string, cwd: string): PtySession {
    const id = randomUUID();

    // Placeholder so the closure below can reference `session`
    const session: PtySession = {
        id, cwd, command, scrollback: "",
        dataListeners: new Set(),
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
            exit(_terminal, _exitCode) {
                sessions.delete(id);
            },
        },
        onExit() {
            // Belt-and-suspenders removal when subprocess exits
            sessions.delete(id);
        },
    });

    session.proc = proc;
    session.terminal = proc.terminal;
    return session;
}

export function getPtySession(id: string): PtySession | undefined {
    return sessions.get(id);
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
