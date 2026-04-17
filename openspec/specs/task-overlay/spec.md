## Purpose
Defines the task overlay component that provides a dual-mode (Preview/Edit) interface for viewing and editing task descriptions, following the same UI pattern as the todo item editor overlay.

## Requirements

### Requirement: Task overlay component provides dual view modes for description
The system SHALL provide a task overlay component with tabbed interface for viewing and editing task descriptions, supporting both Preview and Edit modes.

#### Scenario: Task overlay displays with Preview/Edit tabs
- **WHEN** a user opens the task overlay for editing
- **THEN** the overlay displays with Preview and Edit tabs for the description content

#### Scenario: Preview mode renders markdown description
- **WHEN** the user selects the Preview tab in the task overlay
- **THEN** the task description is rendered as formatted markdown

#### Scenario: Edit mode provides textarea for description
- **WHEN** the user selects the Edit tab in the task overlay
- **THEN** the task description is displayed in a textarea for editing

### Requirement: Task overlay follows consistent UI pattern with todo overlay
The system SHALL implement the task overlay component following the same UI pattern as the todo item editor overlay.

#### Scenario: Task overlay shares styling with todo overlay
- **WHEN** the task overlay is displayed
- **THEN** it uses the same styling and layout patterns as the todo item editor overlay

#### Scenario: Task overlay supports keyboard shortcuts
- **WHEN** the task overlay is open
- **THEN** it supports the same keyboard shortcuts as the todo item editor overlay (ESC to close)
