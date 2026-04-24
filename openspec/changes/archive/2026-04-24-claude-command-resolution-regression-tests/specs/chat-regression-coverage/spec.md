## ADDED Requirements

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
