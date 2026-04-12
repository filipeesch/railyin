## ADDED Requirements

### Requirement: Cache break components are hashed per round and changes logged
The system SHALL, before each Anthropic API call, compute short hashes of: (a) the stable system block content, (b) the serialized tool definitions. When either hash differs from the previous round's hash for the same execution, the system SHALL emit a WARN log identifying which component changed: `[cache] <component> hash changed: <prev_hash> → <new_hash>`. The hashes SHALL be persisted only in memory for the duration of the execution (not written to DB).

#### Scenario: System hash change logged
- **WHEN** the assembled system block content differs from the previous round
- **THEN** a WARN log is emitted: `[cache] system hash changed: <old> → <new>`

#### Scenario: Tools hash change logged
- **WHEN** the serialized tool definitions differ from the previous round
- **THEN** a WARN log is emitted: `[cache] tools hash changed: <old> → <new>`

#### Scenario: No change produces no log
- **WHEN** both the system block and tool definitions are identical to the previous round
- **THEN** no cache break warning is emitted

#### Scenario: First round establishes baseline without warning
- **WHEN** round 1 runs and there is no prior hash to compare
- **THEN** the hashes are recorded but no warning is emitted
