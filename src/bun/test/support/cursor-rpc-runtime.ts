import { BackendRpcRuntime, createBackendRpcRuntime } from "./backend-rpc-runtime.ts";
import { CursorEngine } from "../../engine/cursor/engine.ts";
import { MockCursorSdkAdapter } from "../cursor/mocks.ts";

/**
 * Creates a backend RPC runtime with the CursorEngine wired to the supplied
 * mock adapter. Tests queue turns on the adapter before driving the runtime.
 */
export function createCursorRpcRuntime(adapter: MockCursorSdkAdapter = new MockCursorSdkAdapter()): BackendRpcRuntime {
    return createBackendRpcRuntime({
        taskModel: "cursor/mock-model",
        createEngine: ({ onTaskUpdated, onNewMessage }) =>
            new CursorEngine(onTaskUpdated, onNewMessage, adapter),
    });
}
