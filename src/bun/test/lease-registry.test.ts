import { describe, expect, it } from "vitest";
import { LeaseRegistry } from "../engine/lease-registry.ts";

describe("LeaseRegistry", () => {
  it("expires inactive leases after timeout", async () => {
    let resolveExpired!: (key: string) => void;
    const expiredPromise = new Promise<string>((resolve) => {
      resolveExpired = resolve;
    });

    const registry = new LeaseRegistry(
      "copilot",
      20,
      async (leaseKey) => {
        resolveExpired(leaseKey);
      },
      () => {},
    );

    registry.touch("copilot:workspace-a:task-1", "running");
    const expiredKey = await expiredPromise;
    // Yield one microtask so the finally{release()} in schedule() can run.
    await Promise.resolve();

    expect(expiredKey).toBe("copilot:workspace-a:task-1");
    expect(registry.getAll()).toHaveLength(0);
  });

  it("refreshes inactivity window on touch", async () => {
    let expireCount = 0;
    let resolveExpired!: () => void;
    const firstExpiry = new Promise<void>((resolve) => {
      resolveExpired = resolve;
    });

    // Use a longer timeout (100ms) so the 30ms intermediate touch
    // is well within the window and not sensitive to CI scheduling delays.
    const registry = new LeaseRegistry(
      "claude",
      100,
      async () => {
        expireCount += 1;
        resolveExpired();
      },
      () => {},
    );

    registry.touch("claude:workspace-a:task-9", "running");

    // Touch at ~30ms — well before the 100ms timeout — to reset the timer.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(expireCount).toBe(0);
    registry.touch("claude:workspace-a:task-9", "waiting_user");

    // Wait for the actual expiry event rather than a fixed sleep.
    await firstExpiry;
    expect(expireCount).toBe(1);
  });

  it("shuts down all active leases and logs timeout fallback", async () => {
    const logs: string[] = [];
    const registry = new LeaseRegistry(
      "copilot",
      1000,
      async () => {},
      (message) => logs.push(message),
    );

    registry.touch("copilot:w1:t1", "running");
    registry.touch("copilot:w1:t2", "waiting_user");

    // The closer takes 20ms but deadline is 5ms → forces timeout log branch.
    await registry.shutdownAll(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      { reason: "app-exit", deadlineMs: 5 },
    );

    expect(registry.getAll()).toHaveLength(0);
    expect(logs.some((line) => line.includes("shutdown requested"))).toBe(true);
    expect(logs.some((line) => line.includes("lease shutdown timed out"))).toBe(true);
  });

  it("accepts 'opencode' as engine type and expires leases correctly (task 7.1)", async () => {
    let resolveExpired!: (key: string) => void;
    const expiredPromise = new Promise<string>((resolve) => {
      resolveExpired = resolve;
    });

    const registry = new LeaseRegistry(
      "opencode",
      20,
      async (leaseKey) => {
        resolveExpired(leaseKey);
      },
      () => {},
    );

    registry.touch("opencode:workspace-a:task-42", "running");
    const expiredKey = await expiredPromise;
    // Yield one microtask so the finally{release()} in schedule() can run.
    await Promise.resolve();

    expect(expiredKey).toBe("opencode:workspace-a:task-42");
    expect(registry.getAll()).toHaveLength(0);
  });
});
