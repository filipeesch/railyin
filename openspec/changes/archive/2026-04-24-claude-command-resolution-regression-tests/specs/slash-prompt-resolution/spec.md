## ADDED Requirements

### Requirement: Slash command chips with colon-separated names pass cleanly to the Claude SDK
For **Claude engine**, when a user message contains a slash chip using colon-separated subdirectory notation, the system SHALL derive a plain `/namespace:command` string and pass it as the engine-facing prompt, so the Claude SDK can resolve it natively.

#### Scenario: Colon-separated chip text is eligible for Claude SDK slash resolution
- **WHEN** the stored message contains `[/opsx:propose|/opsx:propose]` chip markup
- **THEN** the derived engine-facing text begins with `/opsx:propose` and retains the colon separator unchanged
