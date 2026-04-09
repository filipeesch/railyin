/**
 * Task 3.6: Session memory for the native engine.
 *
 * Owns: session note file I/O, extraction scheduling, formatting.
 *
 * The implementation already lives in workflow/session-memory.ts as a
 * standalone module. This file re-exports it at the canonical
 * engine/native/session-memory path so the engine tree is self-contained.
 */

export {
  SESSION_MEMORY_EXTRACTION_INTERVAL,
  SESSION_MEMORY_MAX_CHARS,
  getSessionMemoryPath,
  readSessionMemory,
  writeSessionMemory,
  formatSessionNotesBlock,
  extractSessionMemory,
} from "../../workflow/session-memory.ts";
