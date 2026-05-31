import type { EngineEvent } from "../types.ts";
import { COMMON_TOOL_NAMES, buildCommonToolDisplay } from "../common-tools.ts";
import { humanizeToolName } from "../tool-display.ts";
import type {
  Part,
  StepFinishPart,
  TextPart,
  ReasoningPart,
  ToolPart,
  EventPermissionAsked,
  EventSessionError,
  EventSessionStatus,
} from "@opencode-ai/sdk/v2";

/**
 * Translate an OpenCode Part (from message.part.updated) into zero or more EngineEvents.
 * Returns an empty array for part types that don't map to an engine event.
 */
export function translatePart(part: Part): EngineEvent[] {
  switch (part.type) {
    case "text":
      return translateTextPart(part as TextPart);
    case "reasoning":
      return translateReasoningPart(part as ReasoningPart);
    case "tool":
      return translateToolPart(part as ToolPart);
    case "step-finish":
      return translateStepFinishPart(part as StepFinishPart);
    default:
      return [];
  }
}

function translateTextPart(part: TextPart): EngineEvent[] {
  if (!part.text) return [];
  return [{ type: "token", content: part.text }];
}

function translateReasoningPart(part: ReasoningPart): EngineEvent[] {
  if (!part.text) return [];
  return [{ type: "reasoning", content: part.text }];
}

function translateToolPart(part: ToolPart): EngineEvent[] {
  const state = part.state;

  if (state.status === "running") {
    const display = COMMON_TOOL_NAMES.has(part.tool)
      ? buildCommonToolDisplay(part.tool, state.input as Record<string, unknown>)
      : { label: humanizeToolName(part.tool) };
    return [{
      type: "tool_start",
      name: part.tool,
      arguments: JSON.stringify(state.input),
      callId: part.callID,
      display,
    }];
  }

  if (state.status === "completed") {
    return [{
      type: "tool_result",
      name: part.tool,
      result: state.output,
      callId: part.callID,
    }];
  }

  if (state.status === "error") {
    return [{
      type: "tool_result",
      name: part.tool,
      result: state.error,
      callId: part.callID,
      isError: true,
    }];
  }

  return [];
}

function translateStepFinishPart(part: StepFinishPart): EngineEvent[] {
  const { input, output } = part.tokens;
  if (!input && !output) return [];
  return [{ type: "usage", inputTokens: input, outputTokens: output }];
}

/** Translate a permission.asked event into a shell_approval EngineEvent. */
export function translatePermissionAsked(event: EventPermissionAsked, executionId: number): EngineEvent {
  const patterns = event.properties.patterns ?? [];
  const command = patterns.length > 0 ? patterns.join(", ") : event.properties.permission;
  return { type: "shell_approval", command, executionId };
}

/** Translate a session.error event into an EngineEvent error. */
export function translateSessionError(event: EventSessionError): EngineEvent {
  const err = event.properties.error;
  let message = "OpenCode session error";
  if (err && "message" in err && typeof err.message === "string") {
    message = err.message;
  }
  return { type: "error", message, fatal: true };
}

/** Translate a session.status event into a status EngineEvent if meaningful. */
export function translateSessionStatus(event: EventSessionStatus): EngineEvent | null {
  const status = event.properties.status;
  if (!status) return null;
  return { type: "status", message: String(status) };
}
