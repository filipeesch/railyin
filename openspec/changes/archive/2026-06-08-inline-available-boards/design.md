# Design: Inline Available Boards + BoardRepository

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        index.ts (composition root)               │
│                                                                  │
│  boardRepo = new BoardRepository(db)                             │
│                                                                  │
│  Engine factories receive boardRepo:                              │
│    copilot:  () => new CopilotEngine(..., boardRepo)             │
│    claude:   () => new ClaudeEngine(..., boardRepo)              │
│    opencode: () => new OpenCodeEngine(..., boardRepo)            │
│    pi:       () => new PiEngine(..., boardRepo)                  │
│                                                                  │
│  orchestrator receives boardRepo → BoardToolExecutor             │
└──────────────────────────────────────────────────────────────────┘
```

## New Components

### BoardRepository (`src/bun/db/board-repository.ts`)

```typescript
export interface IBoardRepository {
  listByWorkspace(workspaceKey: string): Array<{ id: number; name: string }>;
  getById(id: number): { id: number; name: string; workspaceKey: string } | null;
  exists(id: number): boolean;
  getWorkspaceKey(boardId: number): string | null;
}

export class BoardRepository implements IBoardRepository {
  constructor(private readonly db: Database) {}
  
  listByWorkspace(workspaceKey: string) { /* ... */ }
  getById(id: number) { /* ... */ }
  exists(id: number) { /* ... */ }
  getWorkspaceKey(boardId: number) { /* ... */ }
}
```

Follows the same pattern as `WorkspaceRepository`, `NoteRepository`, etc. — constructor-injected DB, no lazy imports.

### Error Format Function (`src/bun/workflow/tools/board-error-format.ts`)

Pure function separating data access from presentation:

```typescript
export function buildBoardNotFoundError(boards: Array<{ id: number; name: string }>): string {
  if (boards.length === 0) {
    return "Error: board_id is required. No boards are currently available.";
  }
  const list = boards.map(b => `Board #${b.id}: "${b.name}"`).join(", ");
  return `Error: board_id is required. Available boards: ${list}`;
}
```

## Changes to Existing Components

### BoardToolExecutor
- Accept `IBoardRepository` in constructor
- Replace 3 direct `SELECT ... FROM boards` queries with `boardRepo` calls
- Use `buildBoardNotFoundError` for error messages
- Keep direct `db` access for task queries (out of scope)

### Engines (Claude, Copilot, Pi, OpenCode)
- Add `boardRepo: IBoardRepository` as a **required** constructor parameter (no default, no fallback to `getDb()`)
- Replace `db.query("SELECT workspace_key FROM boards WHERE id = ?", ...)` with `boardRepo.getWorkspaceKey()`
- All engine tests must be updated to pass `BoardRepository(db)` — ~15 test files affected

### Test Infrastructure (separate change)
- Test suite captured in a **separate OpenSpec change** (`board-repository-tests`)
- Includes: `board-error-format.test.ts`, `board-repository.test.ts`, `seedBoards()` helper, engine DI updates
- All mocking via **dependency injection** — no conditional code paths or test flags

### Orchestrator
- Create `BoardRepository(db)` instance
- Pass to `BoardToolExecutor` constructor
- Pass to engine factories via composition root

### EngineFactory (index.ts)
- Update type signature to include `boardRepo: IBoardRepository`
- Update all 4 factory closures to pass `boardRepo` to engine constructors

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Board query scope | `workspace_key` filter | Consistent with `list_boards`, prevents cross-workspace leakage |
| Repository location | New `BoardRepository` | Follows existing pattern, clean SRP |
| Error formatting | Pure function | Separates data access from presentation |
| Engine injection | All 4 engines | Single source of truth, consistent DI |
| Constructor param | **Required** (no default) | Clean DI, no fallback paths, all tests exercise new code |
| Test suite | Separate OpenSpec change | Isolates feature from test coverage, ships independently |

## Cleanup Opportunities (Future)

1. **PositionService** — instantiated internally in `BoardToolExecutor` instead of DI
2. **WorkspaceRepository.getBoardWorkspaceKey** — overlaps with `BoardRepository.getWorkspaceKey`
3. **Direct board queries** — other files still query `boards` directly (handlers, column-config)
