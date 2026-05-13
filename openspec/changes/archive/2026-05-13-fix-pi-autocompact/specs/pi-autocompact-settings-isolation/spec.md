## ADDED Requirements

### Requirement: Pi engine always uses in-memory compaction settings
The Pi engine SHALL pass `SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } })` to `createAgentSession`. This ensures the SDK's built-in `_checkCompaction` always runs regardless of any `~/.pi/agent/settings.jsonl` configuration on the host machine.

#### Scenario: Compaction enabled even when Pi CLI has disabled it
- **WHEN** the host machine's `~/.pi/agent/settings.jsonl` contains `{ "compaction": { "enabled": false } }`
- **THEN** a Pi engine session still has compaction enabled (in-memory settings override disk)

#### Scenario: In-memory settings do not persist to disk
- **WHEN** the Pi engine creates a session
- **THEN** no write to `~/.pi/agent/settings.jsonl` occurs
