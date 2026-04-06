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
            <span class="model-id">{{ modelLabel(model.id, provider.id) }}</span>
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
import { ref, computed, onMounted } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Checkbox from "primevue/checkbox";
import ProgressSpinner from "primevue/progressspinner";
import InputText from "primevue/inputtext";
import { useTaskStore } from "../stores/task";

const taskStore = useTaskStore();

const loading = ref(false);
const collapsed = ref(new Set<string>());
const refreshing = ref(new Set<string>());
const searchQuery = ref("");

const providers = computed(() => taskStore.allProviderModels);

const filteredProviders = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return [...providers.value]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((provider) => {
      const sortedModels = [...provider.models].sort((a, b) => a.id.localeCompare(b.id));
      const filteredModels = q
        ? sortedModels.filter((m) => m.id.toLowerCase().includes(q))
        : sortedModels;
      return { ...provider, models: sortedModels, filteredModels };
    })
    .filter((provider) => !q || provider.filteredModels.length > 0);
});

onMounted(async () => {
  loading.value = true;
  try {
    await taskStore.loadAllModels();
  } finally {
    loading.value = false;
  }
});

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
    await taskStore.loadAllModels();
  } finally {
    refreshing.value.delete(providerId);
  }
}

async function onToggle(qualifiedModelId: string, enabled: boolean) {
  await taskStore.setModelEnabled(qualifiedModelId, enabled);
}

function modelLabel(qualifiedId: string, providerId: string): string {
  return qualifiedId.startsWith(`${providerId}/`)
    ? qualifiedId.slice(providerId.length + 1)
    : qualifiedId;
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

.model-id {
  flex: 1;
  font-family: var(--p-font-family-mono, monospace);
}

.model-ctx {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}
</style>
