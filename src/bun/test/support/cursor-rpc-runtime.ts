import { BackendRpcRuntime, createBackendRpcRuntime } from "./backend-rpc-runtime.ts";
import { CursorEngine } from "../../engine/cursor/engine.ts";
import { MockCursorSdkAdapter } from "../cursor/mocks.ts";
import type { McpRegistryPool } from "../../mcp/registry-pool.ts";

/**
 * Creates a backend RPC runtime with the CursorEngine wired to the supplied
 * mock adapter. Tests queue turns on the adapter before driving the runtime.
 */
export function createCursorRpcRuntime(
    adapter: MockCursorSdkAdapter = new MockCursorSdkAdapter(),
    registryPool?: McpRegistryPool,
): BackendRpcRuntime {
    return createBackendRpcRuntime({
        taskModel: "cursor/mock-model",
        createEngine: ({ onTaskUpdated }) =>
            new CursorEngine(onTaskUpdated, adapter),
        registryPool,
    });
}
