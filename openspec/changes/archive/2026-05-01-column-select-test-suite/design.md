## Context

`fix-column-select-transitions` introduces `useColumnTransitions` (a pure function + Vue composable) and fixes `TaskChatView.vue`'s workflow Select. This companion change adds the test suite.

Existing test coverage:
- **Backend**: `transition-validator.test.ts` TV-1..TV-7 — complete, no gaps
- **Drag-and-drop**: `board-allowed-transitions.spec.ts` AT-1..AT-4 — complete, no gaps
- **Task Drawer Select**: `task-toolbar.spec.ts` TT-1..TT-11 — covers basic Select behaviour but has **no** `allowedTransitions` scenarios
- **Composable**: none yet — new file required

## Goals / Non-Goals

**Goals:**
- Unit-test `getValidTransitionColumns` pure function for all scenarios defined in spec plus edge cases resolved during exploration (GCT-1..9)
- Unit-test `useColumnTransitions` composable for reactive behaviour and `forbiddenColumnIds` derivation (UCT-1..4)
- Playwright-test Task Drawer Select option set and disabled state with `allowedTransitions` templates (TT-12..17)
- No mocking frameworks where not needed — prefer pure data injection

**Non-Goals:**
- Backend tests (already complete in TV-1..7)
- Drag-and-drop tests (already complete in AT-1..4)
- Mutation testing (handled separately by Stryker)

## Decisions

### D-1: No `vi.mock("vue")` for composable unit tests

`useCommandsCache.test.ts` mocks the entire `vue` module because the composable calls `api()` which is also mocked. `useColumnTransitions` has **no API calls** — it transforms plain data. Vue's `computed` / `ref` run fine in Vitest (Node) without DOM. Tests import Vue directly and construct `ref()` inputs. This keeps tests readable and removes a brittle mock layer.

### D-2: Pure function tested independently from composable wrapper

`getValidTransitionColumns(template, fromColumnId)` is tested as a standalone function. The composable tests (`UCT-*`) only verify reactivity wiring and `forbiddenColumnIds` derivation — they do not re-test filtering logic already covered by the pure function tests.

### D-3: Playwright tests extend `task-toolbar.spec.ts`, not a new file

The Select is part of the task toolbar surface. TT-1 and TT-2 already live in `task-toolbar.spec.ts`. Adding TT-12..17 there keeps all toolbar behaviour co-located. A new `board-allowed-transitions-drawer.spec.ts` would split related coverage unnecessarily.

### D-4: Playwright template injection via `setupBoardWithTemplate`

Tests use the existing `setupBoardWithTemplate(api, template)` helper from `e2e/ui/fixtures/mock-data.ts` — the same pattern used in `board-allowed-transitions.spec.ts`. No new fixture infrastructure is needed.

### D-5: Edge-case behavior (decisions from exploration)

| Input | Expected |
|---|---|
| `fromColumnId` not in template | `[]` |
| `fromColumnId` is `null`/`undefined` | `[]` |
| `allowedTransitions` lists unknown ID | ID is silently dropped |
| Result order when `allowedTransitions` is out of template order | Template order preserved |

### D-6: `aria-disabled` assertion for PrimeVue disabled option

TT-14 asserts `aria-disabled="true"` on the current-column option rather than a CSS class. PrimeVue renders `aria-disabled` reliably; CSS class names can change across versions.

## Risks / Trade-offs

- **PrimeVue Select DOM structure changes** → Assertions use `aria-disabled` and `.p-select-option` which are PrimeVue's public accessibility contract. If they change, TT-12..17 may need updates, but TT-1..11 would break first, giving early warning.
- **Vue reactivity in Vitest** → Vue 3.5 reactivity runs in Node without issue. If a future Vitest version isolates modules more aggressively, the composable tests would need `@vue/test-utils` — but this is unlikely given the existing composable test patterns already import `vue` directly (see `useCommandsCache.test.ts`).
