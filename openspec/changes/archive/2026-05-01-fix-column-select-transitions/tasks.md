## 1. Composable — Core Logic

- [x] 1.1 Create `src/mainview/composables/useColumnTransitions.ts` — export `TransitionColumn` interface (extends `WorkflowColumn` with `disabled: boolean`), pure function `getValidTransitionColumns(template, fromColumnId)`, and `useColumnTransitions(template, currentColumnId)` composable returning `{ selectableColumns, forbiddenColumnIds }`
- [x] 1.2 Implement filtering rules in `getValidTransitionColumns`: when `allowedTransitions` is `undefined` return all columns (source disabled); when `[]` return only source (disabled); when defined return source (disabled) + allowed targets only; when `template` is `undefined` return `[]`
- [x] 1.3 Derive `forbiddenColumnIds` from `selectableColumns` as the set of column IDs not in `selectableColumns` (excluding the source column itself)

## 2. Composable — Unit Tests

- [x] 2.1 Create `src/mainview/composables/useColumnTransitions.test.ts` — test `getValidTransitionColumns` directly (no Vue mocking required) covering: `allowedTransitions: undefined`, `allowedTransitions: []`, `allowedTransitions: ["col-a"]`, `template: undefined`
- [x] 2.2 Add test: `forbiddenColumnIds` is empty when `allowedTransitions` is `undefined`
- [x] 2.3 Add test: `forbiddenColumnIds` contains non-reachable columns when `allowedTransitions` is set
- [x] 2.4 Add edge-case tests per `column-select-test-suite` change: `fromColumnId` not in template → `[]`; `fromColumnId` null/undefined → `[]`; `allowedTransitions` out of template order → template order respected; unknown ID in `allowedTransitions` silently dropped; single-column frozen template

## 3. Fix — TaskChatView.vue

- [x] 3.1 Replace `const columns = computed(...)` with `const { selectableColumns } = useColumnTransitions(computed(() => boardStore.activeBoard?.template), computed(() => task.value?.workflowState))`
- [x] 3.2 Update the `<Select>` binding: `:options="selectableColumns"`, add `option-disabled="disabled"`
- [x] 3.3 Add no-op guard at the top of `transition()`: `if (!task.value || toState === task.value.workflowState) return;`

## 4. Cleanup — BoardView.vue

- [x] 4.1 Import `useColumnTransitions` and replace the 12-line inline `forbiddenColumnIds` computed with `const { forbiddenColumnIds } = useColumnTransitions(computed(() => boardStore.activeBoard?.template), draggingSourceColumnId)`
- [x] 4.2 Verify board drag-and-drop behaviour is unchanged by running `bun run build` and visually checking the board in the browser

## 5. Verification

- [x] 5.1 Run unit tests: `bun test src/mainview/composables/useColumnTransitions.test.ts --timeout 20000`
- [x] 5.2 Run full backend suite to confirm no regressions: `bun test src/bun/test --timeout 20000`
- [x] 5.3 Build frontend: `bun run build`
- [x] 5.4 Extend `e2e/ui/task-toolbar.spec.ts` with Playwright tests TT-12..17 per the `column-select-test-suite` change (Select visibility with allowedTransitions, disabled state, absent forbidden options, frozen column)
