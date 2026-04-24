## Why

The Claude engine slash command resolution path has regressed three times: commands list correctly but are not recognized when sent in chat because the chip-to-plain-text derivation pipeline is complex and untested end-to-end. Without integration-level tests that verify the exact string the engine receives, any refactor of `tasks.sendMessage` or `chatSessions.sendMessage` can silently break command dispatch.

## What Changes

- Add API integration tests in `e2e/api/smoke.test.ts` that verify `tasks.sendMessage` and `chatSessions.sendMessage` deliver the correct engine-facing string when slash chip markup is used — exercising both the `engineContent` fast path and the `extractChips` fallback path
- Add a unit test in `src/bun/test/chat-chips.test.ts` covering colon-separated slash command names (`/opsx:propose`) to prevent chip-pattern regressions from going undetected
- Update the `slash-prompt-resolution` spec with a scenario asserting that colon-separated subdirectory commands (Claude SDK format) round-trip through `extractChips` correctly

## Capabilities

### New Capabilities

- `claude-command-chip-roundtrip`: Regression coverage guaranteeing that slash command chips with colon-separated names produce the correct raw `/command` string through the full sendMessage pipeline for both task and chat-session surfaces

### Modified Capabilities

- `slash-prompt-resolution`: Add scenario covering colon-separated subdirectory command name (`opsx:propose` format) round-trip through chip extraction
- `chat-regression-coverage`: Add requirement for API integration coverage of slash command chip dispatch path

## Impact

- `e2e/api/smoke.test.ts` — new test cases added to existing task and chatSession suites
- `src/bun/test/chat-chips.test.ts` — new unit test for colon-separated command names
- `openspec/specs/slash-prompt-resolution/spec.md` — new colon-format scenario
- `openspec/specs/chat-regression-coverage/spec.md` — new slash-command-dispatch requirement
- No production code changes; tests only
