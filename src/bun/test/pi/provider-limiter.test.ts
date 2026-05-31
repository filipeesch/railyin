import { describe, test, expect } from "bun:test";
import { ProviderLimiterRegistry } from "../../engine/pi/provider-limiter.ts";
import { runWithLimiter } from "../../engine/pi/provider-transport.ts";

describe("ProviderLimiterRegistry", () => {
  test("PL-1: acquire returns a release fn, inFlight increments while held, decrements after release", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 2, 5000);

    const release = await registry.acquire("prov");
    expect(registry.snapshot("prov")!.inFlight).toBe(1);
    release();
    expect(registry.snapshot("prov")!.inFlight).toBe(0);
  });

  test("PL-2: FIFO ordering — second acquire waits until first releases, receives slot in order", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 1, 5000);

    const order: string[] = [];
    const release1 = await registry.acquire("prov");
    order.push("acquired-1");

    const waiter2 = registry.acquire("prov").then((r) => {
      order.push("acquired-2");
      return r;
    });

    // Allow microtasks to process — waiter2 should be queued, not yet resolved
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(["acquired-1"]);

    release1();
    const release2 = await waiter2;
    expect(order).toEqual(["acquired-1", "acquired-2"]);
    release2();
  });

  test("PL-3: acquiring more than max_inflight queues — third waiter receives slot when first releases", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 2, 5000);

    const r1 = await registry.acquire("prov");
    const r2 = await registry.acquire("prov");
    expect(registry.snapshot("prov")!.inFlight).toBe(2);
    expect(registry.snapshot("prov")!.queueDepth).toBe(0);

    let resolved = false;
    const waiter3 = registry.acquire("prov").then((r) => {
      resolved = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);
    expect(registry.snapshot("prov")!.queueDepth).toBe(1);

    r1(); // release first slot — third waiter should get it
    const r3 = await waiter3;
    expect(resolved).toBe(true);
    expect(registry.snapshot("prov")!.inFlight).toBe(2); // r2 + r3

    r2();
    r3();
    expect(registry.snapshot("prov")!.inFlight).toBe(0);
  });

  test("PL-4: abort signal during wait rejects with AbortError and does not occupy a slot", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 1, 5000);

    const r1 = await registry.acquire("prov");

    const ac = new AbortController();
    const waiter = registry.acquire("prov", ac.signal);

    await new Promise((r) => setTimeout(r, 5));
    ac.abort();

    await expect(waiter).rejects.toMatchObject({ name: "AbortError" });

    r1();
    expect(registry.snapshot("prov")!.inFlight).toBe(0);
    expect(registry.snapshot("prov")!.queueDepth).toBe(0);
  });

  test("PL-5: queue_timeout_ms triggers rejection when queue wait exceeds the timeout", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 1, 50); // 50ms timeout

    const r1 = await registry.acquire("prov");
    const waiter = registry.acquire("prov");

    await expect(waiter).rejects.toThrow("queue timeout");

    r1();
  });

  test("PL-6: tryAcquire returns a release fn when free; returns null when saturated", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 1, 5000);

    const r1 = registry.tryAcquire("prov");
    expect(r1).not.toBeNull();
    expect(registry.snapshot("prov")!.inFlight).toBe(1);

    const r2 = registry.tryAcquire("prov");
    expect(r2).toBeNull();

    r1!();
    expect(registry.snapshot("prov")!.inFlight).toBe(0);
  });

  test("PL-7: snapshot() returns correct inFlight/queueDepth without mutating state", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 3, 5000);

    const r1 = await registry.acquire("prov");
    const r2 = await registry.acquire("prov");

    const snap = registry.snapshot("prov")!;
    expect(snap.inFlight).toBe(2);
    expect(snap.queueDepth).toBe(0);
    expect(snap.maxInflight).toBe(3);

    // Calling snapshot again should not change state
    const snap2 = registry.snapshot("prov")!;
    expect(snap2.inFlight).toBe(2);

    r1();
    r2();
  });

  test("PL-8: runWithLimiter — if fn throws, inFlight returns to 0", async () => {
    const registry = new ProviderLimiterRegistry();
    registry.register("prov", 2, 5000);

    await expect(
      runWithLimiter(registry, "prov", undefined, async () => {
        expect(registry.snapshot("prov")!.inFlight).toBe(1);
        throw new Error("task failed");
      }),
    ).rejects.toThrow("task failed");

    expect(registry.snapshot("prov")!.inFlight).toBe(0);
  });
});
