import { describe, expect, it } from "vitest";
import { DefaultCopilotSdkAdapter } from "../engine/copilot/session.ts";

/** Minimal fake client that satisfies LoadedCopilotClient. */
function makeFakeClient(stopFn?: () => Promise<void>) {
    return Promise.resolve({
        start: async () => {},
        stop: stopFn ?? (async () => {}),
        ping: async () => {},
        listModels: async () => [],
        createSession: async () => { throw new Error("not implemented"); },
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
