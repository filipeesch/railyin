import { afterEach, describe, expect, it, mock } from "bun:test";
import { LeaseRegistry } from "../engine/lease-registry.ts";

afterEach(() => {
  mock.restore();
});

describe("LeaseRegistry", () => {
  it("expires inactive leases after timeout", async () => {
    let expiredKey = "";
    const registry = new LeaseRegistry(
      "copilot",
      20,
      async (leaseKey) => {
        expiredKey = leaseKey;
      },
      () => { },
    );

    registry.touch("copilot:workspace-a:task-1", "running");
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(expiredKey).toBe("copilot:workspace-a:task-1");
    expect(registry.getAll()).toHaveLength(0);
  });

  it("refreshes inactivity window on touch", async () => {
    let expireCount = 0;
    const registry = new LeaseRegistry(
      "claude",
      25,
      async () => {
        expireCount += 1;
      },
      () => { },
    );

    registry.touch("claude:workspace-a:task-9", "running");
    await new Promise((resolve) => setTimeout(resolve, 15));
    registry.touch("claude:workspace-a:task-9", "waiting_user");
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(expireCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(expireCount).toBe(1);
  });

  it("shuts down all active leases and logs timeout fallback", async () => {
    const logs: string[] = [];
    const registry = new LeaseRegistry(
      "copilot",
      1000,
      async () => { },
      (message) => logs.push(message),
    );

    registry.touch("copilot:w1:t1", "running");
    registry.touch("copilot:w1:t2", "waiting_user");

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
});
