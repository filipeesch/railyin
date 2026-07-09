# Board Project Filters

## Why

The board view currently displays all tasks across all projects in every column, regardless of which project a task belongs to. Users who work with multiple projects need a way to quickly filter the board to focus on a single project's tasks without losing context of the workflow.

## What Changes

- **Add a project filter Select** in the board header's right-side toolbar (next to the existing utility buttons)
- **Filter all columns globally** — selecting a project hides tasks from other projects across the entire board
- **Default to "all projects"** — when no project is selected, all tasks display (current behavior)
- **Scope to board's projectKeys** — if a board has `projectKeys` configured, the filter only offers those projects as options
- **Scope to workspace** — the dropdown lists all projects from the currently selected workspace

## Capabilities

### New Capabilities
- `board-project-filter`: Project-based task filtering on the board view via a header Select component

### Modified Capabilities
<!-- No existing spec requirements change — this is additive UI behavior -->

## Impact

| Area | Impact |
|---|---|
| Frontend | `src/mainview/views/BoardView.vue` — add Select component, filter state, computed filter |
| Stores | No changes needed — filter is purely presentational (computed in BoardView) |
| Backend | No changes — tasks already include `projectKey` |
| Types | No changes — existing `Task.projectKey` and `Project` types suffice |
| Tests | See Testing section below |

## Testing

### Playwright E2E — `e2e/ui/board-project-filter.spec.ts`

New file following the existing `board-project-badge.spec.ts` pattern with six test suites:

| Suite | Scope | Scenarios |
|---|---|---|
| **PF** — Filter UI | Select visibility, placeholder, styling in board header | 2 |
| **PO** — Filter Options | Workspace projects listed; board.projectKeys scoping; fallback to all when empty | 4 |
| **FT** — Filter Tasks | Selecting project hides non-matching tasks; shows matching; empty columns when no match | 4 |
| **FR** — Filter Reset | Deselecting (null) shows all tasks again | 2 |
| **FS** — State on Switch | Board switch resets filter; workspace switch updates options | 3 |
| **FU** — Reactive Updates | New matching task appears; non-matching stays hidden; drag-drop preserves filter state | 3 |

**Total: 18 Playwright scenarios.**

### Backend Handler — `src/bun/test/handlers.test.ts`

Pre-existing gap fill: the handler tests never verified that `tasks.list` returns tasks with different `projectKey` values correctly. Adding 2-3 assertions that seed tasks with distinct projectKeys and verify correct return values.

**Total: 2-3 handler scenarios.**
