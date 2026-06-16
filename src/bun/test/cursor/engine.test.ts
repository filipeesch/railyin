import { describe, expect, it } from "vitest";
import { cursorAgentIdForConversation } from "@bun/engine/cursor/engine";
import { MockCursorSdkAdapter, token } from "./mocks";
import { createCursorRpcRuntime } from "@bun/test/support/cursor-rpc-runtime";

describe("CursorEngine — deterministic agentId forwarding (§6.5.1)", () => {
    it("forwards cursorAgentIdForConversation(taskId, conversationId) as runConfig.agentId on every run", async () => {
        const adapter = new MockCursorSdkAdapter()
            .queueTurn({ steps: [token("first")] })
            .queueTurn({ steps: [token("second")] });
        const runtime = createCursorRpcRuntime(adapter);

        try {
            const { taskId, conversationId } = await runtime.createTask();

            const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "ping 1" });
            await runtime.recorder.waitForStreamDone(first.executionId);

            const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "ping 2" });
            await runtime.recorder.waitForStreamDone(second.executionId);

            const expected = cursorAgentIdForConversation(taskId, conversationId);

            expect(adapter.trace.runConfigs).toHaveLength(2);
            expect(adapter.trace.runConfigs[0]!.agentId).toBe(expected);
            expect(adapter.trace.runConfigs[1]!.agentId).toBe(expected);
        } finally {
            runtime.cleanup();
        }
    });
});

describe("cursorAgentIdForConversation — determinism (§6.5.1 supporting)", () => {
    it("returns the same UUID for the same (taskId, conversationId)", () => {
        const a = cursorAgentIdForConversation(42, 7);
        const b = cursorAgentIdForConversation(42, 7);
        expect(a).toBe(b);
    });

    it("task-scoped ids ignore conversationId — same task with different conversations yields the same UUID", () => {
        const a = cursorAgentIdForConversation(42, 7);
        const b = cursorAgentIdForConversation(42, 99);
        expect(a).toBe(b);
    });

    it("different task ids produce different UUIDs", () => {
        const a = cursorAgentIdForConversation(42, 7);
        const b = cursorAgentIdForConversation(43, 7);
        expect(a).not.toBe(b);
    });

    it("detached conversations key on conversationId — different conversations yield different UUIDs", () => {
        const a = cursorAgentIdForConversation(null, 100);
        const b = cursorAgentIdForConversation(null, 101);
        expect(a).not.toBe(b);
    });

    it("returns a valid RFC 4122 v5 UUID", () => {
        const id = cursorAgentIdForConversation(1, 2);
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("task-scoped id is independent of any detached conversation id", () => {
        const taskScoped = cursorAgentIdForConversation(5, 999);
        const detached = cursorAgentIdForConversation(null, 5);
        expect(taskScoped).not.toBe(detached);
    });
});
