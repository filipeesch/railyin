import type { ServerWebSocket } from "bun";
import type { BroadcastChannel, WsData } from "./broadcast-channel.ts";
import type { PtySession } from "../launch/pty.ts";

export class WebSocketHandler {
  private readonly ptyDataListeners = new WeakMap<ServerWebSocket<WsData>, (chunk: string) => void>();
  private readonly ptyExitListeners = new WeakMap<ServerWebSocket<WsData>, (code: number) => void>();

  constructor(
    private readonly channel: BroadcastChannel,
    private readonly getPtySession: (id: string) => PtySession | undefined,
  ) {}

  open = (ws: ServerWebSocket<WsData>): void => {
    if (ws.data.type === "pty") {
      const session = this.getPtySession(ws.data.sessionId);
      if (!session) {
        ws.close(4404, "session-not-found");
        return;
      }
      if (session.scrollback) {
        try { ws.send(session.scrollback); } catch { /* ignore */ }
      }
      if (session.exited) {
        return;
      }
      const listener = (chunk: string) => {
        try { ws.send(chunk); } catch { /* ws closed */ }
      };
      const exitListener = (_code: number) => {
        try { ws.close(4000, "process-exited"); } catch { /* ignore */ }
      };
      session.dataListeners.add(listener);
      session.exitListeners.add(exitListener);
      this.ptyDataListeners.set(ws, listener);
      this.ptyExitListeners.set(ws, exitListener);
    } else {
      this.channel.clients.add(ws);
    }
  }

  close = (ws: ServerWebSocket<WsData>): void => {
    if (ws.data.type === "push") {
      this.channel.clients.delete(ws);
    } else {
      const session = this.getPtySession((ws.data as { type: "pty"; sessionId: string }).sessionId);
      const listener = this.ptyDataListeners.get(ws);
      const exitListener = this.ptyExitListeners.get(ws);
      if (session && listener) session.dataListeners.delete(listener);
      if (session && exitListener) session.exitListeners.delete(exitListener);
      this.ptyDataListeners.delete(ws);
      this.ptyExitListeners.delete(ws);
    }
  }

  message = (ws: ServerWebSocket<WsData>, msg: string | Buffer): void => {
    if (ws.data.type !== "pty") return;
    const session = this.getPtySession(ws.data.sessionId);
    if (session) {
      const text = typeof msg === "string" ? msg : msg.toString("utf8");
      try {
        const parsed = JSON.parse(text);
        if (parsed?.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
          session.terminal?.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch { /* not JSON — treat as raw input */ }
      session.terminal?.write(text);
    }
  }
}
