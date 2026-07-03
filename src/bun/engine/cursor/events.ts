/**
 * Cursor SDK event translation — delegates to the shared translate-events.ts module.
 *
 * This file re-exports the canonical implementations from translate-events.ts
 * so that existing imports continue to work without changes.
 *
 * See translate-events.ts for the full implementation and documentation.
 */

export {
  translateCursorMessage,
  normalizeCursorToolResult,
  extractStructuredResult,
  unwrapCursorToolName,
  buildCursorToolDisplay,
  parseUnifiedDiff,
  type CursorSDKMessage,
  type StructuredResult,
} from "./translate-events.ts";
