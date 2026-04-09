/**
 * Task 3.7: Sub-agent execution for the native engine.
 *
 * Owns: runSubExecution() — runs an in-memory child agent inside spawn_agent.
 * No DB records are created; returns a plain-text result string.
 *
 * runSubExecution is intentionally co-located with the main agentic loop
 * because it is mutually recursive with runExecution (loop.ts). This file
 * re-exports it from the loop module so callers can import from the semantically
 * correct path — engine/native/sub-agent — without a circular dependency.
 */

// runSubExecution is an internal function and not directly exported from
// workflow/engine.ts. The spawn_agent tool handler (workflow/tools.ts) calls
// it via a callback supplied by runExecution. This file serves as the
// architectural boundary marker: when Task 8.1 extracts runExecution into
// loop.ts, runSubExecution will be exported from loop.ts and re-exported here.

// Placeholder until Task 8.1 completes the full extraction.
export type { };
