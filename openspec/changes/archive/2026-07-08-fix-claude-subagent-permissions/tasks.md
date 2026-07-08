## 1. EngineEvent Types

- [x] 1.1 Add `{ type: "subagent_stop"; callId: string }` to the `EngineEvent` union in `src/bun/engine/types.ts`

## 2. Stream Processor

- [x] 2.1 Add `subagent_stop` case to `stream-processor.ts`: emit a `tool_result` StreamEvent with `blockId` matching the `callId` from the corresponding `subagent_start`, closing the subagent block in the UI

## 3. BashPermissionGate — new class

- [x] 3.0 Create `src/bun/engine/claude/bash-permission-gate.ts` — `BashPermissionGate` class with a single public method `evaluate(toolName, input, scope, waitForResume): Promise<PreToolUseResult>`. Constructor accepts `ShellApprovalRepository`. Logic: (a) non-Bash → allow immediately; (b) Bash + `shellAutoApprove` → allow; (c) Bash + approved binary → allow; (d) unapproved binary → call `waitForResume`, resolve allow/deny; (e) `approve_all` → call `shellApprovalRepo.appendApprovedCommands` then allow.

## 4. Claude Adapter — Permission Gate Migration

- [x] 4.1 Add `permissionMode: "bypassPermissions"` to the `sdk.query()` options in `DefaultClaudeSdkAdapter._run()`
- [x] 4.2 Remove the `canUseTool` callback from the `sdk.query()` options
- [x] 4.3 Inject `BashPermissionGate` into `DefaultClaudeSdkAdapter` constructor (alongside existing `ShellApprovalRepository`); add a `PreToolUse` hook entry in the `hooks` object that delegates entirely to `BashPermissionGate.evaluate`
- [x] 4.4 Update `buildAllowPermissionResult` (or add a new helper) to return the `PreToolUse` hook-compatible shape: `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: input } }`
- [x] 4.5 Update `permissionDecisionToResult` — replaced by `BashPermissionGate` (dead code removed)

## 5. Claude Adapter — Subagent Lifecycle Events

- [x] 5.1 Add a `SubagentStart` hook entry to the `hooks` object: extract `agent_id` from hook input as `callId`, derive `intent` from the subagent prompt, emit `{ type: "subagent_start", callId, intent, prompt }` engine event
- [x] 5.2 Add a `SubagentStop` hook entry to the `hooks` object: extract `agent_id` from hook input as `callId`, emit `{ type: "subagent_stop", callId }` engine event

## 6. Tests

- [x] 6.1 Create `src/bun/test/bash-permission-gate.test.ts` — unit tests BPG-1 through BPG-6 (pure, no SDK, all deps injected)
- [x] 6.2 Update `src/bun/test/claude-adapter.test.ts` — update CA-1/CA-2 for new `buildAllowPermissionResult` hook shape; add CA-3 for deny helper
- [x] 6.3 Add `subagent_start` and `subagent_stop` mock step kinds to `MockClaudeSdkAdapter` in `src/bun/test/support/claude-sdk-mock.ts`
- [x] 6.4 Add integration tests CRS-SA-1 through CRS-SA-4 to `src/bun/test/claude-rpc-scenarios.test.ts`
- [x] 6.5 Add stream pipeline test S-15 to `src/bun/test/stream-pipeline-scenarios.test.ts`

## 7. Verification

- [x] 7.1 Confirm all backend tests pass: `bun test src/bun/test --timeout 20000` — 1732 pass, 0 fail
- [x] 7.2 Verify `canUseTool` key is absent from the `sdk.query()` options object in `adapter.ts`
- [x] 7.3 Verify `permissionMode: "bypassPermissions"` is present in the `sdk.query()` options
- [x] 7.4 Verify `PreToolUse`, `SubagentStart`, `SubagentStop` hook entries are present in the `hooks` object
