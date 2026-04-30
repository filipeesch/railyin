import { describe, test, expect } from "bun:test";
import { BroadcastChannel } from "../../server/broadcast-channel.ts";

const makeMockWs = (throws = false) => {
  const calls: string[] = [];
  return {
    calls,
    ws: {
      data: { type: "push" as const },
      send: (msg: string) => {
        if (throws) throw new Error("WebSocket closed");
        calls.push(msg);
      },
    },
  };
};

describe("BroadcastChannel", () => {
  test("BC-1 — serializes and sends message to all clients", () => {
    const channel = new BroadcastChannel();
    const a = makeMockWs();
    const b = makeMockWs();
    channel.clients.add(a.ws as never);
    channel.clients.add(b.ws as never);

    const msg = { event: "task.updated", id: 42 };
    channel.broadcast(msg);

    expect(a.calls).toEqual([JSON.stringify(msg)]);
    expect(b.calls).toEqual([JSON.stringify(msg)]);
  });

  test("BC-2 — swallows error from disconnected client", () => {
    const channel = new BroadcastChannel();
    const throwing = makeMockWs(true);
    channel.clients.add(throwing.ws as never);

    expect(() => channel.broadcast({ event: "ping" })).not.toThrow();
  });

  test("BC-3 — healthy client still receives message when another throws", () => {
    const channel = new BroadcastChannel();
    const throwing = makeMockWs(true);
    const healthy = makeMockWs();
    channel.clients.add(throwing.ws as never);
    channel.clients.add(healthy.ws as never);

    const msg = { event: "stream.event" };
    channel.broadcast(msg);

    expect(healthy.calls).toEqual([JSON.stringify(msg)]);
  });
});
