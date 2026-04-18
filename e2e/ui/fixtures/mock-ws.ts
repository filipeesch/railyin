/**
 * mock-ws.ts — Intercept the /ws WebSocket connection with page.routeWebSocket().
 *
 * Usage:
 *   const ws = new WsMock(page);
 *   await ws.install();
 *
 *   // Push a server event to the browser
 *   ws.push({ type: "task.updated", payload: task });
 *   ws.pushStreamEvent(event);
 *   ws.pushDone(taskId, executionId);
 *
 *   // Wait until the browser sends a message (e.g. after connecting)
 *   const msg = await ws.nextMessage();
 */

import type { Page } from "@playwright/test";
import type { PushMessage, StreamEvent } from "@shared/rpc-types";

export class WsMock {
    private _page: Page;
    private _server: import("@playwright/test").WebSocketRoute | null = null;
    private _messageQueue: string[] = [];
    private _resolvers: Array<(msg: string) => void> = [];

    constructor(page: Page) {
        this._page = page;
    }

    async install(): Promise<void> {
        await this._page.routeWebSocket("/ws", (ws) => {
            this._server = ws;
            // Drain any messages queued before the connection opened
            for (const msg of this._messageQueue) {
                ws.send(msg);
            }
            this._messageQueue = [];

            ws.onMessage((msg) => {
                const resolver = this._resolvers.shift();
                if (resolver) resolver(msg as string);
            });

            // Don't connect to real server — fully mocked
        });
    }

    /** Send a push message to the browser. Queues if the socket isn't open yet. */
    push(msg: PushMessage): void {
        const text = JSON.stringify(msg);
        if (this._server) {
            this._server.send(text);
        } else {
            this._messageQueue.push(text);
        }
    }

    /** Convenience: push a stream.event message. */
    pushStreamEvent(event: StreamEvent): void {
        this.push({ type: "stream.event", payload: event });
    }

    /** Convenience: push a `done` stream event to close out a fake execution. */
    pushDone(taskId: number, executionId: number, seq = 999): void {
        this.pushStreamEvent({
            taskId,
            executionId,
            seq,
            blockId: `${executionId}-done`,
            type: "done",
            content: "",
            metadata: null,
            parentBlockId: null,
            subagentId: null,
            done: true,
        });
    }

    /** Wait for the browser to send a WebSocket message (e.g. after user action). */
    nextMessage(timeoutMs = 5_000): Promise<string> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("WsMock: timeout waiting for message")), timeoutMs);
            this._resolvers.push((msg) => {
                clearTimeout(timer);
                resolve(msg);
            });
        });
    }
}
