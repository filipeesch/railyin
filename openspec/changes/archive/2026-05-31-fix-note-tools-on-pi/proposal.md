## Why

Note tools (`create_note`, `list_notes`, `update_note`) are silently unavailable to Pi engine agents on the first execution of any new conversation. The Pi SDK's `tools` parameter acts as a global allowlist — tools absent from it are dropped even when registered as `customTools`. The `defaultSessionFactory` builds this allowlist as a hardcoded string array that omits all three note tool names, so agents calling note tools on new sessions receive no response and stall or skip the operation entirely.

## What Changes

- **Fix `defaultSessionFactory`**: Replace the hardcoded tool name array with a dynamic derivation from the built `piTools` list, consistent with how session-reuse and child-session already work.
- **Add `buildToolAllowlist()` helper**: Extract a shared function in `pi/constants.ts` so all three allowlist construction sites (session creation, session reuse, child-session) share one expression and cannot diverge.
- **Update three call sites**: `defaultSessionFactory` (engine.ts ~L125), `setActiveToolsByName` (engine.ts ~L741), and `child-session.ts` (~L115) all use the new helper.
- **Fix `update_note` empty-content validation**: Align `update_note` with `create_note` — reject empty or whitespace-only `content` with a validation error instead of silently persisting a blank note.

## Capabilities

### New Capabilities

_(none — this is a bug fix)_

### Modified Capabilities

- `task-note-tools`: The requirement "Note tools are available in all four engines" was not being met for Pi on first session creation. This change brings Pi into compliance with the existing spec.
- `pi-engine`: The session creation contract is tightened — the `tools` allowlist is now derived from the active tool set rather than maintained as a parallel hardcoded list.

## Impact

- **`src/bun/engine/pi/constants.ts`**: New `buildToolAllowlist()` helper added.
- **`src/bun/engine/pi/engine.ts`**: Two call sites updated (session factory + session reuse).
- **`src/bun/engine/pi/child-session.ts`**: One call site updated.
- **`src/bun/engine/common-tools.ts`**: `update_note` branch gains empty-content guard (`.trim()` + rejection), consistent with `create_note`.
- No DB changes, no API changes, no frontend changes.
- Note tools continue to be excluded from child/delegate sessions (intentional by design).
