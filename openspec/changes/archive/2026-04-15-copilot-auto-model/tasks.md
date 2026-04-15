## 1. Type and Contract Updates

- [x] 1.1 Update shared model metadata/RPC types to allow nullable model identity for Auto (`qualifiedId: string | null`) where model lists are exchanged.
- [x] 1.2 Update backend model list handlers to preserve nullable Auto entries without breaking existing string-ID flows.
- [x] 1.3 Verify task model persistence semantics remain `task.model = null` for Auto (no sentinel string introduced).

## 2. Copilot Engine Model Listing

- [x] 2.1 Modify Copilot `listModels()` to prepend a synthetic `Auto` model entry at index 0.
- [x] 2.2 Add Auto description text explaining Copilot-managed model choice (context, availability, subscription access).
- [x] 2.3 Ensure concrete Copilot model entries remain unchanged (`copilot/<id>` qualified IDs, display name/context window/support flags).

## 3. Enabled-Model Filtering and Selection Semantics

- [x] 3.1 Update `models.listEnabled` flow so Auto is always returned for Copilot regardless of enabled_models rows.
- [x] 3.2 Keep enabled-model filtering applied only to concrete model IDs.
- [x] 3.3 Ensure selecting Auto results in `tasks.setModel(..., null)` and execution proceeds without pinned model.

## 4. Frontend Model Picker Behavior

- [x] 4.1 Update task detail model selector to accept/render nullable option values for Auto.
- [x] 4.2 Ensure Auto appears first in the dropdown and displays its description in option/value rendering.
- [x] 4.3 Validate selector behavior for filter/search, empty concrete-model sets, and transitions between concrete model and Auto.

## 5. Tests and Regression Coverage

- [x] 5.1 Add/adjust Copilot engine tests to assert Auto is first, nullable, and concrete entries remain intact.
- [x] 5.2 Add/adjust handlers tests for list/listEnabled behavior with Auto and enabled_models combinations.
- [x] 5.3 Add/adjust UI/store tests for selecting Auto and persisting null model.
- [x] 5.4 Run targeted backend/UI tests for model selection and Copilot execution paths and fix regressions.
