import type { ServerWebSocket } from "bun";

export type WsData = { type: "push" } | { type: "pty"; sessionId: string };

export interface IBroadcastChannel {
  broadcast(msg: object): void;
}

export class BroadcastChannel implements IBroadcastChannel {
  public clients: Set<ServerWebSocket<WsData>> = new Set();

  broadcast(msg: object): void {
    const text = JSON.stringify(msg);
    for (const ws of this.clients) {
      try {
        ws.send(text);
      } catch {
        // client disconnected
      }
    }
  }
}
