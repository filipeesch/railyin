import { describe, test, expect } from "bun:test";
import { NotificationService } from "../../server/notifications.ts";
import type { IBroadcastChannel } from "../../server/broadcast-channel.ts";

const makeChannel = () => {
  const calls: object[] = [];
  const channel: IBroadcastChannel = { broadcast: (msg) => calls.push(msg) };
  return { channel, calls };
};

describe("NotificationService", () => {
  test("NS-1 — onError is a no-op (A2: stream.error push dropped)", () => {
    const { channel, calls } = makeChannel();
    const svc = new NotificationService(channel);
    svc.onError(42, 7, 3, "boom");
    expect(calls).toEqual([]);
  });

  test("NS-2 — notifyTaskUpdated broadcasts task.updated", () => {
    const { channel, calls } = makeChannel();
    const svc = new NotificationService(channel);
    const task = { id: 1, title: "Test task" } as any;
    svc.notifyTaskUpdated(task);
    expect(calls).toEqual([{ type: "task.updated", payload: task }]);
  });

  test("NS-3 — notifyWorkflowReloaded broadcasts workflow.reloaded", () => {
    const { channel, calls } = makeChannel();
    const svc = new NotificationService(channel);
    svc.notifyWorkflowReloaded();
    expect(calls).toEqual([{ type: "workflow.reloaded", payload: {} }]);
  });

  test("NS-5 — notifyChatSessionUpdated broadcasts chatSession.updated", () => {
    const { channel, calls } = makeChannel();
    const svc = new NotificationService(channel);
    const session = { id: 5, name: "my-session" } as any;
    svc.notifyChatSessionUpdated(session);
    expect(calls).toEqual([{ type: "chatSession.updated", payload: session }]);
  });

  test("NS-6 — broadcastConfigError broadcasts config.error", () => {
    const { channel, calls } = makeChannel();
    const svc = new NotificationService(channel);
    const details = { reason: "invalid yaml" };
    svc.broadcastConfigError(details);
    expect(calls).toEqual([{ type: "config.error", payload: details }]);
  });
});
