import { BackendRpcRuntime, createBackendRpcRuntime } from "./backend-rpc-runtime.ts";
import { CursorEngine } from "../../engine/cursor/engine.ts";
import { createMockCursorSdkAdapter, MockCursorSdkAdapter } from "../cursor/mocks.ts";

export type CursorMockMessage = { type: "assistant" | "thinking" | "tool_call" | "status"; content?: string };

/**
 * Creates a backend RPC runtime with the CursorEngine for integration testing.
 *
 * The mock adapter simulates Cursor SDK behavior, allowing tests to verify
 * that the engine correctly transforms SDK events into EngineEvent types.
 */
export function createCursorRpcRuntime(messages: CursorMockMessage[] = []): BackendRpcRuntime {
    const adapter = createMockCursorSdkAdapter(messages);
    return createBackendRpcRuntime({
        taskModel: "cursor/mock-model",
        createEngine: ({ onTaskUpdated, onNewMessage }) =>
            new CursorEngine(onTaskUpdated, onNewMessage, adapter),
    });
}

/**
 * Creates a backend RPC runtime with a custom adapter.
 * Useful for white-box testing of specific scenarios.
 */
export function createCursorRpcRuntimeWithAdapter(adapter: MockCursorSdkAdapter): BackendRpcRuntime {
    return createBackendRpcRuntime({
        taskModel: "cursor/mock-model",
        createEngine: ({ onTaskUpdated, onNewMessage }) =>
            new CursorEngine(onTaskUpdated, onNewMessage, adapter),
    });
}
