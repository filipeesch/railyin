<template>
  <div class="engine-detail-panel">
    <!-- Common fields -->
    <div class="engine-detail-panel__fields">
      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">ID</span>
        <input
          class="engine-detail-panel__input"
          :value="engineId"
          disabled
        />
      </label>

      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">Name</span>
        <input
          class="engine-detail-panel__input"
          type="text"
          placeholder="Engine display name"
          @input="onFieldChange('name', $event)"
        />
      </label>
    </div>

    <!-- Type-specific fields -->
    <template v-if="engineType === 'copilot' || engineType === 'claude'">
      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">Model</span>
        <input
          class="engine-detail-panel__input"
          type="text"
          :value="configValue?.model ?? ''"
          placeholder="e.g. copilot/gpt-4.1 or claude/claude-sonnet-4-6"
          @input="onFieldChange('model', $event)"
        />
      </label>
    </template>

    <template v-if="engineType === 'cursor'">
      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">Model</span>
        <input
          class="engine-detail-panel__input"
          type="text"
          :value="configValue?.model ?? ''"
          placeholder="e.g. cursor/latest"
          @input="onFieldChange('model', $event)"
        />
      </label>
      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">API Key</span>
        <input
          class="engine-detail-panel__input"
          type="password"
          :value="configValue?.api_key ?? ''"
          placeholder="Leave blank to use $CURSOR_API_KEY"
          @input="onFieldChange('api_key', $event)"
        />
      </label>
    </template>

    <template v-if="engineType === 'pi'">
      <!-- Model -->
      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">Model</span>
        <input
          class="engine-detail-panel__input"
          type="text"
          :value="configValue?.model ?? ''"
          placeholder="e.g. lmstudio/qwen3-8b"
          @input="onFieldChange('model', $event)"
        />
      </label>

      <!-- Context window -->
      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">Context Window (tokens)</span>
        <input
          class="engine-detail-panel__input"
          type="number"
          :value="configValue?.context_window ?? ''"
          placeholder="128000"
          @input="onFieldChange('context_window', $event)"
        />
      </label>

      <!-- Dialect -->
      <label class="engine-detail-panel__field">
        <span class="engine-detail-panel__label">Slash Command Dialect</span>
        <select
          class="engine-detail-panel__input"
          :value="configValue?.dialect ?? ''"
          @change="onFieldChange('dialect', $event)"
        >
          <option value="">none (default)</option>
          <option value="copilot">copilot</option>
          <option value="claude">claude</option>
          <option value="none">none</option>
        </select>
      </label>
    </template>

    <!-- Type badge -->
    <div class="engine-detail-panel__type-badge">
      <span class="engine-detail-panel__type-label">{{ engineType }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import * as jsYaml from "js-yaml";

const props = defineProps<{
  engineId: string;
  engineType: string;
  rawYaml: string;
}>();

const emit = defineEmits<{
  yamlUpdate: [yaml: string];
}>();

// Parse the engine block from YAML
const configValue = computed(() => {
  try {
    const doc = jsYaml.load(props.rawYaml);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      return doc as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors
  }
  return {};
});

function onFieldChange(field: string, event: Event) {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  const value = input.value;

  // Parse current engine block
  let block: Record<string, unknown>;
  try {
    const doc = jsYaml.load(props.rawYaml);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      block = { ...doc };
    } else {
      block = {};
    }
  } catch {
    block = {};
  }

  // Apply the change
  if (value === "" || value === null || value === undefined) {
    delete (block as Record<string, unknown>)[field];
  } else {
    // Handle numeric fields
    if (field === "context_window" || field === "undo_stack_size") {
      const num = Number(value);
      if (!isNaN(num)) {
        (block as Record<string, unknown>)[field] = num;
      }
    } else {
      (block as Record<string, unknown>)[field] = value;
    }
  }

  // Re-serialize
  const newYaml = jsYaml.dump(block);
  emit("yamlUpdate", newYaml);
}
</script>

<style scoped>
.engine-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
  flex-shrink: 0;
}

.engine-detail-panel__fields {
  display: flex;
  gap: 0.75rem;
}

.engine-detail-panel__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.engine-detail-panel__field:nth-child(2) {
  max-width: 300px;
}

.engine-detail-panel__label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.engine-detail-panel__input {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #1e293b);
  outline: none;
  transition: border-color 0.15s;
}

.engine-detail-panel__input:focus {
  border-color: var(--p-blue-500, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.engine-detail-panel__input:disabled {
  background: var(--p-surface-100, #f1f5f9);
  cursor: not-allowed;
}

.engine-detail-panel__type-badge {
  margin-top: 0.25rem;
}

.engine-detail-panel__type-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-blue-600, #2563eb);
  background: var(--p-blue-50, #eff6ff);
  padding: 0.15rem 0.6rem;
  border-radius: 4px;
  text-transform: uppercase;
}
</style>

<style>
html.dark-mode .engine-detail-panel__input {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-600, #475569);
  color: var(--p-surface-0, #fff);
}

html.dark-mode .engine-detail-panel__input:focus {
  border-color: var(--p-blue-400, #60a5fa);
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
}

html.dark-mode .engine-detail-panel__input:disabled {
  background: var(--p-surface-700, #334155);
}

html.dark-mode .engine-detail-panel__type-label {
  color: var(--p-blue-400, #60a5fa);
  background: var(--p-blue-900, #1e3a5f);
}
</style>
