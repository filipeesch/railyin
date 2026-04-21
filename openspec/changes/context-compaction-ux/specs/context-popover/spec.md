## Purpose

Provides a rich, interactive context window popover accessible by clicking the context ring gauge. Shows detailed token usage and a conditional manual compact action.

## Requirements

### Requirement: Context ring opens a popover on click

The system SHALL render the context ring gauge inside a clickable button in the task toolbar. Clicking the ring SHALL open a `ContextPopover` component using the PrimeVue `<Popover>` pattern (matching `McpToolsPopover.vue`).

#### Scenario: Clicking ring opens popover
- **WHEN** the user clicks the context ring gauge button
- **THEN** the ContextPopover SHALL appear, anchored near the ring

#### Scenario: Clicking ring again closes popover
- **WHEN** the ContextPopover is open and the user clicks the ring button again
- **THEN** the ContextPopover SHALL close

### Requirement: Popover displays model name, linear gauge, and token counts

The ContextPopover SHALL show:
- The current task's model display name
- A linear progress bar colored green (<70%), yellow (70–89%), red (≥90%) matching the ring's color logic
- The token counts as "~X,XXX / Y,XXX tokens"

#### Scenario: Popover shows correct token values
- **WHEN** the ContextPopover is open and `contextUsage` is available
- **THEN** the popover SHALL display the linear gauge at the correct fill fraction and the "~used / max tokens" label

### Requirement: Compact button shown only when engine supports it

The ContextPopover SHALL render a "Compact conversation" button at the bottom if and only if the current task's model has `supportsManualCompact: true` in the model list.

#### Scenario: Compact button visible for Copilot engine
- **WHEN** the task model is a Copilot model (`supportsManualCompact: true`)
- **THEN** the Compact button SHALL be visible inside the popover

#### Scenario: Compact button hidden for Claude engine
- **WHEN** the task model is a Claude model (`supportsManualCompact` is omitted or false)
- **THEN** the Compact button SHALL NOT be rendered in the popover

#### Scenario: Compact button disabled during execution
- **WHEN** the task `executionState` is `"running"`
- **THEN** the Compact button SHALL be disabled

### Requirement: Bare Compact button removed from toolbar

The system SHALL remove the standalone "Compact" text button that previously appeared in the toolbar next to the context ring. The ring popover is the sole entry point for manual compaction.
