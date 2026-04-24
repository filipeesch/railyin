## 1. Chip content and send flow

- [x] 1.1 Update autocomplete chip labels and chip helpers so slash, file/symbol, and MCP chips preserve sigils in their stored and visible labels
- [x] 1.2 Split chat send handling into stored chip-markup content and derived engine-facing plain/raw text plus attachments for both task chat and standalone session chat
- [x] 1.3 Update engine/conversation context assembly so stored chip-markup user messages are decoded before they are sent to Copilot or Claude

## 2. Conversation rendering

- [x] 2.1 Add shared parsing/rendering for user-message autocomplete chips in conversation bubbles
- [x] 2.2 Update task and session conversation views so new chip-preserving user messages render as rich inline chips while old plain-text messages still display normally

## 3. Validation

- [x] 3.1 Add or update unit tests for chip extraction, derived engine text, and slash-command preservation
- [x] 3.2 Add UI coverage for rich chip rendering in sent user messages and slash-command execution flow
- [x] 3.3 Write and run e2e tests for autocomplete chip message handling
