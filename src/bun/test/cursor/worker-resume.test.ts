import { describe, expect, it, vi } from "vitest";
import { resumeOrCreateAgent } from "../../engine/cursor/resume.ts";

interface StubAgent {
    resume: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
}

function makeAgent(overrides: Partial<{
    resumeResult: unknown;
    resumeError: Error;
    createResult: unknown;
}>): StubAgent {
    const resume = vi.fn(async (_id: string, _opts: unknown) => {
        if (overrides.resumeError) throw overrides.resumeError;
        return overrides.resumeResult ?? { kind: "resumed" };
    });
    const create = vi.fn(async (opts: unknown) => overrides.createResult ?? { kind: "created", opts });
    return { resume, create };
}

describe("resumeOrCreateAgent", () => {
    const baseOptions = {
        apiKey: "test-key",
        model: { id: "claude-sonnet-4-6" },
        local: { cwd: "/work" },
    };

    it("§6.5.2 — calls Agent.resume(agentId, options) and does NOT call Agent.create on success", async () => {
        const agent = makeAgent({ resumeResult: { kind: "resumed", id: "X" } });
        const out = await resumeOrCreateAgent(agent, "agent-id-abc", baseOptions);

        expect(out).toEqual({ kind: "resumed", id: "X" });
        expect(agent.resume).toHaveBeenCalledTimes(1);
        expect(agent.resume).toHaveBeenCalledWith("agent-id-abc", baseOptions);
        expect(agent.create).not.toHaveBeenCalled();
    });

    it("§6.5.3 — falls back to Agent.create({ agentId, ...options }) when Agent.resume throws", async () => {
        const agent = makeAgent({ resumeError: new Error("Agent agent-id-abc not found") });
        const out = await resumeOrCreateAgent(agent, "agent-id-abc", baseOptions);

        expect(agent.resume).toHaveBeenCalledWith("agent-id-abc", baseOptions);
        expect(agent.create).toHaveBeenCalledTimes(1);
        const createArg = agent.create.mock.calls[0]![0] as Record<string, unknown>;
        expect(createArg).toEqual({ ...baseOptions, agentId: "agent-id-abc" });
        expect(out).toMatchObject({ kind: "created" });
    });

    it("falls through directly to Agent.create(options) when no agentId is supplied (no resume attempt)", async () => {
        const agent = makeAgent({});
        const out = await resumeOrCreateAgent(agent, undefined, baseOptions);

        expect(agent.resume).not.toHaveBeenCalled();
        expect(agent.create).toHaveBeenCalledTimes(1);
        // baseOptions forwarded verbatim — no agentId injected when caller omitted it
        expect(agent.create).toHaveBeenCalledWith(baseOptions);
        expect(out).toMatchObject({ kind: "created" });
    });

    it("falls through directly to Agent.create(options) when agentId is an empty string", async () => {
        const agent = makeAgent({});
        await resumeOrCreateAgent(agent, "", baseOptions);
        expect(agent.resume).not.toHaveBeenCalled();
        expect(agent.create).toHaveBeenCalledWith(baseOptions);
    });
});
