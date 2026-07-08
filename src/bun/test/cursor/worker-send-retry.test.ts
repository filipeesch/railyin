import { describe, expect, it, vi } from "vitest";
// @ts-ignore — .mjs sibling module imported as an opaque namespace
import { PersistentBusyError, sendPromptWithRecovery, sendWithBusyRetry } from "../../engine/cursor/worker.mjs";
import { AgentBusyError } from "@cursor/sdk";

function makeAgent(overrides: {
    firstResult?: unknown;
    firstError?: Error;
    secondResult?: unknown;
    secondError?: Error;
}) {
    let callCount = 0;
    const send = vi.fn(async (_prompt: string, _opts?: unknown) => {
        callCount++;
        if (callCount === 1) {
            if (overrides.firstError) throw overrides.firstError;
            return overrides.firstResult ?? { kind: "run" };
        }
        if (overrides.secondError) throw overrides.secondError;
        return overrides.secondResult ?? { kind: "run-retry" };
    });
    return { send };
}

describe("sendWithBusyRetry", () => {
    it("returns result directly when first send succeeds", async () => {
        const agent = makeAgent({ firstResult: { kind: "success" } });
        const result = await sendWithBusyRetry(agent, "my prompt");
        expect(result).toEqual({ kind: "success" });
        expect(agent.send).toHaveBeenCalledTimes(1);
        expect(agent.send).toHaveBeenCalledWith("my prompt");
    });

    it("retries with force:true on AgentBusyError", async () => {
        const agent = makeAgent({
            firstError: new AgentBusyError("Agent already has active run"),
            secondResult: { kind: "forced" },
        });
        const result = await sendWithBusyRetry(agent, "retry-prompt");
        expect(result).toEqual({ kind: "forced" });
        expect(agent.send).toHaveBeenCalledTimes(2);
        expect(agent.send).toHaveBeenNthCalledWith(2, "retry-prompt", { local: { force: true } });
    });

    it("re-throws non-AgentBusyError errors immediately without retry", async () => {
        const networkError = new Error("Network timeout");
        const agent = makeAgent({ firstError: networkError });
        await expect(sendWithBusyRetry(agent, "prompt")).rejects.toThrow("Network timeout");
        expect(agent.send).toHaveBeenCalledTimes(1);
    });

    it("propagates second AgentBusyError without further retry", async () => {
        const agent = makeAgent({
            firstError: new AgentBusyError("busy"),
            secondError: new AgentBusyError("still busy"),
        });
        await expect(sendWithBusyRetry(agent, "prompt")).rejects.toThrow("still busy");
        expect(agent.send).toHaveBeenCalledTimes(2);
    });
});

describe("sendPromptWithRecovery", () => {
    function makeAgent(outcomes: Array<unknown>) {
        const close = vi.fn(async () => {});
        const send = vi.fn(async (_prompt: string, _opts?: unknown) => {
            const next = outcomes.shift();
            if (next instanceof Error) throw next;
            return next ?? { kind: "default" };
        });
        return { send, close };
    }

    it("recreates the same agent id and resends when the force retry stays busy", async () => {
        const resumeAgent = makeAgent([
            new AgentBusyError("busy"),
            new AgentBusyError("still busy"),
        ]);
        const recreatedAgent = makeAgent([{ kind: "recovered" }]);
        const log = vi.fn();
        const Agent = {
            resume: vi.fn(async () => resumeAgent),
            create: vi.fn(async () => recreatedAgent),
        };

        const result = await sendPromptWithRecovery(
            Agent,
            "agent-id-123",
            { apiKey: "k", local: { cwd: "/tmp", customTools: {}, settingSources: ["project"] } },
            "prompt",
            { runId: "run-1", executionId: 11, taskId: 7, conversationId: 9, log },
        );

        expect(result.run).toEqual({ kind: "recovered" });
        expect(result.agent).toBe(recreatedAgent);
        expect(Agent.resume).toHaveBeenCalledWith("agent-id-123", expect.any(Object));
        expect(Agent.create).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-id-123" }));
        expect(resumeAgent.close).toHaveBeenCalledTimes(1);
        expect(recreatedAgent.close).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("cursor_busy_retry_exhausted"),
        );
        expect(log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("cursor_busy_recovery_succeeded"),
        );
    });

    it("fails with a persistent-busy error when the recreated agent is still busy", async () => {
        const resumeAgent = makeAgent([
            new AgentBusyError("busy"),
            new AgentBusyError("still busy"),
        ]);
        const recreatedAgent = makeAgent([
            new AgentBusyError("busy again"),
            new AgentBusyError("still busy again"),
        ]);
        const log = vi.fn();
        const Agent = {
            resume: vi.fn(async () => resumeAgent),
            create: vi.fn(async () => recreatedAgent),
        };

        await expect(sendPromptWithRecovery(
            Agent,
            "agent-id-123",
            { apiKey: "k", local: { cwd: "/tmp", customTools: {}, settingSources: ["project"] } },
            "prompt",
            { runId: "run-2", executionId: 22, taskId: 8, conversationId: 10, log },
        )).rejects.toBeInstanceOf(PersistentBusyError);

        expect(recreatedAgent.close).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("cursor_busy_recovery_failed"),
        );
    });
});
