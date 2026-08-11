# S03: Provider, harness, save + live reload

**Milestone:** M001
**Slice:** S03

**Goal:** Model list within engine detail panel — create/edit/delete models with form fields (name, modelId, reasoning, tool_call, thinkingLevel, limits) for pi engine type. Form changes update YAML preview in real time.
**Demo:** Edit provider and harness fields for pi engine type, save to engines.yaml, see the UI refresh without restart

## Must-Haves

- Model list shown in engine detail (collapsible section) for pi engine type
- Create new model with form: modelId (key), name, reasoning toggle, tool_call toggle, thinkingLevel select, context limit input, output limit input
- Edit existing model inline (expand model in list → form)
- Delete model with confirmation
- YAML preview updates on each create/edit/delete
- TypeScript compiles clean, build succeeds

## Proof Level

- This slice proves: integration

## Integration Closure

Full: create/edit/delete → YAML → Monaco proven end-to-end for pi engine models

## Verification

- No new observability needed

<tasks>
- [ ] **T01**: Add ModelManagementPanel component _(3h)_
  Create ModelManagementPanel.vue that shows a collapsible model list within the engine detail. For pi engines: list existing models, allow create (new model form), edit (inline form per model), delete (confirm). Fields: modelId, name, reasoning (toggle), tool_call (toggle), thinkingLevel (select), context limit, output limit. Changes emit modelUpdate with the new full engine YAML block.
  - Files: `src/mainview/components/ModelManagementPanel.vue`
  - Verify: TypeScript: bun tsc --noEmit (0 errors). Build: bun run build succeeds.
</tasks>

## Files Likely Touched

- src/mainview/components/ModelManagementPanel.vue
<!-- gsd:state-version=20:0 -->
