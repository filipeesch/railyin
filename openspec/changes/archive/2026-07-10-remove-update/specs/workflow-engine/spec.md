## REMOVED Requirements

### Requirement: Stale running state reset on startup
**Reason**: The automatic recovery of stuck tasks at startup was removed to stop silent, consentless state mutation. Tasks left in `running`/`waiting_user` state after a crash now remain in that state for manual user handling.
**Migration**: No migration needed. Users handle stuck tasks via the board UI (drag-and-drop to a new column, retry button, or manual transition).

#### Scenario: Stale running state reset on startup
- **WHEN** the Bun process restarts with tasks in `execution_state = 'running'`
- **THEN** those tasks are reset to `execution_state = 'failed'` (existing restart-recovery behaviour, unchanged)
