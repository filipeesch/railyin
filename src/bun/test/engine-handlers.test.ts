import { describe, it, expect } from "bun:test";
import { engineHandlers } from "../handlers/engine.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";

const mockCommands = [
  { id: "cmd1", label: "Command One", description: "does something" },
];

const mockOrchestrator = {
  listCommands: async (_taskId: number) => mockCommands,
} as unknown as ExecutionCoordinator;

describe("engineHandlers — EH-1: engine.listCommands returns commands from orchestrator", () => {
  it("returns the command list provided by the orchestrator", async () => {
    const handlers = engineHandlers(mockOrchestrator);
    const result = await handlers["engine.listCommands"]({ taskId: 1 });
    expect(result).toEqual(mockCommands);
  });
});

describe("engineHandlers — EH-2: engine.listCommands returns empty array when orchestrator is null", () => {
  it("returns an empty array when no orchestrator is provided", async () => {
    const handlers = engineHandlers(null);
    const result = await handlers["engine.listCommands"]({ taskId: 1 });
    expect(result).toEqual([]);
  });
});
