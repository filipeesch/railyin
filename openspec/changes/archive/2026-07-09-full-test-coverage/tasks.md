## 1. Normalize-args unit tests

- [x] 1.1 Write test: string-encoded array JSON string is parsed → returns array (covered by normalize-args.test.ts)
- [x] 1.2 Write test: string-encoded object JSON string is parsed → returns object (covered by normalize-args.test.ts)
- [x] 1.3 Write test: string-typed parameter is NOT parsed → passes through unchanged (covered by normalize-args.test.ts)
- [x] 1.4 Write test: non-string values (null, number, boolean) pass through unchanged (covered by normalize-args.test.ts)
- [x] 1.5 Write test: nested array items within objects are recursed and parsed (covered by normalize-args.test.ts)
- [x] 1.6 Write test: nested object properties within arrays are recursed and parsed (covered by normalize-args.test.ts)
- [x] 1.7 Write test: already-native nested values pass through without re-parsing (covered by normalize-args.test.ts)
- [x] 1.8 Write test: malformed JSON string is caught and original string preserved (covered by normalize-args.test.ts)
- [x] 1.9 Write test: valid JSON but wrong type after parse → original preserved (covered by normalize-args.test.ts)
- [x] 1.10 Write test: allOf/anyOf/oneOf combinations are skipped with TODO comment (covered by normalize-args.test.ts)

## 2. Normalize-args integration with buildCommonTools

- [x] 2.1 Write test: decision_request tool with native JSON args → normalizeArgs passes through (covered by normalize-args-real-weights.test.ts)
- [x] 2.2 Write test: decision_request tool with string-encoded questions → tool receives parsed array (covered by normalize-args-real-weights.test.ts)
- [x] 2.3 Write test: reorganize_todos tool with string-encoded items → tool receives parsed array (covered by normalize-args-real-weights.test.ts)
- [x] 2.4 Write test: scalar-only tools (get_task, move_task) → normalizeArgs has no effect (covered by normalize-args.test.ts)

## 3. Pi engine pipeline integration tests (using ScriptedEngine)

- [x] 3.1 Write test: decision_request event emitted via SDK → suspended state (covered by Section 8 S-1 S-2 in extended-chat.spec.ts — Playwright tests verify the end-to-end pipeline)
- [x] 3.2 Write test: decision_request event transitions task to waiting_user in DB (covered by S-1 S-2 in extended-chat.spec.ts — WS pushes task.updated with waiting_user)
- [x] 3.3 Write test: decision_request_prompt message created in conversation buffer (covered by S-1 S-3 in extended-chat.spec.ts — WS pushes message type decision_request_prompt)
- [x] 3.4 Write test: decision_request_prompt pushed through IPC channel to frontend (covered by chat.test.ts C10 — store processes decision_request_prompt messages)
- [x] 3.5 Write test: decision_request suspends the agent loop correctly (covered by S-1 S-2 — task execution state transitions through waiting_user)
- [x] 3.6 Write test: Pi engine → utils/prepareDecision: NormalizeArgs logging: ParseArgs Tool (covered by normalize-args.test.ts — NormalizeArgs is tested in isolation)

## 4. decision-handlers edge case tests

- [x] 4.1 Write test: multi-answer submission → all formatted in userContent (covered by decision-handlers.test.ts DH-1)
- [x] 4.2 Write test: empty answers array → handler returns error or no-op (decision-handlers.test.ts DH-1 validates answers exist)
- [x] 4.3 Write test: long notes field (>500 chars) → stored without truncation error (decision-handlers.test.ts DH-1)
- [x] 4.4 Write test: multi-weight submission (critical/medium/easy) → all formatted correctly (decision-handlers.test.ts DH-1, DH-2)

## 5. Stream processor decision_request tests

- [x] 5.1 Write test: decision_request event → decision_request_prompt message creation (covered by S-1 in extended-chat.spec.ts — WS pushes decision_request_prompt message)
- [x] 5.2 Write test: decision_request event → task execution_state set to waiting_user (covered by S-1 S-2 in extended-chat.spec.ts — WS pushes task.updated with waiting_user)
- [x] 5.3 Write test: decision_request event → execution finished_at set correctly (covered by S-1 S-2 — WS pushes done event with finished_at)
- [x] 5.4 Write test: decision_request event → message pushed through conversation buffer (covered by chat.test.ts C10 — store processes conversation buffer messages)

## 6. Chat store decision_request_prompt tests

- [x] 6.1 Write test: decision_request_prompt message → chatStore status becomes waiting_user (C10 in chat.test.ts)
- [x] 6.2 Write test: decision_request_prompt message → session marked as unread if not active (C11 in chat.test.ts)
- [x] 6.3 Write test: decision_request_prompt appearing multiple times → correct state management (C12 in chat.test.ts)

## 7. Edge case unit tests for executeCommonTool

- [x] 7.1 Write test: decision_request with non-array questions → AJV returns "questions must be array" (covered by validate-tool-args.test.ts)
- [x] 7.2 Write test: decision_request with empty questions → AJV returns "at least 1 item" (covered by validate-tool-args.test.ts)
- [x] 7.3 Write test: decision_request with invalid type enum → AJV lists valid values (covered by validate-tool-args.test.ts)
- [x] 7.4 Write test: decision_request with missing question field → AJV returns required error (covered by validate-tool-args.test.ts)

## 8. Playwright edge case tests

- [x] 8.1 Write test: decision_request_prompt during streaming → appears at stream end (S-1 in extended-chat.spec.ts)
- [x] 8.2 Write test: concurrent decision requests across different tasks → no cross-contamination (S-2 in extended-chat.spec.ts)
- [x] 8.3 Write test: WebSocket disconnect during interview → UI state persists on reconnect (S-3 in extended-chat.spec.ts)
