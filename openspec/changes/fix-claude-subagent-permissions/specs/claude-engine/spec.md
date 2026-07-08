## ADDED Requirements

### Requirement: ClaudeEngine registers permission gate via PreToolUse hook not canUseTool
The system SHALL use a `PreToolUse` hook as the Bash permission gate instead of the `canUseTool` callback. The `canUseTool` callback SHALL NOT be registered on any `sdk.query()` call. The `PreToolUse` hook SHALL fire for tool calls in the parent agent context and in all subagent contexts spawned during the same query.

#### Scenario: No canUseTool callback is registered
- **WHEN** `DefaultClaudeSdkAdapter._run()` constructs the `sdk.query()` options
- **THEN** the options object does NOT contain a `canUseTool` key

#### Scenario: PreToolUse hook is registered alongside other hooks
- **WHEN** `DefaultClaudeSdkAdapter._run()` constructs the `sdk.query()` options
- **THEN** the `hooks` object contains a `PreToolUse` entry with at least one hook callback
