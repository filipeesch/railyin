## 1. Persistence and shared contract

- [x] 1.1 Add a conversation-level DB migration for v1 reasoning-mode persistence (nullable column) and wire row mapping updates.
- [x] 1.2 Extend shared RPC model metadata types to include normalized model-setting fields and raw provider metadata payloads.
- [x] 1.3 Thread the new conversation setting field through backend read/write paths used by tasks and chat sessions.

## 2. Engine discovery and normalization

- [x] 2.1 Extend Copilot model discovery mapping to pass through supported reasoning options and default value metadata.
- [x] 2.2 Extend Claude model discovery mapping to pass through effort/adaptive metadata into shared normalized fields.
- [x] 2.3 Implement Cursor variant/parameter eligibility mapping for reasoning-mode options using strict metadata-driven rules.
- [x] 2.4 Introduce a dedicated normalization layer/service that converts adapter-specific metadata into a unified normalized+raw contract.

## 3. Backend behavior and model-switch rules

- [x] 3.1 Update `models.listEnabled` response assembly to include normalized+raw setting metadata and hide-state semantics for unsupported models.
- [x] 3.2 Centralize model-switch compatibility evaluation (keep compatible, clear incompatible) in shared conversation-setting logic.
- [x] 3.3 Implement default persistence on model change when no explicit override exists and the selected model exposes a default.
- [x] 3.4 Add/extend conversation-setting RPC endpoints used by task and session chats to update reasoning-mode value.

## 4. Chat UI integration (task and session)

- [x] 4.1 Add reasoning-mode selector to shared `ConversationInput` using normalized metadata and provider-native option labels.
- [x] 4.2 Wire task chat model-setting updates to conversation-scoped persistence and model-switch compatibility behavior.
- [x] 4.3 Wire session chat model-setting updates to the same shared persistence and compatibility behavior.
- [x] 4.4 Ensure unsupported models hide the selector and clear stale UI values after model change.

## 5. Cleanup and refactoring

- [x] 5.1 Remove duplicated model-switch setting logic between task and session flows by introducing a single shared helper/service.
- [x] 5.2 Refactor adapter-specific metadata mapping into focused modules to avoid god classes in handlers and engine adapters.
- [x] 5.3 Consolidate legacy boolean-only setting capability paths behind the new normalized contract without breaking existing consumers.
- [x] 5.4 Update docs/comments near model metadata and conversation settings to reflect reasoning-mode naming and strict-discovery rules.
