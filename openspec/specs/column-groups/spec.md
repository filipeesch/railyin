## Purpose
Defines how workflow columns can be grouped into vertical stacks that occupy a single horizontal slot on the board.

## Requirements

### Requirement: Workflow YAML supports optional column groups
The `WorkflowTemplateConfig` SHALL accept an optional top-level `groups` array. Each entry has an `id`, an optional `label`, and a `columns` array of existing column IDs. A workflow without a `groups` key SHALL behave identically to the current behaviour.

#### Scenario: Workflow with no groups renders as before
- **WHEN** a workflow YAML has no `groups` key
- **THEN** the board renders columns in a flat horizontal row, one slot per column, unchanged

#### Scenario: Groups key is optional — existing workflows are valid
- **WHEN** an existing workflow YAML is loaded that has no `groups` key
- **THEN** no validation error occurs and the board renders normally

#### Scenario: Group entry with valid column IDs is accepted
- **WHEN** a `groups` entry lists column IDs that all exist in the `columns` array
- **THEN** the config loads successfully

### Requirement: Grouped columns render as a vertical stack in one horizontal slot
Columns that belong to the same group SHALL be rendered stacked vertically within a single horizontal slot on the board. The group occupies the same horizontal position as the first of its member columns in the `columns` array order.

#### Scenario: Two grouped columns share one horizontal slot
- **WHEN** columns A and B are members of the same group
- **THEN** the board renders one horizontal slot containing A above B, with each sub-column having its own header and card list

#### Scenario: Non-grouped columns remain as standalone slots
- **WHEN** a column is not referenced by any group
- **THEN** it renders as a full standalone horizontal slot, unchanged

#### Scenario: Column order within a group matches the `columns` array order
- **WHEN** the `columns` array defines order `[plan, in_progress, in_review]` and a group references all three
- **THEN** the sub-columns render top-to-bottom in that same order

### Requirement: Single-column group renders as a standalone column
If a group contains only one column ID, it SHALL render identically to a standalone column with no group chrome.

#### Scenario: Group with one member renders without wrapper
- **WHEN** a group has exactly one column ID
- **THEN** that column renders as a normal standalone column, indistinguishable from an ungrouped column

### Requirement: Drag-and-drop targets are individual sub-columns within a group
Each sub-column within a group SHALL be an independent drop target. The existing `[data-column-id]` attribute on each sub-column ensures drag detection works without changes to drop logic.

#### Scenario: Card dropped on a sub-column transitions to that column's state
- **WHEN** a user drags a card and releases it over a sub-column inside a group
- **THEN** the card transitions to that sub-column's workflow state, not the group

#### Scenario: Drop indicator appears within the correct sub-column
- **WHEN** a user drags a card and hovers over a sub-column
- **THEN** the drop indicator line appears inside that sub-column's card list
