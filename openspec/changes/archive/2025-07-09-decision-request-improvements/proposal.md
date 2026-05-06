## Why

Decision records today are auto-saved as thin `{question, answer: title}` pairs (rich AI descriptions thrown away) and injected into `systemInstructions`, which invalidates the provider's system-prompt cache on every decision change. Both problems degrade the quality and performance of AI-driven conversations.

## What Changes

- **Remove frontend auto-save of decision records** — the AI becomes the sole author, calling `record_decision` with rich contextual prose after receiving user answers
- **New `tasks.submitDecisions` / `chatSessions.submitDecisions` RPC methods** — dedicated endpoints that format Q&A text, append a hidden server-side instruction, and route to the orchestrator; `decisionBatch` removed from `sendMessage` entirely
- **New `DecisionContextInjector` service** — mirrors `CrossEngineContextInjector`; prepends a `<decisions>` block to the user prompt once after each compaction (and on the very first turn), leaving the system prompt cache untouched
- **`decisions_injected_after_compaction_id` column on `conversations`** — tracks whether decisions have been injected after the latest compaction; sentinel value `0` means injected before any compaction
- **`buildSystemBlock` → `buildContextBlock`** on `DecisionRepository`; format changes from `## Decision Records` markdown to a `<decisions>` XML block
- **Remove decision injection from `ExecutionParamsBuilder`** — `_buildBase()` no longer appends any decision content to `systemInstructions`
- **`record_decision` tool description hardened** — ALWAYS/NEVER language makes AI authorship mandatory; `decision_request` definition references this obligation
- **General notes field in `DecisionRequest.vue`** — optional free-form textarea at the bottom of every decision form for overarching context not tied to a specific question

## Capabilities

### New Capabilities
- `decision-context-injector`: Service that injects a `<decisions>` XML block into the user prompt once after each compaction anchor (and on first turn), tracking injection via a conversations column
- `decision-submission-rpc`: Dedicated `tasks.submitDecisions` and `chatSessions.submitDecisions` RPC methods with shared `buildDecisionSubmission()` helper

### Modified Capabilities
- `decision-record`: Injection moves from `systemInstructions` to user prompt via `DecisionContextInjector`; `buildSystemBlock` renamed to `buildContextBlock` with XML output; `decisionBatch` transaction pathway removed; `markDecisionsInjected` and `getLastInjectedCompactionId` added to repository
- `decision-request-ui`: `DecisionRequest.vue` gains an always-visible optional general notes textarea at the bottom of the form; notes are appended to the submitted text
- `engine-execution-params`: `ExecutionParamsBuilder._buildBase()` no longer calls `DecisionRepository`; `DecisionRepository` dep removed from constructor

## Impact

- `src/bun/conversation/decision-context-injector.ts` — new file
- `src/bun/conversation/decision-submission.ts` — new file
- `src/bun/db/migrations/042_decisions_injection_tracking.ts` — new migration
- `src/bun/db/row-types.ts` — new column on `ConversationRow`
- `src/bun/db/repositories/decision-repository.ts` — renamed method, new methods
- `src/bun/engine/execution/execution-params-builder.ts` — remove decision logic
- `src/bun/engine/execution/human-turn-executor.ts` — inject `DecisionContextInjector`
- `src/bun/engine/execution/transition-executor.ts` — inject `DecisionContextInjector`
- `src/bun/engine/common-tools.ts` — harden `record_decision` description
- `src/bun/handlers/tasks.ts` — add `submitDecisions`, remove `decisionBatch` from `sendMessage`
- `src/bun/handlers/chat-sessions.ts` — add `submitDecisions`, remove `decisionBatch` from `sendMessage`
- `src/shared/rpc-types.ts` — new RPC signatures, remove `DecisionBatch`/`DecisionInput` from sendMessage
- `src/mainview/components/DecisionRequest.vue` — general notes field + call `submitDecisions`
- `src/mainview/components/MessageBubble.vue` — call `submitDecisions` instead of `sendMessage`
