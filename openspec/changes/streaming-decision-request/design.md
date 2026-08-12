## Context

The `decision_request` tool is erroring with `Error: field 'type' is required` (repeated per malformed question) and, in worse cases, suspending with `Interview suspended - awaiting user response.` carrying unusable payloads. Investigation traced the root cause to the one-shot batch schema: the tool requires a deeply nested `questions: [...]` array where each item must carry `required: ["question", "type"]` plus optional `weight`/`options`/`model_lean`/etc. Models — Sonnet 5 via the Cursor SDK in particular — fail to produce the nested required fields. The Cursor SDK passes our `inputSchema` verbatim to Cursor's backend (confirmed in `node_modules/@cursor/sdk/dist/esm/357.js` custom-tools layer), and schema-dialect conversion of nested array-item constraints is a known weak spot in such backends. The AJV gate then rejects the whole batch with an unhelpful error, and the model retries the same broken structure.

**Current state:**
- `DECISION_REQUEST_TOOL_DEFINITION` declares `questions: { type: "array", minItems: 1, items: {...required: ["question","type"]...} }`
- `executeCommonTool` validates via `validateToolArgs` (AJV) then returns `{ type: "suspend", payload }` — the loop aborts on the FIRST call
- `validateToolArgs` reports missing required fields without enum guidance (`Error: field 'type' is required`)
- `normalizeToolArguments` only runs on the Pi path (via `prepareArguments`); Cursor/Claude/Copilot/OpenCode pass raw args
- The UI renders the full stacked interview inside `MessageBubble.vue` in the chat stream

## Goals / Non-Goals

**Goals:**
- Eliminate the `type`-required error loop by making `decision_request` accept ONE question per call, repeated to build an interview
- Stream question pages to the UI live while the model is still working, so the user can start answering before the turn ends
- Present the interview in a fixed panel above the prompt input (outside the chat stream), above the todo / changed-files lists
- Paginated interview UI with Back / Next / Submit in the footer; Submit active only at `waiting_user`
- Normalize tool args at a single choke-point inside `executeCommonTool` so all engines behave identically
- Return schema-aware validation errors that list valid enum values so the model can self-correct
- Never silently lose buffered questions: turn-end flush guarantees the interview is presented

**Non-Goals:**
- Auto-filling missing `type` fields (rejected — strict validation, no defaults)
- A separate `decision_request_submit` tool (rejected — same tool name, single-question shape)
- Legacy `questions: [...]` array acceptance (rejected — strictly single-question)
- DB schema or `DecisionAnswer`/`DecisionRequestPayload` shape changes (payload shape preserved for UI compat)
- Explicit `final` flag (rejected — interview is live-streamed; turn-end flush is the terminal)
- Testing is part of this change: full migration of array-form callers plus new coverage across all four test layers (see Testing Strategy)

## Decisions

### D1 — Single FLAT question-per-call schema (no array, no nesting, no auto-fill)
`decision_request` accepts a fully flat, top-level shape per call: `{ context?, question: string, type, weight?, model_lean?, model_lean_reason?, answers_affect_followup?, options? }`. `question` is a plain STRING (the question text) and `type` is a sibling top-level field — there is NO nested `question` object and NO `questions` array. `type` stays strictly required (`required: ["question", "type"]`) — we do NOT auto-fill missing `type` (user decision: "Return validation error (no default)"). The description teaches the model to call once per question with flat fields and END ITS TURN to present.

**Why:** The original nested `{ question: {...} }` wrapper caused the SAME model failure it was meant to solve — models flattened it into top-level fields (`{ question: "text", type, weight, ... }`) and AJV rejected the nested-object requirement (`question: must be object`). A fully flat schema has zero nesting, so schema-dialect conversion and model generation both succeed. Per-question validation makes the retry surface one flat object instead of a 6-question batch.

### D2 — Per-execution `DecisionQuestionBuffer` on `CommonToolContext.runtime`
New `DecisionQuestionBuffer` class (`src/bun/engine/decision-buffer.ts`) storing `DecisionRequestQuestion[]` with `append(question)`, `all`, `count`, `clear()`. The executor assembles the UI-facing `DecisionRequestQuestion` object from the flat tool args before appending. Each engine creates a fresh buffer per execution and assigns it to `ctx.runtime.decisionBuffer` (mirrors the existing per-execution `pageRef` pattern; Pi resets on cached contexts the same way it resets `loopDetector`).

**Why:** append→turn-end flush spans multiple tool calls within one execution; the buffer must be per-execution, injected (DI), and engine-agnostic.

### D3 — `ToolExecutionResult` gains a `page` variant; `suspend` removed
```ts
export type ToolExecutionResult =
  | { type: "result"; text: string; writtenFiles?; beforeFiles? }
  | { type: "page"; text: string; payload: string };
```
A valid `decision_request` call returns `page` (engine emits `decision_request_page` and continues the loop); an invalid single question returns `{ type: "result", text: <schema-aware error> }` (no page, buffer preserved — "keep buffer; reject only the bad call"). The `suspend` variant is **removed entirely** (user decision: "Remove suspend variant entirely") — no common tool returns it; engine-level `ask_user`/`shell_approval` suspension flows through EngineEvents, not `ToolExecutionResult`.

### D4 — Engine wrappers emit `decision_request_page`; turn-end flush emits terminal `decision_request`
Each engine wrapper (Pi `tools/common.ts`, Cursor `tools.ts`, Claude `tools.ts`, Copilot `tools.ts`, OpenCode `mcp-server.ts`) handles the `page` result: emit `{ type: "decision_request_page", payload }` engine event and return the text to the model (loop continues, NO abort). At turn end, before `done`, each engine checks the buffer — non-empty → emit `{ type: "decision_request", payload: JSON.stringify({ questions }) }` instead of `done`; empty → normal `done`.

**Why:** the tool no longer suspends per call; the interview is live-streamed and finalized at turn end, matching the user's "the user can start answering before the questions turn end" and "Submit active only at waiting_user".

### D5 — `normalizeToolArguments` at the executeCommonTool choke-point
`executeCommonTool` normalizes args against the tool's schema at the top, before `validateToolArgs`, covering ALL engines with one change. Idempotent — Pi's `prepareArguments` double-run is harmless. (User decision: single choke-point.)

### D6 — Schema-aware required-field errors in `validateToolArgs`
When a `required` error fires for a missing property, look up the property in the schema node at the error path; if it declares an `enum`, append valid values. Fully generic (benefits every required-enum field). Output e.g. `Error: field 'question.type' is required (valid values: "exclusive", "non_exclusive", "freetext")`.

### D7 — Per-question `context` (no shared interview context)
Each question may carry its own optional `context` preamble focused on that question, rendered on its page. `DecisionRequestPayload.context` remains for legacy rendering but is not the primary path. (User decision: "a context for each question focused in that question".)

### D8 — Fixed interview panel above the prompt input (outside chat stream)
New `DecisionInterviewPanel.vue` placed in `TaskChatView.vue` and `SessionChatView.vue` between `ConversationBody` and `ChangedFilesPanel`/`TodoPanel` (i.e. above the todo/files lists and above `ConversationInput`). The in-chat `DecisionRequest` rendering in `MessageBubble.vue` is retired for new interviews (legacy persisted messages may still render). The panel reads live pages from the conversation store's new live-interview state, appends via `decision_request_page` stream events, and reconciles to the persisted `decision_request_prompt` at turn end.

**Why:** the user explicitly requested the interview live above the prompt input, outside the chat, so the model writing text after the calls doesn't disturb the UX.

### D9 — Submit active only at `waiting_user`
Pages stream live and the user can fill answers at any time, but the Submit button is disabled until the terminal `decision_request_prompt` is persisted (turn end → waiting_user). This preserves the existing `submitDecisions` → resume path untouched (no mid-run cancel plumbing). Footer per page: Back, Next (non-last) / Submit (last).

### D10 — Shared pure turn-end flush helper
Extract `buildDecisionRequestTerminalEvent(buffer: DecisionQuestionBuffer): EngineEvent | null` as a pure, IO-free helper. Each engine calls it immediately before `yield { type: "done" }` and yields the returned terminal `{ type: "decision_request", payload }` instead when non-null; null → normal `done`. (User decision: shared pure helper + thin per-engine wiring.)

**Why:** one unit test covers the drain logic; per-engine wiring is a trivial 3-line call verified by existing engine mocks/faux providers; avoids duplicating buffer-drain logic across 5 engines (DRY/SOLID).

### D11 — Mock adapters mirror the `page` contract
`MockCursorSdkAdapter.callTool` (and equivalent mocks for Copilot/OpenCode/Claude) SHALL inspect the tool result: `type === "page"` → yield `{ type: "decision_request_page", payload }` then emit the `tool_start`/`tool_result` pair with the returned text (loop continues, NO abort). There is no `suspend` result anymore (`ToolExecutionResult` is `result | page` per D3); ask_user/shell_approval are engine-level events. (User decision: emit page event + continue loop.)

**Why:** the mocks become faithful in-memory stand-ins for production, letting integration scenarios assert the full page-streaming contract end-to-end (page events observable on IPC, stream-processor + frontend path exercised).

## Risks / Trade-offs

- **Model may keep appending without ending turn** → mitigated by the count + "END YOUR TURN" hint in every tool result, and the turn-end flush is the ultimate backstop (never lost).
- **Schema migration breaks existing array-form callers/tests** → accepted (user decision: strictly single-question); all callers/tests migrate in this change.
- **More tool calls per interview** (N appends vs 1 batch) → accepted; each call is tiny and flat, dramatically reducing the failure mode that caused the loop.
- **Live pages vs persisted message reconciliation** → the frontend must reconcile ephemeral pages into the persisted payload at turn end; a missed edge case could flash duplicate interviews — mitigated by keeping the panel as the single rendering surface.
- **Turn-end flush touches every engine** → per-engine wiring is small and mirrors existing `onSuspend`/`done` patterns; Pi is done first, then Cursor (the failing engine), then the rest.

## Testing Strategy

Tests are part of this change, split across the project's four existing layers. The strategy is DI-first: every seam (tool builders, engine adapters, scripted turns, RPC runtime, frontend stores) is injected with fakes/mocks — no test-only production branches.

### D12 — Test layers and responsibilities

1. **L1 Unit (pure functions, zero IO):**
   - `decision-buffer.test.ts` (new): `append`/`all`/`count`/`clear`; fresh-per-execution
   - `decision-request-executor.test.ts` (new, after extraction): valid single question → `page` + count text; missing `type` → schema-aware error + buffer preserved; `exclusive` with 1 option → error; `freetext` no options → `page`; count + END-YOUR-TURN text
   - `validate-tool-args.test.ts` additions: missing enum field lists valid values (generic)
   - `buildDecisionRequestTerminalEvent.test.ts` (new): non-empty buffer → terminal `decision_request` payload with all questions; empty buffer → null
   - `src/mainview/utils/decisionRequest.ts` additions: pagination helpers (`canAdvancePage`, per-page validity, answer-state preservation)

2. **L2 Component-DI (engine tool builders with injected fakes):**
   - `pi-common-tools-bridge.test.ts` additions: `page` result → `pageRef.onPage` fires + text returned to model (PCB-5)
   - `claude-tools.test.ts`: SpyZod schema-shape rewritten for single `question` object; `takePendingPage` return contract; `executeCommonTool` decision_request tests use an injected fresh-buffer context
   - `common-tools-registration.test.ts`: `baseContext` gains `runtime.decisionBuffer`; decision_request registration/description assertions updated

3. **L3 Integration (in-memory DB + fake engines via `createBackendRpcRuntime`):**
   - `shared-rpc-scenarios.ts` additions: `runDecisionStreamingScenario(runtime)` — N appends → 1 terminal `decision_request` → `waiting_user`; assert `decision_request_prompt` persisted, `decision_request_page` on IPC but NOT in DB
   - Per-engine scenarios: cursor (`rpc-scenarios.test.ts`), copilot, opencode (MCP `callTool`), claude — each queues multiple `callTool("decision_request", {question})` steps then asserts terminal persistence + `waiting_user`
   - `ScriptedEngine` turn-end flush scenario: queue `[decision_request_page, decision_request_page, decision_request]` → assert IPC/DB channels (ephemeral pages not persisted; terminal prompt persisted)
   - `human-turn-executor` / `tasks.submitDecisions`: resume-after-terminal still works with the streaming payload
   - Pi: faux-provider scenario (`createFauxSessionFactory`) where the scripted model calls `decision_request` 3× then ends → terminal event
   - `cursor/adapter.test.ts` keep-alive test: comment updated (decision_request no longer aborts per call; abort path still covers user cancel)

4. **L4 Playwright (dist/ + mocked /api + mocked /ws):**
   - `interview-me.spec.ts` rework: panel placement above input; pages stream via `ws.pushStreamEvent({ type: "decision_request_page" })`; pagination footer Back/Next/Submit; Submit disabled while running, enabled at `waiting_user`; per-question context; reconcile live→persisted at `done`
   - `mock-data.ts` / `mock-ws.ts`: add `decision_request_page` stream-event fixture + push helper
   - New panel scenarios: pages append without full reload; background-task pages don't disturb active conversation; answered interview renders read-only

### D13 — Migration of array-form callers
All existing array-form callers must migrate to single-question calls: `validate-tool-args.test.ts` (V-6..V-9), `claude-tools.test.ts` (schema-shape + execute), `common-tools-registration.test.ts`, `cursor/rpc-scenarios.test.ts` §6.3.5a/b, `cursor/adapter.test.ts` L116-143, `copilot-rpc-scenarios.test.ts` L197, `claude-rpc-scenarios.test.ts` L160 (terminal payload shape), `opencode-rpc-scenarios.test.ts`, `inprocess-adapter.test.ts` L624 (comment), `chat.test.ts` C10–C12 (unchanged — still valid).

### Extrapolated scenarios (from the specs)
- **Buffer keep-on-error**: append Q1 (valid) → append Q2 (missing `type`) → error → append Q2' (fixed) → terminal has Q1 + Q2'
- **Context per question**: each page renders its own context; terminal payload carries per-question contexts
- **Turn-end flush, empty buffer** → normal `done` (no spurious prompt)
- **Turn-end flush, non-empty buffer** → terminal `decision_request` replaces `done`
- **Submit disabled mid-stream**: pages stream, user fills answers, Submit disabled until `waiting_user`
- **Reconcile live→persisted**: `decision_request_page` events accumulate; `done` + persisted `decision_request_prompt` → panel renders final interview
- **Schema-aware enum error**: missing `type` on any question → error lists all three valid values
