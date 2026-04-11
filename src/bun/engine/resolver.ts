/**
 * Engine resolver — reads the workspace engine config and returns the
 * corresponding ExecutionEngine instance.
 *
 * Call resolveEngine() once at startup and pass the result to the Orchestrator.
 */

import type { ExecutionEngine } from "./types.ts";
import type { LoadedConfig } from "../config/index.ts";
import type { OnTaskUpdated, OnNewMessage } from "../workflow/engine.ts";
import { NativeEngine } from "./native/engine.ts";
import { CopilotEngine } from "./copilot/engine.ts";
import { createDefaultCopilotSdkAdapter } from "./copilot/session.ts";
import { ClaudeEngine } from "./claude/engine.ts";
import { createDefaultClaudeSdkAdapter } from "./claude/adapter.ts";

/**
 * Resolve and instantiate the correct engine based on workspace config.
 *
 * @param config  The loaded workspace config.
 * @param onTaskUpdated  RPC relay callback for task state changes.
 * @param onNewMessage   RPC relay callback for new conversation messages.
 */
export function resolveEngine(
  config: LoadedConfig,
  onTaskUpdated: OnTaskUpdated,
  onNewMessage: OnNewMessage,
): ExecutionEngine {
  const engine = config.engine;

  if (engine.type === "copilot") {
    return new CopilotEngine(
      engine.model,
      onTaskUpdated,
      onNewMessage,
      createDefaultCopilotSdkAdapter(),
    );
  }

  if (engine.type === "claude") {
    return new ClaudeEngine(
      engine.model,
      onTaskUpdated,
      onNewMessage,
      createDefaultClaudeSdkAdapter(),
    );
  }

  return new NativeEngine();
}
