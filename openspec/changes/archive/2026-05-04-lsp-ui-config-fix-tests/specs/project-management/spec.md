# Spec: Project Management — Configure LSP Test Coverage (Delta)

## Delta Scope

This spec adds test scenarios for the "Configure LSP" button added to the project list row in `SetupView`. The base spec for `project-management` lives in `openspec/changes/lsp-ui-config-fix/specs/project-management/spec.md`.

## Additional Scenarios

### Suite L — Configure LSP Button (Playwright)

- **SCENARIO-PM-L1**: Button visible per project row
  - Given the Projects tab is open with at least one project registered
  - Then each project row shows a "Configure LSP" icon button

- **SCENARIO-PM-L2**: Click triggers detectLanguages for that project's path
  - Given `api.capture("lsp.detectLanguages")` is set up
  - When the "Configure LSP" button for project `app` is clicked
  - Then `detectLanguages` is called with `{ projectPath: <app path> }`

- **SCENARIO-PM-L3**: No languages detected shows feedback
  - Given `api.stub("lsp.detectLanguages", [])` returns empty array
  - When the "Configure LSP" button is clicked
  - Then a "No languages detected" message is shown
  - And the LSP setup prompt is NOT shown

- **SCENARIO-PM-L4**: Languages detected shows LspSetupPrompt
  - Given `api.stub("lsp.detectLanguages", ["typescript"])` returns a language
  - When the "Configure LSP" button is clicked
  - Then the `LspSetupPrompt` overlay is shown

- **SCENARIO-PM-L5**: addToConfig called with correct workspaceKey
  - Given `api.capture("lsp.addToConfig")` is set up
  - And the user selects a server and clicks Install
  - Then `addToConfig` is called with `workspaceKey` matching the active workspace

- **SCENARIO-PM-L6**: Dismiss stays on /setup
  - Given the LSP setup prompt is shown in dismissOnly mode
  - When the user clicks Done/Dismiss
  - Then the route remains `/setup`
  - And the prompt is closed

- **SCENARIO-PM-L7**: Two project rows operate independently
  - Given two projects `app` and `lib`
  - When "Configure LSP" for `app` is clicked and detected languages loaded
  - And then "Configure LSP" for `lib` is clicked
  - Then `detectLanguages` is called a second time with `lib`'s path

### Suite LP — LspSetupPrompt dismissOnly mode (Playwright)

- **SCENARIO-PM-LP1**: Default mode navigates to /boards on done
  - Given `LspSetupPrompt` is shown without `dismissOnly`
  - When the user clicks Done
  - Then the route changes to `/boards`

- **SCENARIO-PM-LP2**: dismissOnly mode stays on /setup on done
  - Given `LspSetupPrompt` is shown with `dismissOnly=true`
  - When the user clicks Done
  - Then the route remains `/setup`
