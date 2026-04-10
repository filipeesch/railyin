## Purpose
Defines the optional `railyin.yaml` configuration file at a project root that specifies run profiles and tool launchers available to tasks in that project.

## Requirements

### Requirement: Project may define a railyin.yaml config file
The system SHALL support an optional `railyin.yaml` file at the project root that defines run profiles and tool launchers for that project. The file is not required — projects without it behave as before.

#### Scenario: railyin.yaml with run profiles is present
- **WHEN** a `railyin.yaml` file exists at the project root with a `run.profiles` array
- **THEN** the system reads the profiles and makes them available as launch actions for tasks belonging to that project

#### Scenario: railyin.yaml is absent
- **WHEN** no `railyin.yaml` file exists at the project root
- **THEN** the system returns null for the launch config and no launch buttons are shown

#### Scenario: railyin.yaml has no run section
- **WHEN** a `railyin.yaml` file exists but has no `run` key
- **THEN** the system treats it as no launch config and no launch buttons are shown

### Requirement: Run profiles are defined as ordered entries with label, icon, and command
Each run profile SHALL have a `label` (display name), `icon` (PrimeIcons class without the `pi ` prefix, e.g. `pi-play`), and `command` (shell command string). All three fields are required.

#### Scenario: Valid profile entry
- **WHEN** a profile entry has `label`, `icon`, and `command` defined
- **THEN** the system includes it in the ordered list of run profiles

#### Scenario: Profile missing required field
- **WHEN** a profile entry is missing `label`, `icon`, or `command`
- **THEN** the system skips that entry and logs a warning; other valid profiles are still loaded

### Requirement: Tool launchers follow the same shape as run profiles
Tool launchers SHALL be defined under `run.tools` using the same `{ label, icon, command }` shape as profiles.

#### Scenario: Valid tool entry
- **WHEN** a tools entry has `label`, `icon`, and `command` defined
- **THEN** the system includes it in the ordered list of tool launchers

### Requirement: Launch config is read on-demand from disk
The system SHALL read `railyin.yaml` fresh from disk each time the frontend requests launch config for a task. The result MAY be cached per session after first read.

#### Scenario: Config is requested for a task
- **WHEN** the frontend calls `launch.getConfig` with a task ID
- **THEN** the backend resolves the project path, reads `railyin.yaml`, parses it, and returns the `LaunchConfig` or null
