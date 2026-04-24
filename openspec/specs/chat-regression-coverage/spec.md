## Purpose
Defines regression coverage for shared task/session chat surfaces and standalone session API flows.

## Requirements

### Requirement: Unified task drawer has direct regression coverage
The automated test suite SHALL include dedicated UI coverage for the unified task drawer behavior rather than relying only on older incidental chat specs.

#### Scenario: Task drawer core chat flow covered
- **WHEN** the regression suite runs
- **THEN** it includes a dedicated task-drawer suite covering drawer open, tab switching, send, streaming, cancel, and close behavior

#### Scenario: Task drawer shared toolbar covered
- **WHEN** the regression suite runs
- **THEN** it includes coverage for model selection, attachments, and drawer resize behavior in task chat

### Requirement: Shared conversation body has direct regression coverage
The automated test suite SHALL include dedicated UI coverage for the shared `ConversationBody` rendering behavior.

#### Scenario: Shared body renders mixed message content
- **WHEN** the regression suite runs
- **THEN** it includes a dedicated conversation-body suite covering user messages, assistant messages, tool-call grouping, reasoning, and streaming states

#### Scenario: Shared body covers virtualization behavior
- **WHEN** the regression suite runs
- **THEN** it validates large conversation rendering without requiring every message to be mounted in the DOM at once

### Requirement: Standalone session API flows have integration coverage
The automated test suite SHALL include backend integration coverage for standalone chat sessions using the existing fake provider/engine and in-memory database harness.

#### Scenario: Session lifecycle covered in API tests
- **WHEN** the API integration suite runs
- **THEN** it covers chat session create, list, rename, archive, and read operations without requiring a task

#### Scenario: Session send/receive covered in API tests
- **WHEN** the API integration suite runs with queued fake-provider responses
- **THEN** it covers standalone session send-message flow through persisted assistant output and subsequent message reads

#### Scenario: Conversation reads covered by canonical identifier
- **WHEN** the API integration suite requests conversation messages for task-backed and standalone-session conversations
- **THEN** it validates the canonical conversationId-based read path and any supported compatibility alias behavior

### Requirement: Slash command chip dispatch path has API integration coverage
The automated test suite SHALL verify, through API integration tests using the in-memory server and mock execution engine, that `tasks.sendMessage` and `chatSessions.sendMessage` deliver the correct engine-facing string when a message contains slash chip markup with colon-separated command names.

#### Scenario: tasks.sendMessage with engineContent delivers correct prompt to engine
- **WHEN** `tasks.sendMessage` is called with `content = "[/opsx:propose|/opsx:propose] my feature"` and `engineContent = "/opsx:propose my feature"`
- **THEN** the mock engine receives `"/opsx:propose my feature"` as the prompt, and the assistant response contains `"Mock response: /opsx:propose my feature"`

#### Scenario: tasks.sendMessage without engineContent falls back to extractChips correctly
- **WHEN** `tasks.sendMessage` is called with `content = "[/opsx:propose|/opsx:propose] my feature"` and no `engineContent`
- **THEN** `extractChips` is applied server-side and the engine receives `"/opsx:propose my feature"` as the prompt

#### Scenario: chatSessions.sendMessage with engineContent delivers correct prompt to engine
- **WHEN** `chatSessions.sendMessage` is called with `content = "[/opsx:propose|/opsx:propose] my feature"` and `engineContent = "/opsx:propose my feature"`
- **THEN** the mock engine receives `"/opsx:propose my feature"` as the prompt, and the assistant response contains `"Mock response: /opsx:propose my feature"`

#### Scenario: chatSessions.sendMessage without engineContent falls back to extractChips correctly
- **WHEN** `chatSessions.sendMessage` is called with `content = "[/opsx:propose|/opsx:propose] my feature"` and no `engineContent`
- **THEN** `extractChips` is applied server-side and the engine receives `"/opsx:propose my feature"` as the prompt
