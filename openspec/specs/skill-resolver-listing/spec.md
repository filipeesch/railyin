# Skill Resolver Listing

## Purpose

Defines the `list()` capability on `SkillResolver` and its `FileSystemSkillResolver` implementation, enabling callers to enumerate all discoverable skill names for error messages, autocomplete, and validation.

## Requirements

### Requirement: SkillResolver exposes a list() method
The `SkillResolver` interface SHALL define a `list(): Promise<string[]>` method that returns the names of all discoverable skills across all configured paths. Names SHALL be deduplicated (first-path-wins, same as `resolve()`). The method SHALL return an empty array when no skills are found.

#### Scenario: list returns names of all skills across all paths
- **WHEN** `FileSystemSkillResolver` is constructed with two directories, each containing distinct skill subdirectories with `SKILL.md`
- **THEN** `list()` returns an array containing all skill names from both directories

#### Scenario: list deduplicates names across paths
- **WHEN** two configured directories both contain a skill directory with the same name
- **THEN** `list()` returns that name only once

#### Scenario: list returns empty array when no skills exist
- **WHEN** the configured directories contain no subdirectories with `SKILL.md`
- **THEN** `list()` returns `[]`

#### Scenario: list returns empty array when paths array is empty
- **WHEN** `FileSystemSkillResolver` is constructed with an empty paths array
- **THEN** `list()` returns `[]`

### Requirement: FileSystemSkillResolver implements list()
`FileSystemSkillResolver` SHALL implement `list()` by scanning each configured directory for subdirectories that contain a `SKILL.md` file. It SHALL NOT throw on non-existent directories — those are silently skipped. The returned names SHALL be in discovery order (directory order, then alphabetical within each directory), deduplicated.

#### Scenario: Skips directories that do not exist
- **WHEN** one of the configured paths does not exist on the filesystem
- **THEN** `list()` does not throw and returns names from the remaining valid paths

#### Scenario: Skips entries that are not directories
- **WHEN** a configured skill path contains a plain file at the top level
- **THEN** `list()` does not include that file name and does not throw
