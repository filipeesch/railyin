/**
 * decisionInterview.ts — Pure, testable helpers for the DecisionInterviewPanel.
 *
 * The panel wires conversation-store state and component props into these
 * plain-data functions so the visibility / answered / stale / dismissal logic
 * can be unit-tested without a Vue component harness. This mirrors the existing
 * `utils/decisionRequest.ts` pattern (SOLID: single responsibility per helper;
 * the component stays a thin orchestration layer).
 */
import type { ConversationMessage } from "@shared/rpc-types";

/** Latest persisted `decision_request_prompt` message id for a conversation, or null. */
export function latestPromptId(messages: ConversationMessage[], conversationId: number): number | null {
  let found: number | null = null;
  for (const m of messages) {
    if (m.conversationId !== conversationId) continue;
    if (m.type === "decision_request_prompt") found = m.id;
  }
  return found;
}

/**
 * True when a user message exists with an id greater than the given prompt id.
 * Id-based (not array-index-based) so the check survives reloads, dropped WS
 * pushes, and any future reordering of the message list.
 */
export function hasUserMessageAfterPrompt(
  messages: ConversationMessage[],
  conversationId: number,
  promptId: number,
): boolean {
  for (const m of messages) {
    if (m.conversationId !== conversationId) continue;
    if (m.type === "user" && m.id > promptId) return true;
  }
  return false;
}

/**
 * True when a persisted interview is stale: a `decision_request_prompt` exists
 * but the conversation has clearly moved past it (the task/session is no longer
 * awaiting input and no live pages are streaming). Guards against raced or
 * legacy data resurfacing an answered interview even when the answer message
 * predates the terminal prompt (early-submit race).
 */
export function isInterviewStale(
  executionState: string | null,
  hasLivePages: boolean,
  hasPersistedPrompt: boolean,
): boolean {
  if (!hasPersistedPrompt) return false;
  if (hasLivePages) return false;
  return executionState !== "waiting_user" && executionState !== "running";
}

/**
 * Stable key identifying the current interview episode. A live streaming
 * execution wins over a persisted prompt (a new execution always means a new
 * episode); otherwise the latest prompt id identifies the episode.
 */
export function episodeKey(liveExecutionId: number | null, latestPromptIdValue: number | null): string | null {
  if (liveExecutionId != null) return `exec:${liveExecutionId}`;
  if (latestPromptIdValue != null) return `prompt:${latestPromptIdValue}`;
  return null;
}

/** True when the stored dismissal key matches the current episode key. */
export function isDismissedEpisode(storedKey: string | null, currentKey: string | null): boolean {
  if (storedKey == null || currentKey == null) return false;
  return storedKey === currentKey;
}

/**
 * Migrate a dismissal keyed by a live execution to its persisted prompt key when
 * the terminal `decision_request_prompt` arrives. Without this, dismissing an
 * interview mid-stream (`exec:<id>` key) would resurface the same interview after
 * the drawer reopens, because the persisted episode is keyed `prompt:<promptId>`.
 */
export function migrateDismissalKey(
  storedKey: string | null,
  liveExecutionId: number | null,
  promptId: number,
): string | null {
  if (storedKey == null || liveExecutionId == null) return storedKey;
  if (storedKey === `exec:${liveExecutionId}`) return `prompt:${promptId}`;
  return storedKey;
}

/**
 * Clamp a resized panel height. The resize grip sits on the panel's TOP edge and
 * the panel's bottom is fixed in the drawer flow, so dragging UP (negative delta)
 * grows the panel and dragging DOWN shrinks it.
 */
export function computeResizeHeight(startHeight: number, delta: number, minHeight: number, maxHeight: number): number {
  return Math.min(Math.max(startHeight - delta, minHeight), maxHeight);
}
