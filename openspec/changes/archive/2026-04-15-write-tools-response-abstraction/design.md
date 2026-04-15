## Context

The current write-tool diff flow is split across multiple layers:

- Native workflow path emits structured `file_diff` directly from tool execution.
- Copilot path emits `tool_result` first, then orchestrator infers write tools via `WRITE_TOOLS` and parses arguments to synthesize `file_diff`.
- Stream rendering and persisted rendering are not symmetric, causing regressions where live tool cards lose rich diff details.

This architecture is brittle because write-tool semantics are encoded in shared orchestrator logic rather than in engine adapters that own tool schema translation.

## Goals / Non-Goals

**Goals:**
- Establish a structured, engine-agnostic contract for file changes as part of `tool_result`.
- Move write-tool parsing and mapping into each engine implementation.
- Make orchestrator transport/persistence logic independent of tool names.
- Ensure live streaming and persisted timeline use the same diff data model.
- Preserve backward compatibility for existing conversations and legacy `file_diff` rows.

**Non-Goals:**
- Replacing all existing conversation storage in one migration step.
- Rewriting unrelated stream batching/tree behavior.
- Guaranteeing hunk-level precision for every third-party tool where upstream SDK does not expose patch detail.

## Decisions

### D1: Add structured file-change payload on `EngineEvent.tool_result`
`tool_result` will carry an optional `writtenFiles` field.

Proposed shape:
- `writtenFiles: WrittenFile[]`
- `WrittenFile` aligned with shared diff model: `path`, `operation`, `added`, `removed`, optional `to_path`, optional `is_new`, optional `hunks`.

Rationale:
- Keeps correlation trivial (same `tool_result` + `callId`).
- Keeps engine-specific complexity in adapters.
- Lets UI render from one canonical payload.

Alternative considered:
- `writtenPaths: string[]` only. Rejected as too lossy and forces upper layers to reconstruct diffs.

### D2: Engines own translation from tool output to `writtenFiles`
- Copilot adapter translates `create/edit/apply_patch` argument/result shapes.
- Claude adapter translates available tool activity for custom/common tools and built-in tool metadata when present.
- Native workflow path maps existing write-tool diff output into `writtenFiles`.

Rationale:
- Avoids centralized `WRITE_TOOLS` registry.
- New engines (or SDK tool renames) require only local adapter updates.

### D3: Orchestrator becomes file-change transport and persistence layer
- Remove tool-name based write inference from orchestrator.
- Consume `event.writtenFiles` directly during `tool_result` handling.
- Persist/relay file changes in a consistent path and emit stream events with stable parent linkage to the same tool call.

Rationale:
- Reduces cross-layer coupling and duplicate parsing.
- Eliminates class of regressions caused by mismatched heuristics.

### D4: UI reads structured diff payload directly in both live and persisted modes
- `ToolCallGroup` and `StreamBlockNode` consume the same structured payload.
- Keep legacy fallback parsing only during transition window.
- Prefer canonical structured payload when both legacy and new representations exist.

Rationale:
- One UX path lowers maintenance cost.
- Removes placeholder/live-only degradation.

## Risks / Trade-offs

- [Claude built-in tools may not always expose full hunks] → Allow partial `WrittenFile` entries (counts/path without hunks) and gracefully degrade render.
- [Dual-format migration complexity] → Keep temporary fallback for legacy `file_diff` rows and remove in follow-up after validation.
- [Payload size growth in tool_result metadata] → Keep per-file payload compact; rely on optional hunks and truncation strategy when required.
- [Contract drift between `WrittenFile` and `FileDiffPayload`] → Reuse/alias shared types rather than defining parallel structures.

## Migration Plan

1. Extend shared engine types with `tool_result.writtenFiles`.
2. Implement adapter translation in Copilot + Claude + native paths.
3. Update orchestrator to consume `writtenFiles` and stop using `WRITE_TOOLS` inference.
4. Update live stream renderer to display structured diffs consistently.
5. Keep legacy fallback parsing for historical data and in-flight compatibility.
6. Validate with mixed historical/new conversations, then remove deprecated fallback path.

## Open Questions

- Should `writtenFiles` fully replace persisted `file_diff` messages, or should `file_diff` remain as a normalized storage projection for now?
- What maximum hunk payload size should be allowed before truncating to summary mode?
- For Claude built-in tools, which SDK message fields can be relied on for deterministic file-change extraction across versions?
