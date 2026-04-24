## Purpose
Defines the round-trip correctness requirement for slash command chips that use colon-separated subdirectory notation (e.g. `opsx:propose`), ensuring `extractChips` produces the correct engine-facing string.

## Requirements

### Requirement: Slash command chip with colon-separated name round-trips through extractChips correctly
The system SHALL correctly parse slash command chips whose name uses colon-separated subdirectory notation (e.g. `opsx:propose`) and produce an engine-facing string that preserves the full `/opsx:propose` label, including the colon separator.

#### Scenario: Colon-separated slash chip produces correct humanText
- **WHEN** `extractChips("[/opsx:propose|/opsx:propose] my feature")` is called
- **THEN** `humanText` equals `/opsx:propose my feature`

#### Scenario: Colon-separated slash chip produces no file attachments
- **WHEN** `extractChips("[/opsx:propose|/opsx:propose] my feature")` is called
- **THEN** `attachments` is an empty array
