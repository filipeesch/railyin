/**
 * toolCardDisplay.ts — Pure, testable helpers for the domain tool-call renderers.
 *
 * These functions are extracted from the legacy ToolCallBlock.vue display
 * branches (truncation, diff stats, status icons) plus the canonical tool-name
 * family mapping from src/bun/engine/tool-display.ts so the new
 * components/chat/tool-call-renderers/*.vue stay thin and unit-testable.
 */
import type { FileDiffPayload } from "@shared/rpc-types";

/** Marker appended when tool output exceeds the truncation limit. */
export const TRUNCATED_MARKER = "\n…[truncated]";

/**
 * Truncate tool output at `max` chars (default 800, ToolCallBlock.vue:79-82).
 * Text at or under the limit is returned unchanged; past the limit the head is
 * kept and the "…[truncated]" marker appended.
 */
export function truncateToolOutput(text: string, max = 800): string {
  return text.length > max ? text.slice(0, max) + TRUNCATED_MARKER : text;
}

/**
 * Sum added/removed line counts across diff payloads (ToolCallBlock.vue:108-113).
 * Missing fields are treated as zero.
 */
export function computeDiffStats(diffPayloads: FileDiffPayload[]): { added: number; removed: number } {
  return (diffPayloads ?? []).reduce(
    (sums, p) => ({
      added: sums.added + (p.added ?? 0),
      removed: sums.removed + (p.removed ?? 0),
    }),
    { added: 0, removed: 0 },
  );
}

/** CopilotKit slot status values (ToolCallStatus enum: inProgress|executing|complete). */
export type ToolSlotStatus = "inProgress" | "executing" | "complete";

export interface ToolStatusIcon {
  icon: string;
  style?: { color: string };
}

/**
 * Map a slot status to a PrimeIcons class + color.
 *
 * The wire's `status` is "complete" for errored tool calls too (RESEARCH
 * Pitfall 3) — error detection is result-content based, so callers pass
 * `isError` computed from the result. Error takes precedence over complete.
 */
export function toolStatusToIcon(status: ToolSlotStatus, isError = false): ToolStatusIcon {
  if (isError) return { icon: "pi-times-circle", style: { color: "#dc2626" } };
  if (status === "complete") return { icon: "pi-check-circle", style: { color: "#16a34a" } };
  return { icon: "pi-spin pi-spinner" };
}

/**
 * Detect a failed tool call from RESULT CONTENT only — the wire's slot
 * `status` is "complete" for errored calls too (RESEARCH Pitfall 3), so the
 * error state must be derived from what the engine wrote back. Conservative:
 * JSON shapes engines actually emit (isError, error, success:false, error-ish
 * status) plus raw text opening with a recognizable failure marker.
 */
export function isErrorResult(result: string | undefined): boolean {
  if (!result) return false;
  try {
    const parsed = JSON.parse(result) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      if (parsed.isError === true) return true;
      if (typeof parsed.error === "string" && parsed.error.trim().length > 0) return true;
      if (parsed.success === false) return true;
      if (typeof parsed.status === "string" && /^(error|failed|failure)$/i.test(parsed.status.trim())) return true;
    }
  } catch {
    // not JSON — fall through to the raw-text heuristic
  }
  // WR-03: bare `error`/`failed`/`failure` prefixes false-positive on
  // SUCCESSFUL tool output (grep -i error, `ls error*`, a script echoing
  // "exit code 0"). Only a leading `exit code N` with a NON-ZERO code is a
  // reliable text marker; structured failures are caught by the JSON branch.
  return /^\s*exit code [1-9]\d*/i.test(result);
}

/**
 * Derive FileDiffPayload[] from a tool call's raw args for the write/edit/
 * patch families. The AG-UI wire carries NO display.contentType hint and the
 * removed file_diff feature no longer produces payloads, so the diff body must
 * be reconstructed from what the engine passed as arguments: a diff-shaped
 * args object passes through, `content` becomes a write payload with an added
 * line count, `old_string`/`new_string` become an edit payload, and anything
 * else degrades to a minimal write payload (FileDiff renders "no diff
 * available" for hunk-less payloads).
 */
export function buildDiffPayloadsFromArgs(args: unknown): FileDiffPayload[] {
  const a = normalizeArgs(args);
  const path = primaryPath(a);
  if (!path) return [];

  if (Array.isArray(a.diffPayloads)) {
    const list = (a.diffPayloads as unknown[]).filter(isDiffPayload);
    if (list.length > 0) return list as FileDiffPayload[];
  }
  if (isDiffPayload(a)) return [a as unknown as FileDiffPayload];

  if (typeof a.content === "string") {
    return [{ operation: "write_file", path, added: countLines(a.content), removed: 0 }];
  }
  if (typeof a.old_string === "string" || typeof a.new_string === "string") {
    const removed = typeof a.old_string === "string" ? countLines(a.old_string) : 0;
    const added = typeof a.new_string === "string" ? countLines(a.new_string) : 0;
    return [{ operation: "edit_file", path, added, removed }];
  }
  return [{ operation: "write_file", path, added: 0, removed: 0 }];
}

/**
 * Line count for a diff stat — IN-04: `content.split("\n").length` counts a
 * trailing newline as an extra line ("line1\nline2\n" → 3). Trim one trailing
 * newline before splitting; empty strings count zero.
 */
function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

/** Parse a tool call's args into a plain object, tolerating JSON-string deltas. */
function normalizeArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

/** Primary file path from engine-variant arg keys. */
function primaryPath(a: Record<string, unknown>): string {
  const v = a.path ?? a.file_path ?? a.filePath ?? a.target;
  return typeof v === "string" && v.length > 0 ? v : "";
}

/** True when the object already carries a FileDiffPayload shape. */
function isDiffPayload(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const op = o.operation;
  return (
    typeof op === "string" &&
    ["write_file", "edit_file", "patch_file", "delete_file", "rename_file"].includes(op) &&
    typeof o.path === "string"
  );
}

/**
 * Canonical tool-name families → renderer slot keys.
 *
 * Mirrors the verified family list in src/bun/engine/tool-display.ts:19-49
 * (bash|run|run_in_terminal → shell output; read|write|edit|apply_patch →
 * file changes; subagent → delegate summary). Slot names declared in
 * RailyinChat (05-04) match `tool-call-${toolCallName}` per the SDK's
 * template-literal slot type — this map resolves the family for renderer
 * selection, not the slot name itself.
 */
export const CANONICAL_TOOL_SLOTS: Record<string, string> = {
  bash: "shell",
  run: "shell",
  run_in_terminal: "shell",
  read: "file",
  read_file: "file",
  view: "file",
  write: "file",
  write_file: "file",
  create: "file",
  edit: "file",
  multiedit: "file",
  apply_patch: "file",
  subagent: "delegate",
};

/** Resolve a tool call name to its canonical family key, or null for unknown/MCP tools (default card, D-04). */
export function slotForToolCall(name: string): string | null {
  return CANONICAL_TOOL_SLOTS[name] ?? null;
}
