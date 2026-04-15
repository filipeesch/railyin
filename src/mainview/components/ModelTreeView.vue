<template>
  <div class="model-tree">
    <div v-if="loading" class="model-tree__loading">
      <ProgressSpinner style="width: 24px; height: 24px" />
      <span>Loading models…</span>
    </div>

    <div v-else-if="providers.length === 0" class="model-tree__empty">
      No providers configured.
    </div>

    <div v-else>
      <!-- Workspace-level thinking toggle -->
      <div class="model-tree__thinking-toggle" v-if="hasAdaptiveThinkingModels">
        <div class="model-tree__thinking-toggle-info">
          <span class="model-tree__thinking-toggle-label">Enable thinking</span>
          <span class="model-tree__thinking-toggle-desc">Send thinking requests for models that support adaptive reasoning (e.g. Claude 3.7+, Claude 4+ on Anthropic).</span>
        </div>
        <ToggleSwitch
          :modelValue="enableThinking"
          @update:modelValue="onToggleThinking"
        />
      </div>

      <div class="model-tree__search">
        <InputText
          v-model="searchQuery"
          placeholder="Search models…"
          size="small"
          class="w-full"
        />
      </div>
      <div class="model-tree__providers">
      <div
        v-for="provider in filteredProviders"
        :key="provider.id"
        class="provider-section"
      >
        <!-- Provider header -->
        <div class="provider-header" @click="toggleProvider(provider.id)">
          <i
            class="pi"
            :class="collapsed.has(provider.id) ? 'pi-chevron-right' : 'pi-chevron-down'"
          />
          <span class="provider-name">{{ provider.id }}</span>
          <Tag
            v-if="provider.error"
            severity="danger"
            value="error"
            class="provider-error-tag"
          />
          <span v-if="!provider.error" class="provider-count">
            {{ provider.models.filter((m) => m.enabled).length }}/{{ provider.models.length }} enabled
          </span>
          <Button
            label="Refresh"
            size="small"
            text
            class="provider-refresh"
            @click.stop="refresh(provider.id)"
            :loading="refreshing.has(provider.id)"
          />
        </div>

        <!-- Error state -->
        <div v-if="provider.error && !collapsed.has(provider.id)" class="provider-error">
          <i class="pi pi-exclamation-circle" />
          {{ provider.error }}
        </div>

        <!-- Model list -->
        <div
          v-if="!provider.error && !collapsed.has(provider.id)"
          class="model-list"
        >
          <label
            v-for="model in provider.filteredModels"
            :key="model.id"
            class="model-row"
          >
            <Checkbox
              :modelValue="model.enabled"
              :binary="true"
              @update:modelValue="(v: boolean) => onToggle(model.id, v)"
            />
            <div class="model-row__content" :title="model.description ?? model.id">
              <span class="model-id">{{ modelLabel(model) }}</span>
              <span v-if="model.description" class="model-description">{{ model.description }}</span>
              <span class="model-raw-id">{{ model.id }}</span>
            </div>
            <span v-if="model.contextWindow" class="model-ctx">
              {{ formatCtx(model.contextWindow) }}
            </span>
          </label>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Checkbox from "primevue/checkbox";
import ProgressSpinner from "primevue/progressspinner";
import InputText from "primevue/inputtext";
import ToggleSwitch from "primevue/toggleswitch";
import { useTaskStore } from "../stores/task";
import { useWorkspaceStore } from "../stores/workspace";

const props = withDefaults(defineProps<{ workspaceKey?: string }>(), { workspaceKey: undefined });

const taskStore = useTaskStore();
const workspaceStore = useWorkspaceStore();

const effectiveWorkspaceKey = computed(() => props.workspaceKey ?? workspaceStore.activeWorkspaceKey ?? undefined);

const loading = ref(false);
const collapsed = ref(new Set<string>());
const refreshing = ref(new Set<string>());
const searchQuery = ref("");

const providers = computed(() => taskStore.allProviderModels);

/** True when at least one loaded model supports adaptive thinking. */
const hasAdaptiveThinkingModels = computed(() =>
  providers.value.some((p) => p.models.some((m) => m.supportsAdaptiveThinking)),
);

const enableThinking = computed(() => workspaceStore.config?.enableThinking ?? false);

async function onToggleThinking(value: boolean) {
  await workspaceStore.setThinking(value);
}

const filteredProviders = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return [...providers.value]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((provider) => {
      const sortedModels = [...provider.models].sort((a, b) => a.id.localeCompare(b.id));
      const filteredModels = q
        ? sortedModels.filter((m) =>
          m.id.toLowerCase().includes(q) ||
          (m.displayName ?? "").toLowerCase().includes(q),
        )
        : sortedModels;
      return { ...provider, models: sortedModels, filteredModels };
    })
    .filter((provider) => !q || provider.filteredModels.length > 0);
});

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([
      workspaceStore.loadWorkspaces(),
      workspaceStore.load(),
    ]);
    await taskStore.loadAllModels(effectiveWorkspaceKey.value);
  } finally {
    loading.value = false;
  }
});

watch(
  effectiveWorkspaceKey,
  async (workspaceKey) => {
    if (workspaceKey == null) return;
    await taskStore.loadAllModels(workspaceKey);
  },
);

function toggleProvider(id: string) {
  if (collapsed.value.has(id)) {
    collapsed.value.delete(id);
  } else {
    collapsed.value.add(id);
  }
}

async function refresh(providerId: string) {
  refreshing.value.add(providerId);
  try {
    await taskStore.loadAllModels(effectiveWorkspaceKey.value);
  } finally {
    refreshing.value.delete(providerId);
  }
}

async function onToggle(qualifiedModelId: string, enabled: boolean) {
  await taskStore.setModelEnabled(qualifiedModelId, enabled, effectiveWorkspaceKey.value);
}

function modelLabel(model: { id: string; displayName?: string }): string {
  return model.displayName ?? model.id;
}

function formatCtx(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M ctx`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K ctx`;
  return `${tokens} ctx`;
}
</script>

<style scoped>
.model-tree {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.model-tree__thinking-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-surface-50, #f9fafb);
}

.model-tree__thinking-toggle-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-tree__thinking-toggle-label {
  font-size: 0.875rem;
  font-weight: 600;
}

.model-tree__thinking-toggle-desc {
  font-size: 0.775rem;
  color: var(--p-text-muted-color);
}

.model-tree__search {
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.model-tree__providers {
  max-height: 360px;
  overflow-y: auto;
}

.model-tree__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.model-tree__empty {
  padding: 16px;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.provider-section {
  border-bottom: 1px solid var(--p-content-border-color);
}

.provider-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 0.875rem;
  font-weight: 600;
}

.provider-header:hover {
  background: var(--p-content-hover-background);
}

.provider-name {
  flex: 1;
}

.provider-count {
  color: var(--p-text-muted-color);
  font-weight: 400;
  font-size: 0.8rem;
}

.provider-error-tag {
  font-size: 0.75rem;
}

.provider-refresh {
  padding: 2px 6px;
  font-size: 0.75rem;
}

.provider-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 32px;
  color: var(--p-red-500);
  font-size: 0.8rem;
}

.model-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0 8px 32px;
}

.model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 0;
  cursor: pointer;
  font-size: 0.8rem;
}

.model-row:hover {
  background: var(--p-content-hover-background);
}

.model-row__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-id {
  font-weight: 600;
}

.model-description {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  white-space: normal;
}

.model-raw-id {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  font-family: var(--p-font-family-mono, monospace);
}

.model-ctx {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}
</style>

<style>
html.dark-mode .model-tree__thinking-toggle {
  background: var(--p-surface-800, #1e293b);
}
</style>
