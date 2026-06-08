# Proposal: Inline Available Boards

## Problem

When the model calls `get_board_summary`, `list_cards`, or `create_card` without a `board_id`, it gets a generic error:

```
Error: board_id is required. Use list_boards to discover available boards.
```

This forces an **extra tool call** to `list_boards` — a wasteful round-trip adding latency and token waste.

## Solution

Include available boards directly in the error message, following the skill tool's pattern:

```
Error: board_id is required. Available boards: Board #1: "Open Spec", Board #2: "Design"
```

## Scope

### Core Feature
- Replace hardcoded error messages in `BoardToolExecutor` with dynamic board listings
- Scope board queries to the current workspace (consistent with `list_boards`)

### Architectural Improvement
- Create `BoardRepository` following the existing repository pattern
- Extract `getBoardWorkspaceKey` from all 4 engines into `BoardRepository`
- Inject `BoardRepository` into engine constructors via the factory pattern

### Out of Scope
- Test coverage (captured in **separate OpenSpec change** `board-repository-tests`)
- Deprecating `WorkspaceRepository.getBoardWorkspaceKey` (future cleanup)
- Extracting `PositionService` to DI (future cleanup)

## Impact

| Area | Files Changed |
|------|---------------|
| New files | `board-repository.ts`, `board-error-format.ts` |
| Executor | `board-tool-executor.ts` |
| Engines | 4 engine files + factory in `index.ts` |
| Orchestrator | 1 file |
| Tests | Multiple (deferred) |
