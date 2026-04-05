import { join } from "path";
import { homedir } from "os";
import { mkdirSync, readFileSync, renameSync, existsSync, writeFileSync } from "fs";
import { getDb } from "../db/index.ts";
import { resolveProvider } from "../ai/index.ts";
import { getConfig } from "../config/index.ts";
import { log } from "../logger.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Trigger background extraction every N completed AI turns (assistant messages). */
export const SESSION_MEMORY_EXTRACTION_INTERVAL = 5;

/** Maximum characters of session notes injected into the system prompt.
 *  Notes exceeding this are truncated from the TOP (oldest content removed first). */
export const SESSION_MEMORY_MAX_CHARS = 8_000;

// ─── File paths ───────────────────────────────────────────────────────────────

export function getSessionMemoryPath(taskId: number): string {
  const baseDir =
    process.env.RAILYN_SESSION_MEMORY_DIR ?? join(homedir(), ".config", "railyn", "tasks");
  return join(baseDir, String(taskId), "session-notes.md");
}

// ─── Read / write ─────────────────────────────────────────────────────────────

export function readSessionMemory(taskId: number): string | null {
  const path = getSessionMemoryPath(taskId);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Atomic write via temp file + rename to prevent partial reads. */
export function writeSessionMemory(taskId: number, content: string): void {
  const path = getSessionMemoryPath(taskId);
  const dir = path.slice(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

// ─── Injection helper ─────────────────────────────────────────────────────────

/** Format session notes for injection into the system prompt.
 *  If notes exceed SESSION_MEMORY_MAX_CHARS, truncate from the top (oldest). */
export function formatSessionNotesBlock(notes: string): string {
  const truncated =
    notes.length > SESSION_MEMORY_MAX_CHARS
      ? notes.slice(notes.length - SESSION_MEMORY_MAX_CHARS)
      : notes;
  return `\n\n## Session Notes\n\n${truncated}`;
}

// ─── Extraction prompt ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a note-taking assistant. Based on the conversation history provided, produce a structured markdown notes file that will serve as persistent memory for the AI working on this task.

Write ONLY the notes file — no preamble, no explanation. Use the following sections:

## Open Decisions
List any decisions that were raised but not yet resolved. If none, write "None."

## Key Files Changed
List the files that have been created, modified, or deleted, with one-line descriptions of what changed. If none, write "None."

## Technical Context
Summarize the most important technical facts discovered: architecture patterns, API shapes, constraints, errors encountered and how they were resolved. Be specific and concrete.

## User Preferences Observed
Note any preferences or instructions the user has expressed about style, approach, tooling, or behavior that the AI should remember.

Keep each section concise. Prune stale information from previous notes. This is a full replacement — the output is the complete updated notes file.`;

// ─── Background extraction ────────────────────────────────────────────────────

/** Fire-and-forget: extract session notes from the conversation and write to disk.
 *  Called after every SESSION_MEMORY_EXTRACTION_INTERVAL completed AI turns.
 *  Does not block the main execution loop. */
export function extractSessionMemory(taskId: number): void {
  void _doExtract(taskId);
}

async function _doExtract(taskId: number): Promise<void> {
  try {
    const db = getDb();
    const task = db
      .query<{ model: string | null; conversation_id: number | null }, [number]>(
        "SELECT model, conversation_id FROM tasks WHERE id = ?",
      )
      .get(taskId);
    if (!task?.model) return;

    const config = getConfig();
    let provider;
    try {
      ({ provider } = resolveProvider(task.model, config.providers));
    } catch {
      return; // Can't resolve provider — skip silently
    }

    // Fetch the last ~40 messages for context (enough for extraction, bounded cost)
    const messages = db
      .query<ConversationMessageRow, [number]>(
        `SELECT * FROM conversation_messages
         WHERE task_id = ? AND type IN ('user', 'assistant', 'tool_call', 'tool_result')
         ORDER BY created_at DESC LIMIT 40`,
      )
      .all(taskId)
      .reverse();

    if (messages.length === 0) return;

    // Build a plain-text digest of recent messages for extraction
    const digest = messages
      .map((m) => {
        if (m.type === "user") return `User: ${m.content}`;
        if (m.type === "assistant") return `Assistant: ${m.content}`;
        if (m.type === "tool_call") {
          try {
            const c = JSON.parse(m.content) as { name: string };
            return `Tool call: ${c.name}`;
          } catch { return "Tool call"; }
        }
        if (m.type === "tool_result") return `Tool result: ${m.content.slice(0, 200)}`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

    // Read existing notes to pass as context
    const existingNotes = readSessionMemory(taskId);
    const systemContent = existingNotes
      ? `${EXTRACTION_PROMPT}\n\n---\nPrevious notes (update and prune as needed):\n\n${existingNotes}`
      : EXTRACTION_PROMPT;

    const result = await provider.turn(
      [
        { role: "system", content: systemContent },
        { role: "user", content: `Here is the recent conversation:\n\n${digest}\n\nProduced the updated session notes now.` },
      ],
      {},
    );

    if (result.type === "text" && result.content.trim()) {
      writeSessionMemory(taskId, result.content.trim());
      log("debug", "Session memory extracted and written", { taskId });
    }
  } catch (err) {
    // Background extraction must never crash the engine
    log("debug", `Session memory extraction failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`, { taskId });
  }
}
