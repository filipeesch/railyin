# Dark Mode

## Purpose

This capability provides a dark/light mode toggle for the app, persisting the user's preference across sessions, ensuring all UI components render correctly in both modes, and syncing the Monaco editor theme with the active mode.

## Requirements

### Requirement: Dark mode toggle button
The app SHALL provide a toggle button in the top bar, immediately to the left of the Settings button, that switches between light and dark mode.

#### Scenario: Toggle button visible in top bar
- **WHEN** the user views any screen of the app
- **THEN** a moon/sun icon button is visible to the left of the Settings (cog) button

#### Scenario: Light mode shows moon icon
- **WHEN** the app is in light mode
- **THEN** the toggle button displays a moon icon with aria-label "Switch to dark mode"

#### Scenario: Dark mode shows sun icon
- **WHEN** the app is in dark mode
- **THEN** the toggle button displays a sun icon with aria-label "Switch to light mode"

#### Scenario: Toggle activates dark mode
- **WHEN** the user clicks the toggle button while in light mode
- **THEN** the `dark-mode` class is added to `<html>` and all PrimeVue surface tokens flip to dark values

#### Scenario: Toggle deactivates dark mode
- **WHEN** the user clicks the toggle button while in dark mode
- **THEN** the `dark-mode` class is removed from `<html>` and all PrimeVue surface tokens return to light values

### Requirement: Dark mode preference persistence
The app SHALL persist the user's dark/light mode preference across sessions using `localStorage`.

#### Scenario: Preference saved on toggle
- **WHEN** the user toggles dark mode
- **THEN** the value is written to `localStorage` under the key `railyn-dark-mode` as the string `"true"` or `"false"`

#### Scenario: Preference restored on load
- **WHEN** the app loads and `localStorage` contains `railyn-dark-mode = "true"`
- **THEN** dark mode is active before Vue mounts (no flash of light mode)

#### Scenario: Default is light mode
- **WHEN** the app loads and `localStorage` does not contain `railyn-dark-mode`
- **THEN** the app starts in light mode

### Requirement: All components render correctly in dark mode
Every UI component in the app SHALL be visually correct when dark mode is active. Components MUST NOT display light-colored backgrounds or dark-on-dark text.

#### Scenario: Collapsible tool call groups in dark mode
- **WHEN** dark mode is active and a tool call group is rendered (collapsed or expanded)
- **THEN** the header, body, and border use dark surface colors (no white/light backgrounds)

#### Scenario: Code review card in dark mode
- **WHEN** dark mode is active and a code review card is rendered
- **THEN** the card header, diff hunks, and status badges use dark surface colors

#### Scenario: File diff view in dark mode
- **WHEN** dark mode is active and a file diff is rendered
- **THEN** the hunk header, load-more button, added/removed line highlights, and diff tags use dark-appropriate colors

#### Scenario: Reasoning bubble in dark mode
- **WHEN** dark mode is active and a reasoning bubble is rendered
- **THEN** the collapsed header and expanded body use dark surface colors

#### Scenario: Task detail drawer in dark mode
- **WHEN** dark mode is active and the task detail drawer is open
- **THEN** the input area, sidebar, launch bar, and warning dialogs use dark surface colors

#### Scenario: Setup view in dark mode
- **WHEN** dark mode is active and the Setup view is displayed
- **THEN** the page background, card, config summary, and project list items use dark surface colors

#### Scenario: Ask user prompt in dark mode
- **WHEN** dark mode is active and an ask-user prompt is rendered
- **THEN** the prompt background, question text, option text, and free-text input use dark-appropriate colors

#### Scenario: LSP setup prompt in dark mode
- **WHEN** dark mode is active and the LSP setup prompt is rendered
- **THEN** language cards use dark surface colors with dark borders

#### Scenario: Model tree thinking toggle in dark mode
- **WHEN** dark mode is active and the model tree thinking toggle row is visible
- **THEN** it uses a dark background instead of a light one

### Requirement: Monaco editor follows active theme
Monaco diff editor instances SHALL use `vs-dark` theme when dark mode is active and `vs` theme when light mode is active, updating immediately when the preference changes.

#### Scenario: Monaco uses dark theme in dark mode
- **WHEN** dark mode is activated
- **THEN** all Monaco editor instances switch to `vs-dark` theme without requiring a page reload

#### Scenario: Monaco uses light theme in light mode
- **WHEN** dark mode is deactivated
- **THEN** all Monaco editor instances switch to `vs` theme without requiring a page reload
