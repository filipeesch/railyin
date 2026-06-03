## MODIFIED Requirements

### Requirement: Complete tool set
The Pi engine exposes a complete set of Railyin-owned tools. All tool implementations are path-safe (no traversal outside worktree).

The `skill` tool SHALL return enriched error messages when the requested skill name is not found. The error SHALL include: the list of all available skill names (obtained via `resolver.list()`), and, when a case-insensitive or substring match exists, a "Did you mean: `<name>`?" suggestion. When no skills are available at all, the error SHALL say so explicitly rather than listing an empty set.

#### Scenario: Tool groups map to workflow YAML
- **WHEN** a workflow column config lists tool groups (e.g., `["read", "write", "search"]`)
- **THEN** `buildPiTools()` expands these to the corresponding `defineTool()` instances

#### Scenario: skill tool lists available skills on name not found
- **WHEN** the `skill` tool is called with a name that does not match any known skill
- **AND** at least one skill is discoverable via `resolver.list()`
- **THEN** the error response includes the full list of available skill names
- **AND** `isError` is `true`

#### Scenario: skill tool suggests closest match via fuzzy hint
- **WHEN** the `skill` tool is called with `"My-Skill"` and a skill named `"my-skill"` exists
- **THEN** the error response contains `"Did you mean: 'my-skill'"`

#### Scenario: skill tool error says no skills available when list is empty
- **WHEN** the `skill` tool is called with any name
- **AND** `resolver.list()` returns `[]`
- **THEN** the error response states that no skills are available (does not say "check the list")

#### Scenario: skill tool still succeeds on valid name
- **WHEN** the `skill` tool is called with a name that matches a known skill
- **THEN** the skill content is returned and `isError` is falsy
