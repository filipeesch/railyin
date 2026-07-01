import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — .mjs sibling module imported as an opaque namespace
import { sendWithBusyRetry } from "../../engine/cursor/worker.mjs";
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
