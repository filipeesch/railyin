# Spec: test-qualified-model-id

## Purpose

Specifies the `QualifiedModelId` value type — parsing 2-part and 3-part IDs, `toString()` round-trip fidelity, error cases, and structural equality.

## Requirements

### Requirement: QMI-parse-two-part
`QualifiedModelId.parse(s)` correctly handles 2-part IDs (no provider).

#### Scenario: QMI-1 parse copilot 2-part ID
- **WHEN** `QualifiedModelId.parse("copilot/gpt-4.1")` is called
- **THEN** `engineId === "copilot"`, `providerId === undefined`, `modelId === "gpt-4.1"`, `nativeModelId() === "gpt-4.1"`

#### Scenario: QMI-2 parse claude 2-part ID
- **WHEN** `QualifiedModelId.parse("claude/claude-sonnet-4-5")` is called
- **THEN** `engineId === "claude"`, `providerId === undefined`, `modelId === "claude-sonnet-4-5"`, `nativeModelId() === "claude-sonnet-4-5"`

---

### Requirement: QMI-parse-three-part
`QualifiedModelId.parse(s)` correctly handles 3-part IDs (with provider).

#### Scenario: QMI-3 parse opencode 3-part ID
- **WHEN** `QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5")` is called
- **THEN** `engineId === "opencode"`, `providerId === "anthropic"`, `modelId === "claude-sonnet-4-5"`, `nativeModelId() === "anthropic/claude-sonnet-4-5"`

---

### Requirement: QMI-tostring-roundtrip
`toString()` reproduces the original string.

#### Scenario: QMI-4 2-part round-trip
- **WHEN** `QualifiedModelId.parse("copilot/gpt-4.1").toString()` is called
- **THEN** result equals `"copilot/gpt-4.1"`

#### Scenario: QMI-5 3-part round-trip
- **WHEN** `QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5").toString()` is called
- **THEN** result equals `"opencode/anthropic/claude-sonnet-4-5"`

---

### Requirement: QMI-error-cases
`QualifiedModelId.parse(s)` throws descriptive errors on invalid input.

#### Scenario: QMI-6 empty string throws
- **WHEN** `QualifiedModelId.parse("")` is called
- **THEN** throws an error with a descriptive message

#### Scenario: QMI-7 no slash throws
- **WHEN** `QualifiedModelId.parse("gpt-4.1")` is called
- **THEN** throws an error

#### Scenario: QMI-8 empty model segment throws
- **WHEN** `QualifiedModelId.parse("opencode/")` is called
- **THEN** throws an error

---

### Requirement: QMI-equality
Two parses of the same string produce structurally equal objects.

#### Scenario: QMI-9 value equality
- **WHEN** two separate calls to `QualifiedModelId.parse("copilot/gpt-4.1")` are made
- **THEN** `a.toString() === b.toString()` and all fields match
