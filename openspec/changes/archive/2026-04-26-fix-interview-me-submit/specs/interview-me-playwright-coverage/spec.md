## ADDED Requirements

### Requirement: InterviewMe widget has Playwright e2e coverage
The system SHALL have Playwright tests for the `InterviewMe` widget covering all question types, submit gating logic, submit send behavior, and read-only answered state. Tests SHALL use the mock-API pattern (no real Bun backend) by seeding an `interview_prompt` message via the `conversations.getMessages` mock.

#### Scenario: Exclusive question — select option enables submit

- **WHEN** an `interview_prompt` message contains a single `exclusive` question and the user clicks an option row
- **THEN** the Submit button becomes enabled

#### Scenario: non_exclusive question — click row enables submit

- **WHEN** an `interview_prompt` message contains a single `non_exclusive` question and the user clicks an option row
- **THEN** the Submit button becomes enabled

#### Scenario: Freetext question — type answer enables submit, clear disables

- **WHEN** an `interview_prompt` message contains a single `freetext` question and the user types a non-empty answer
- **THEN** the Submit button becomes enabled; clearing the answer disables it again

#### Scenario: Multi-question batch — all must be answered before submit

- **WHEN** an `interview_prompt` message contains two questions and only one is answered
- **THEN** the Submit button remains disabled; answering the second question enables it

#### Scenario: Submit sends formatted Q/A message to the task

- **WHEN** the user answers all questions and clicks Submit
- **THEN** a `tasks.sendMessage` API call is made with a formatted string containing each question and its selected answer(s)

#### Scenario: Already-answered interview shows read-only state

- **WHEN** a `user` message exists after the `interview_prompt` in the conversation messages list
- **THEN** the InterviewMe widget renders in read-only mode showing answer summaries and no Submit button

#### Scenario: Answered detection works with messages after the interview

- **WHEN** a `user` message exists after the `interview_prompt` and additional `assistant` messages follow
- **THEN** the widget still renders in read-only mode (answered detection is not invalidated by later messages)
