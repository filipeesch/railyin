## MODIFIED Requirements

### Requirement: Context ring is a clickable popover trigger

The context ring gauge in the task toolbar SHALL be wrapped in a button element that, when clicked, opens the `ContextPopover`. The ring's visual appearance (SVG, color logic, percentage label) SHALL remain unchanged.

The previous requirement that the ring shows a tooltip on hover is superseded — token detail is now displayed inside the popover.

#### Scenario: Ring is rendered as a button
- **WHEN** the task detail drawer is open and `contextUsage` is available
- **THEN** the context ring SHALL be rendered inside a clickable button element
- **AND** clicking it SHALL toggle the `ContextPopover`

## REMOVED Requirements

### Requirement: Standalone Compact button in toolbar

**Reason:** The Compact action has been moved into the `ContextPopover` where it is conditionally shown based on engine capability (`supportsManualCompact`). A bare button with no capability awareness was confusing for engines that handle compaction internally.

**Migration:** Clicking the context ring opens the popover, which contains the Compact button when applicable.
