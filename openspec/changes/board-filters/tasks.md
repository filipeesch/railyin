## 1. Add filter state and computed options

- [ ] 1.1 Add `selectedProjectKey` ref (null = no filter = show all) in BoardView.vue script setup
- [ ] 1.2 Add `projectFilterOptions` computed that maps workspace projects to `{ label, value }` format
- [ ] 1.3 Narrow `projectFilterOptions` to board's `projectKeys` when the board has them configured
- [ ] 1.4 Handle edge case: board without `projectKeys` → show all workspace projects

## 2. Add Select component to board header

- [ ] 2.1 Import `Select` from primevue (already imported in BoardView.vue)
- [ ] 2.2 Add `<Select>` component to `<div class="board-header__right">` with placeholder "All projects"
- [ ] 2.3 Bind `v-model="selectedProjectKey"`, `:options="projectFilterOptions"`, `option-label="label"`, `option-value="value"`
- [ ] 2.4 Add scoped CSS class to match existing Select styling (use same pattern as `.board-selector`)

## 3. Apply project filter to task rendering

- [ ] 3.1 Add project filter condition to `columnTasksMap` computed property before grouping by workflowState
- [ ] 3.2 Filter tasks by `task.projectKey === selectedProjectKey.value` when `selectedProjectKey` is not null
- [ ] 3.3 Verify empty columns display correctly when no tasks match the selected project
- [ ] 3.4 Verify drag-and-drop still works with filtered view (tasks move within their project scope)

## 4. Verification

- [ ] 4.1 Verify board with tasks across multiple projects shows all when filter is unselected
- [ ] 4.2 Verify selecting a project hides tasks from other projects in all columns
- [ ] 4.3 Verify switching board resets filter to "all" (correct — different board may have different projectKeys)
- [ ] 4.4 Verify workspace switch correctly updates project filter options## 5. Tests — Playwright E2E (`e2e/ui/board-project-filter.spec.ts`)

- [ ] 5.1 Create `board-project-filter.spec.ts` with PF suite: Select visible in header, placeholder text
- [ ] 5.2 PO suite: filter options list workspace projects; respects board.projectKeys; falls back to all when empty
- [ ] 5.3 FT suite: selecting project hides non-matching tasks; shows matching; empty columns when no match
- [ ] 5.4 FR suite: deselecting filter (null) shows all tasks again
- [ ] 5.5 FS suite: switching board resets filter to "all"; switching workspace updates options
- [ ] 5.6 FU suite: new matching task appears; non-matching stays hidden; drag-drop preserves filter state

## 6. Tests — Backend Handler Gap (`src/bun/test/handlers.test.ts`)

- [ ] 6.1 Seed two tasks with different projectKeys in same board; verify tasks.list returns both with correct projectKey
- [ ] 6.2 Verify projectKey is preserved across task lifecycle (transition, update)
