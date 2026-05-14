## 1. Normalize-args unit tests

- [ ] 1.1 Write test: string-encoded array JSON string is parsed → returns array
- [ ] 1.2 Write test: string-encoded object JSON string is parsed → returns object
- [ ] 1.3 Write test: string-typed parameter is NOT parsed → passes through unchanged
- [ ] 1.4 Write test: non-string values (null, number, boolean) pass through unchanged
- [ ] 1.5 Write test: nested array items within objects are recursed and parsed
- [ ] 1.6 Write test: nested object properties within arrays are recursed and parsed
- [ ] 1.7 Write test: already-native nested values pass through without re-parsing
- [ ] 1.8 Write test: malformed JSON string is caught and original string preserved
- [ ] 1.9 Write test: valid JSON but wrong type after parse → original preserved
- [ ] 1.10 Write test: allOf/anyOf/oneOf combinations are skipped with TODO comment

## 2. Normalize-args integration with buildCommonTools

- [ ] 2.1 Write test: decision_request tool with native JSON args → normalizeArgs passes through
- [ ] 2.2 Write test: decision_request tool with string-encoded questions → tool receives parsed array
- [ ] 2.3 Write test: reorganize_todos tool with string-encoded items → tool receives parsed array
- [ ] 2.4 Write test: scalar-only tools (get_task, move_task) → normalizeArgs has no effect

## 3. Pi engine pipeline integration tests (using ScriptedEngine)

- [ ] 3.1 Write test: decision_request event emitted via SDK → suspended state
- [ ] 3.2 Write test: decision_request event transitions task to waiting_user in DB
- [ ] 3.3 Write test: decision_request_prompt message created in conversation buffer
- [ ] 3.4 Write test: decision_request_prompt pushed through IPC channel to frontend
- [ ] 3.5 Write test: decision_request suspends the agent loop correctly
- [ ] 3.6 Write test: Pi engine → utils/prepareDecision: NormalizeArgs logging: ParseArgs Tool

## 4. decision-handlers edge case tests

- [ ] 4.1 Write test: multi-answer submission → all formatted in userContent
- [ ] 4.2 Write test: empty answers array → handler returns error or no-op
- [ ] 4.3 Write test: long notes field (>500 chars) → stored without truncation error
- [ ] 4.4 Write test: multi-weight submission (critical/medium/easy) → all formatted correctly

## 5. Stream processor decision_request tests

- [ ] 5.1 Write test: decision_request event → decision_request_prompt message creation
- [ ] 5.2 Write test: decision_request event → task execution_state set to waiting_user
- [ ] 5.3 Write test: decision_request event → execution finished_at set correctly
- [ ] 5.4 Write test: decision_request event → message pushed through conversation buffer

## 6. Chat store decision_request_prompt tests

- [ ] 6.1 Write test: decision_request_prompt message → chatStore status becomes waiting_user
- [ ] 6.2 Write test: decision_request_prompt message → session marked as unread if not active
- [ ] 6.3 Write test: decision_request_prompt appearing multiple times → correct state management

## 7. Edge case unit tests for executeCommonTool

- [ ] 7.1 Write test: decision_request with non-array questions → AJV returns "questions must be array"
- [ ] 7.2 Write test: decision_request with empty questions → AJV returns "at least 1 item"
- [ ] 7.3 Write test: decision_request with invalid type enum → AJV lists valid values
- [ ] 7.4 Write test: decision_request with missing question field → AJV returns required error

## 8. Playwright edge case tests

- [ ] 8.1 Write test: decision_request_prompt during streaming → appears at stream end
- [ ] 8.2 Write test: concurrent decision requests across different tasks → no cross-contamination
- [ ] 8.3 Write test: WebSocket disconnect during interview → UI state persists on reconnect
