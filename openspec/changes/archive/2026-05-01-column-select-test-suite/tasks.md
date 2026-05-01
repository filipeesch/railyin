## 1. Unit Tests — Pure Function (getValidTransitionColumns)

- [x] 1.1 Create `src/mainview/composables/useColumnTransitions.test.ts` with Vitest boilerplate and import of `getValidTransitionColumns` (no `vi.mock("vue")` needed)
- [x] 1.2 Write GCT-1: `allowedTransitions: undefined` → all columns returned, current column `disabled: true`
- [x] 1.3 Write GCT-2: `allowedTransitions: []` → only current column returned, `disabled: true`
- [x] 1.4 Write GCT-3: `allowedTransitions: ["plan", "done"]` → exactly current + plan + done; others absent
- [x] 1.5 Write GCT-4: `template: undefined` → returns `[]`
- [x] 1.6 Write GCT-5: `fromColumnId` not found in template → returns `[]`
- [x] 1.7 Write GCT-6: `fromColumnId` is `null` → returns `[]`; `undefined` → returns `[]`
- [x] 1.8 Write GCT-7: `allowedTransitions: ["done", "plan"]` (out of template order) → result follows template column order
- [x] 1.9 Write GCT-8: `allowedTransitions` contains unknown column ID → that ID is silently dropped from result
- [x] 1.10 Write GCT-9: single-column template with `allowedTransitions: []` → `[col(disabled)]`

## 2. Unit Tests — Composable Reactive Wrapper (useColumnTransitions)

- [x] 2.1 Write UCT-1: `forbiddenColumnIds` is an empty `Set` when `allowedTransitions` is `undefined`
- [x] 2.2 Write UCT-2: `forbiddenColumnIds` contains non-reachable columns when `allowedTransitions` is set (backlog → plan only → forbidden = in_progress, in_review, done)
- [x] 2.3 Write UCT-3: `selectableColumns.value` equals `getValidTransitionColumns(template, fromColumnId)` output
- [x] 2.4 Write UCT-4: updating `currentColumnId` ref from restricted column to unrestricted column reactively updates `selectableColumns.value` (use `ref()` from vue directly)

## 3. Playwright Tests — Task Drawer Select (task-toolbar.spec.ts)

- [x] 3.1 Add `restrictedTemplate` constant (backlog → `allowedTransitions: ["plan"]`) and `frozenTemplate` (backlog → `allowedTransitions: []`) to the test file or import from shared fixture
- [x] 3.2 Write TT-12: unrestricted column → all 5 template columns visible in open Select
- [x] 3.3 Write TT-13: `backlog` restricted to `["plan"]` → Select contains exactly 2 options ("Backlog", "Plan")
- [x] 3.4 Write TT-14: current column (`backlog`) has `aria-disabled="true"` in the open Select
- [x] 3.5 Write TT-15: forbidden columns ("In Progress", "In Review", "Done") are absent from the Select option list
- [x] 3.6 Write TT-16: clicking "Plan" option calls `tasks.transition` with correct `taskId` and `toState: "plan"`
- [x] 3.7 Write TT-17: frozen column (`allowedTransitions: []`) → Select contains exactly 1 option, `aria-disabled="true"`

## 4. Original Change — tasks.md Update

- [x] 4.1 Add task 2.4 to `openspec/changes/fix-column-select-transitions/tasks.md`: "Add edge-case unit tests GCT-5..9 to `useColumnTransitions.test.ts`"
- [x] 4.2 Add task 5.4 to `openspec/changes/fix-column-select-transitions/tasks.md`: "Extend `task-toolbar.spec.ts` with TT-12..17 per the `column-select-test-suite` change"

## 5. Verification

- [x] 5.1 Run `bun test src/mainview/composables/useColumnTransitions.test.ts` — all GCT and UCT tests pass
- [x] 5.2 Run `bun run build && npx playwright test e2e/ui/task-toolbar.spec.ts` — all TT tests pass including new TT-12..17
