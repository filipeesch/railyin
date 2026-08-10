import { describe, expect, it, vi } from "vitest";
import { PersistentBusyError, sendPromptWithRecovery, sendWithBusyRetry } from "../../engine/cursor/recovery.ts";
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

    it("retries when busy error comes as a plain Error message", async () => {
        const agent = makeAgent({
            firstError: new Error("Agent 13f9e45e-019e-5dfe-a9cb-04d036157036 already has active run"),
            secondResult: { kind: "forced-from-message" },
        });
        const result = await sendWithBusyRetry(agent, "prompt");
        expect(result).toEqual({ kind: "forced-from-message" });
        expect(agent.send).toHaveBeenCalledTimes(2);
        expect(agent.send).toHaveBeenNthCalledWith(2, "prompt", { local: { force: true } });
    });

    it("retries when busy error comes as status 409", async () => {
        const conflictError = new Error("Conflict");
        Object.assign(conflictError, { status: 409 });
        const agent = makeAgent({
            firstError: conflictError,
            secondResult: { kind: "forced-from-status" },
        });
        const result = await sendWithBusyRetry(agent, "prompt");
        expect(result).toEqual({ kind: "forced-from-status" });
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

    /** Build a lifecycle whose `acquire` pops the next agent from `agents`. */
    function makeLifecycle(agents: Array<{ send: ReturnType<typeof vi.fn>; close?: ReturnType<typeof vi.fn> }>) {
        const release = vi.fn(async () => {});
        const evict = vi.fn(async () => {});
        const acquire = vi.fn(async () => {
            const agent = agents.shift();
            if (!agent) throw new Error("no agent queued");
            return agent;
        });
        return { lifecycle: { acquire, release, evict }, release, evict };
    }

    it("recreates the same agent id and resends when the force retry stays busy", async () => {
        const initialAgent = makeAgent([
            new AgentBusyError("busy"),
            new AgentBusyError("still busy"),
        ]);
        const recreatedAgent = makeAgent([{ kind: "recovered" }]);
        const log = vi.fn();
        const { lifecycle, release, evict } = makeLifecycle([initialAgent, recreatedAgent]);

        const result = await sendPromptWithRecovery(
            lifecycle as Parameters<typeof sendPromptWithRecovery>[0],
            "prompt",
            { runId: "run-1", executionId: 11, taskId: 7, conversationId: 9, log },
        );

        expect(result.run).toEqual({ kind: "recovered" });
        expect(result.agent).toBe(recreatedAgent);
        expect(lifecycle.acquire).toHaveBeenCalledTimes(2);
        // The busy initial agent is returned to the pool (released), not closed.
        expect(release).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledWith(initialAgent);
        expect(evict).not.toHaveBeenCalled();
        expect(recreatedAgent.close).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("cursor_busy_retry_exhausted"),
        );
    });

    it("fails with a persistent-busy error when the recreated agent is still busy", async () => {
        const initialAgent = makeAgent([
            new AgentBusyError("busy"),
            new AgentBusyError("still busy"),
        ]);
        const recreatedAgent = makeAgent([
            new AgentBusyError("busy again"),
            new AgentBusyError("still busy again"),
        ]);
        const log = vi.fn();
        const { lifecycle, evict } = makeLifecycle([initialAgent, recreatedAgent]);

        await expect(sendPromptWithRecovery(
            lifecycle as Parameters<typeof sendPromptWithRecovery>[0],
            "prompt",
            { runId: "run-2", executionId: 22, taskId: 8, conversationId: 10, log },
        )).rejects.toBeInstanceOf(PersistentBusyError);

        // The unusable recreated agent is evicted (closed), not kept warm.
        expect(evict).toHaveBeenCalledTimes(1);
        expect(evict).toHaveBeenCalledWith(recreatedAgent);
        expect(log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("cursor_busy_recovery_failed"),
        );
    });

    it("recovers when the initial acquire path throws a busy-like error before send", async () => {
        const recreatedAgent = makeAgent([{ kind: "recovered-after-acquire-failure" }]);
        const log = vi.fn();
        const lifecycle = {
            acquire: vi.fn().mockRejectedValueOnce(new Error("Agent 13f9e45e-019e-5dfe-a9cb-04d036157036 already has active run"))
                .mockResolvedValueOnce(recreatedAgent),
            release: vi.fn(async () => {}),
            evict: vi.fn(async () => {}),
        };

        const result = await sendPromptWithRecovery(
            lifecycle as Parameters<typeof sendPromptWithRecovery>[0],
            "prompt",
            { runId: "run-3", executionId: 33, taskId: 9, conversationId: 11, log },
        );

        expect(result.run).toEqual({ kind: "recovered-after-acquire-failure" });
        expect(result.agent).toBe(recreatedAgent);
        expect(lifecycle.acquire).toHaveBeenCalledTimes(2);
        expect(lifecycle.evict).not.toHaveBeenCalled();
        expect(recreatedAgent.close).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("resume_or_create"),
        );
    });
});