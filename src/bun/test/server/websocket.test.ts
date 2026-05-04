import { describe, test, expect, beforeEach } from "bun:test";
import { WebSocketHandler } from "../../server/websocket.ts";
import { BroadcastChannel } from "../../server/broadcast-channel.ts";
import type { WsData } from "../../server/broadcast-channel.ts";
import type { ServerWebSocket } from "bun";
import type { PtySession } from "../../launch/pty.ts";

// Tracked side-effect accumulators, reset in beforeEach
let sentMessages: string[];
let closeCalls: { code?: number; reason?: string }[];
let writeCalls: string[];
let resizeCalls: { cols: number; rows: number }[];

const makeMockSession = (opts: { exited?: boolean; scrollback?: string } = {}): PtySession => ({
  id: "mock-id",
  exited: opts.exited ?? false,
  scrollback: opts.scrollback ?? "scrollback-data",
  dataListeners: new Set(),
  exitListeners: new Set(),
  write: (text: string) => { writeCalls.push(text); },
  resize: (cols: number, rows: number) => { resizeCalls.push({ cols, rows }); },
  kill: () => {},
  cwd: "/",
  command: "sh",
});

const makePushWs = () =>
  ({
    data: { type: "push" as const },
    send: (msg: string) => { sentMessages.push(msg); },
    close: (code?: number, reason?: string) => { closeCalls.push({ code, reason }); },
  }) as unknown as ServerWebSocket<WsData>;

const makePtyWs = (sessionId: string) =>
  ({
    data: { type: "pty" as const, sessionId },
    send: (msg: string) => { sentMessages.push(msg); },
    close: (code?: number, reason?: string) => { closeCalls.push({ code, reason }); },
  }) as unknown as ServerWebSocket<WsData>;

describe("WebSocketHandler", () => {
  let channel: BroadcastChannel;
  let sessions: Map<string, PtySession>;
  let handler: WebSocketHandler;

  beforeEach(() => {
    sentMessages = [];
    closeCalls = [];
    writeCalls = [];
    resizeCalls = [];
    channel = new BroadcastChannel();
    sessions = new Map();
    handler = new WebSocketHandler(channel, (id) => sessions.get(id));
  });

  // WS-1
  test("push WS open adds client to channel", () => {
    const ws = makePushWs();
    handler.open(ws);
    expect(channel.clients.has(ws)).toBe(true);
  });

  // WS-2
  test("push WS close removes client and broadcast no longer reaches it", () => {
    const ws = makePushWs();
    handler.open(ws);
    handler.close(ws);
    expect(channel.clients.has(ws)).toBe(false);
    channel.broadcast({ hello: "world" });
    expect(sentMessages).toHaveLength(0);
  });

  // WS-3
  test("pty WS open for running session replays scrollback and registers data listener", () => {
    const session = makeMockSession({ scrollback: "old-output" });
    sessions.set("s1", session);
    const ws = makePtyWs("s1");

    handler.open(ws);

    expect(sentMessages).toContain("old-output");
    expect(session.dataListeners.size).toBe(1);
    expect(session.exitListeners.size).toBe(1);
  });

  // WS-4
  test("pty WS open for unknown session closes with 4404", () => {
    const ws = makePtyWs("nonexistent");
    handler.open(ws);
    expect(closeCalls).toEqual([{ code: 4404, reason: "session-not-found" }]);
  });

  // WS-5
  test("pty WS open for exited session replays scrollback only, no data listener", () => {
    const session = makeMockSession({ exited: true, scrollback: "final-output" });
    sessions.set("s2", session);
    const ws = makePtyWs("s2");

    handler.open(ws);

    expect(sentMessages).toContain("final-output");
    expect(session.dataListeners.size).toBe(0);
    expect(session.exitListeners.size).toBe(0);
  });

  // WS-6
  test("pty WS close removes data and exit listeners from session", () => {
    const session = makeMockSession();
    sessions.set("s3", session);
    const ws = makePtyWs("s3");

    handler.open(ws);
    expect(session.dataListeners.size).toBe(1);
    expect(session.exitListeners.size).toBe(1);

    handler.close(ws);
    expect(session.dataListeners.size).toBe(0);
    expect(session.exitListeners.size).toBe(0);
  });

  // WS-7
  test("pty message raw text forwards to session.write", () => {
    const session = makeMockSession();
    sessions.set("s4", session);
    const ws = makePtyWs("s4");

    handler.open(ws);
    handler.message(ws, "hello");

    expect(writeCalls).toEqual(["hello"]);
  });

  // WS-8
  test("pty message resize JSON calls session.resize", () => {
    const session = makeMockSession();
    sessions.set("s5", session);
    const ws = makePtyWs("s5");

    handler.open(ws);
    handler.message(ws, JSON.stringify({ type: "resize", cols: 80, rows: 24 }));

    expect(resizeCalls).toEqual([{ cols: 80, rows: 24 }]);
    expect(writeCalls).toHaveLength(0);
  });

  // WS-9
  test("push channel message is a no-op", () => {
    const ws = makePushWs();
    handler.open(ws);
    expect(() => handler.message(ws, "any")).not.toThrow();
    expect(writeCalls).toHaveLength(0);
    expect(resizeCalls).toHaveLength(0);
  });
});
