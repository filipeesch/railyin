import { describe, expect, it } from "vitest";
import { DefaultCopilotSdkAdapter } from "../engine/copilot/session.ts";

/** Minimal fake session that satisfies LoadedCopilotSession. */
function makeFakeSession(disconnectFn?: () => Promise<void>) {
    return {
        send: async () => {},
        on: () => () => {},
        abort: async () => {},
        disconnect: disconnectFn ?? (async () => {}),
        rpc: { compaction: { compact: async () => {} } },
    };
}

/** Minimal fake client that satisfies LoadedCopilotClient. */
function makeFakeClient(stopFn?: () => Promise<void>, sessionOverride?: object) {
    return Promise.resolve({
        start: async () => {},
        stop: stopFn ?? (async () => {}),
        ping: async () => {},
        listModels: async () => [],
        createSession: async () => sessionOverride ?? makeFakeSession(),
        resumeSession: async () => { throw new Error("not implemented"); },
    });
}

/** Reach into the private taskCliPool for white-box assertion. */
function pool(adapter: DefaultCopilotSdkAdapter): Map<string, { activeSessions: number; clientPromise: Promise<unknown> }> {
    return (adapter as unknown as { taskCliPool: Map<string, { activeSessions: number; clientPromise: Promise<unknown> }> }).taskCliPool;
}

describe("DefaultCopilotSdkAdapter — eviction guard (Bug A)", () => {
    it("A1: suppresses eviction when activeSessions > 0 and retouches the lease", async () => {
        const adapter = new DefaultCopilotSdkAdapter(undefined, 20);
        pool(adapter).set("session-a1", { clientPromise: makeFakeClient(), activeSessions: 1 });

        adapter.touchLease("session-a1", "running");
        await new Promise((r) => setTimeout(r, 60));

        // Entry should still be present — eviction was suppressed and lease was retouched.
        expect(pool(adapter).has("session-a1")).toBe(true);

        // Clean up: clear activeSessions so the next expiry evicts cleanly.
        pool(adapter).get("session-a1")!.activeSessions = 0;
        await new Promise((r) => setTimeout(r, 60));
    });

    it("A2: proceeds with eviction when activeSessions = 0", async () => {
        let stopped = false;
        const adapter = new DefaultCopilotSdkAdapter(undefined, 20);
        pool(adapter).set("session-a2", {
            clientPromise: makeFakeClient(async () => { stopped = true; }),
            activeSessions: 0,
        });

        adapter.touchLease("session-a2", "running");
        await new Promise((r) => setTimeout(r, 60));

        expect(pool(adapter).has("session-a2")).toBe(false);
        expect(stopped).toBe(true);
    });

    it("A3: onBeforeEvict callbacks are awaited before pool entry is removed", async () => {
        const order: string[] = [];
        const adapter = new DefaultCopilotSdkAdapter(undefined, 20);
        pool(adapter).set("session-a3", {
            clientPromise: makeFakeClient(async () => { order.push("stop"); }),
            activeSessions: 0,
        });

        adapter.onBeforeEvict("session-a3", async () => { order.push("before-evict"); });
        adapter.touchLease("session-a3", "running");
        await new Promise((r) => setTimeout(r, 60));

        expect(order).toEqual(["before-evict", "stop"]);
        expect(pool(adapter).has("session-a3")).toBe(false);
    });

    it("A4: 5-second deadline enforced — slow callback does not block eviction indefinitely", async () => {
        // Use a fast 50ms deadline (third constructor param) so the test doesn't take 5s.
        const adapter = new DefaultCopilotSdkAdapter(undefined, 20, 50);
        let stopCalled = false;
        pool(adapter).set("session-a4", {
            clientPromise: makeFakeClient(async () => { stopCalled = true; }),
            activeSessions: 0,
        });

        let callbackCompleted = false;
        // Register a callback that takes longer than the 50ms deadline.
        adapter.onBeforeEvict("session-a4", async () => {
            await new Promise((r) => setTimeout(r, 500));
            callbackCompleted = true;
        });

        const start = Date.now();
        adapter.touchLease("session-a4", "running");
        // Wait for the 20ms lease + 50ms deadline + a bit of slack.
        await new Promise((r) => setTimeout(r, 150));

        // Eviction should have proceeded even though the callback did not finish.
        expect(pool(adapter).has("session-a4")).toBe(false);
        expect(stopCalled).toBe(true);
        // The slow callback had not completed when eviction ran.
        expect(callbackCompleted).toBe(false);
        // Total elapsed should be well under 500ms (the callback's own sleep).
        expect(Date.now() - start).toBeLessThan(400);
    });

    it("A5: unsubscribing removes the callback so it does not fire on eviction", async () => {
        let called = false;
        const adapter = new DefaultCopilotSdkAdapter(undefined, 20);
        pool(adapter).set("session-a5", { clientPromise: makeFakeClient(), activeSessions: 0 });

        const unsub = adapter.onBeforeEvict("session-a5", async () => { called = true; });
        unsub(); // unsubscribe before eviction fires

        adapter.touchLease("session-a5", "running");
        await new Promise((r) => setTimeout(r, 60));

        expect(called).toBe(false);
        expect(pool(adapter).has("session-a5")).toBe(false);
    });
});

describe("DefaultCopilotSdkAdapter — session lifecycle counters (Bug A regression guards)", () => {
    it("A6: activeSessions increments when createSession is called", async () => {
        const adapter = new DefaultCopilotSdkAdapter(undefined, 60_000);
        const sessionId = "session-a6";
        // Seed the pool directly so no real CLI is spawned.
        pool(adapter).set(sessionId, { clientPromise: makeFakeClient(), activeSessions: 0 });

        expect(pool(adapter).get(sessionId)!.activeSessions).toBe(0);
        await adapter.createSession({ sessionId, systemMessage: undefined, model: "mock" });
        expect(pool(adapter).get(sessionId)!.activeSessions).toBe(1);
    });

    it("A7: activeSessions decrements when the session disconnects", async () => {
        let innerDisconnected = false;
        const adapter = new DefaultCopilotSdkAdapter(undefined, 60_000);
        const sessionId = "session-a7";
        pool(adapter).set(sessionId, {
            clientPromise: makeFakeClient(undefined, makeFakeSession(async () => { innerDisconnected = true; })),
            activeSessions: 0,
        });

        const session = await adapter.createSession({ sessionId, systemMessage: undefined, model: "mock" });
        expect(pool(adapter).get(sessionId)!.activeSessions).toBe(1);

        await session.disconnect();
        expect(pool(adapter).get(sessionId)!.activeSessions).toBe(0);
        expect(innerDisconnected).toBe(true);
    });
});
