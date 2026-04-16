## 1. Canonical Interview Tool Definition

- [x] 1.1 Add interview_me to shared common tool definitions in src/bun/engine/common-tools.ts using the richer canonical description and schema from workflow tools.
- [x] 1.2 Add or align shared interview display/metadata helpers so interview_me appears consistently in tool activity UI.
- [x] 1.3 Ensure workflow tool definition for interview_me is aligned with the canonical shared schema source to prevent future drift.

## 2. Shared Execution Contract

- [x] 2.1 Extend CommonToolContext in src/bun/engine/types.ts with an interview suspension callback contract.
- [x] 2.2 Implement interview_me handling in executeCommonTool that serializes payload, invokes the callback, and returns a suspension sentinel result.
- [x] 2.3 Add defensive behavior for missing interview callback in shared execution (explicit error or graceful failure path).

## 3. Copilot Engine Unification

- [x] 3.1 Remove Copilot-exclusive interview_me tool registration from src/bun/engine/copilot/tools.ts so only mapped common tools are registered.
- [x] 3.2 Pass onInterviewMe through Copilot common tool context in src/bun/engine/copilot/engine.ts.
- [x] 3.3 Verify Copilot interview callback still aborts the active stream and emits interview_me event before returning.

## 4. Claude Engine Parity

- [x] 4.1 Pass interview callback through Claude common tool context in src/bun/engine/claude/engine.ts.
- [x] 4.2 Update Claude adapter runtime in src/bun/engine/claude/adapter.ts to handle interview callback by emitting interview_me and stopping the current run turn.
- [x] 4.3 Confirm Claude shared common tool registration includes interview_me via src/bun/engine/claude/tools.ts without custom special-casing.

## 5. Validation And Regression Coverage

- [x] 5.1 Add or update tests for common tool registration parity across native, Copilot, and Claude engines.
- [x] 5.2 Add or update tests for interview_me waiting_user transitions in Copilot and Claude execution paths.
- [x] 5.3 Run OpenSpec validation and project test/lint commands to ensure artifact and codebase consistency.
