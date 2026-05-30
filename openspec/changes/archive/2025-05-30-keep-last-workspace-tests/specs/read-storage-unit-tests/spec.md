## ADDED Requirements

### Requirement: readStorage correctly reads and parses localStorage values
The `readStorage<T>(key, fallback)` utility SHALL return the JSON-parsed value from `localStorage` when the key exists and the value is valid JSON, and SHALL return `fallback` in all other cases.

#### Scenario: RS-1 — key exists with valid JSON → returns parsed value
- **WHEN** `localStorage` contains `key` with a valid JSON string (e.g. `"42"` for a number, `'"ws-1"'` for a string)
- **THEN** `readStorage` returns the correctly typed parsed value

#### Scenario: RS-2 — key does not exist → returns fallback
- **WHEN** `localStorage` does not contain `key`
- **THEN** `readStorage` returns the `fallback` value

#### Scenario: RS-3 — key contains malformed JSON → returns fallback
- **WHEN** `localStorage` contains `key` mapped to a non-JSON string (e.g. `"not-json"`)
- **THEN** `readStorage` returns the `fallback` value without throwing

#### Scenario: RS-4 — localStorage is undefined → returns fallback
- **WHEN** the `readStorage` utility is called in an environment where `localStorage` is not defined (SSR / test without jsdom)
- **THEN** `readStorage` returns the `fallback` value without throwing
