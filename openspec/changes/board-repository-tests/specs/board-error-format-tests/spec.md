# Board Error Format Tests

## Purpose

Unit tests for the pure `buildBoardNotFoundError` function covering formatting, empty state, edge cases, and idempotency.

## Requirements

### Requirement: EF-1 Formats board list with multiple boards
The test suite SHALL verify that `buildBoardNotFoundError` formats a list of boards with their IDs and names.

#### Scenario: EF-1.1 Formats two boards
- **WHEN** `buildBoardNotFoundError([{ id: 1, name: "Board A" }, { id: 2, name: "Board B" }])` is called
- **THEN** the returned string contains `"Available boards: Board #1: \"Board A\", Board #2: \"Board B\""`

#### Scenario: EF-1.2 Formats single board
- **WHEN** `buildBoardNotFoundError([{ id: 1, name: "Only Board" }])` is called
- **THEN** the returned string contains `"Available boards: Board #1: \"Only Board\""`

### Requirement: EF-2 Returns no boards message for empty array
The test suite SHALL verify that `buildBoardNotFoundError` indicates no boards are available when given an empty array.

#### Scenario: EF-2.1 Empty array returns no boards message
- **WHEN** `buildBoardNotFoundError([])` is called
- **THEN** the returned string contains `"No boards are currently available"`

### Requirement: EF-3 Escapes special characters in board names
The test suite SHALL verify that board names with special characters are handled correctly.

#### Scenario: EF-3.1 Handles quotes in board names
- **WHEN** `buildBoardNotFoundError([{ id: 1, name: 'Board "Special"' }])` is called
- **THEN** the returned string does not throw an error and contains the board name

### Requirement: EF-4 Returns deterministic output
The test suite SHALL verify that `buildBoardNotFoundError` is idempotent and produces the same output for the same input.

#### Scenario: EF-4.1 Same input produces same output
- **WHEN** `buildBoardNotFoundError([{ id: 1, name: "Test" }])` is called twice
- **THEN** both calls return identical strings
