## ADDED Requirements

### Requirement: LeaseRegistry accepts any engine type string

The test suite SHALL contain a test that constructs a `LeaseRegistry` with `engine: "opencode"` and verifies that lease creation, state transitions, and expiry work identically to existing engine types.

#### Scenario: LeaseRegistry created with opencode engine type

- **WHEN** a `LeaseRegistry` is constructed with `engine: "opencode"`
- **THEN** `touch()`, `setState()`, and `release()` all behave correctly and the lease expires after the configured timeout
