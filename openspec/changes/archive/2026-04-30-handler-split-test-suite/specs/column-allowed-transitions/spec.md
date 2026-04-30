## ADDED Requirements

### Requirement: Board UI allowed-transitions behavior has Playwright test coverage
`e2e/ui/board-allowed-transitions.spec.ts` SHALL exist and cover the UI-level behavior of `allowedTransitions` defined in the `column-allowed-transitions` spec.

#### Scenario: AT-1 — forbidden columns receive is-drag-forbidden CSS class during drag
- **WHEN** a user starts dragging a card from a column with `allowedTransitions: ["plan"]`
- **THEN** all columns except `"plan"` and the source column receive the `is-drag-forbidden` CSS class while the drag is in progress

#### Scenario: AT-2 — drag cursor becomes not-allowed over a forbidden column
- **WHEN** a user hovers a dragged card over a forbidden column
- **THEN** the column element's computed `cursor` style is `not-allowed`

#### Scenario: AT-3 — dropping on a forbidden column makes no tasks.transition API call
- **WHEN** a user releases the pointer over a forbidden column
- **THEN** no `tasks.transition` RPC call is made to the mock API

#### Scenario: AT-4 — allowed columns do not receive is-drag-forbidden class
- **WHEN** a user starts dragging a card from a column with `allowedTransitions: ["plan"]`
- **THEN** the `"plan"` column does NOT have the `is-drag-forbidden` CSS class
