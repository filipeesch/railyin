<template>
  <Popover ref="popoverRef">
    <div class="ctx-popover">
      <div class="ctx-popover__header">
        <span class="ctx-popover__title">Context Window</span>
      </div>

      <div class="ctx-popover__body">
        <div v-if="contextUsage" class="ctx-popover__gauge-block">
          <div v-if="modelDisplayName" class="ctx-popover__model-name">{{ modelDisplayName }}</div>

          <!-- Linear gauge -->
          <div class="ctx-popover__bar-track">
            <div
              class="ctx-popover__bar-fill"
              :style="{ width: `${Math.min(contextUsage.fraction * 100, 100)}%` }"
              :class="{
                'ctx-popover__bar-fill--warn': contextUsage.fraction >= 0.70 && contextUsage.fraction < 0.90,
                'ctx-popover__bar-fill--danger': contextUsage.fraction >= 0.90,
              }"
            />
          </div>

          <div class="ctx-popover__gauge-label">
            <span class="ctx-popover__pct">{{ Math.round(contextUsage.fraction * 100) }}%</span>
            <span class="ctx-popover__tokens">
              ~{{ contextUsage.usedTokens.toLocaleString() }} / {{ contextUsage.maxTokens.toLocaleString() }} tokens
            </span>
          </div>
        </div>

        <div v-else class="ctx-popover__empty">
          Context usage unavailable
        </div>
      </div>

      <div v-if="supportsManualCompact" class="ctx-popover__footer">
        <Button
          label="Compact conversation"
          icon="pi pi-compress"
          size="small"
          severity="secondary"
          :disabled="disabled || compacting"
          :loading="compacting"
          class="ctx-popover__compact-btn"
          @click="onCompact"
        />
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Popover from "primevue/popover";
import Button from "primevue/button";

const props = defineProps<{
  contextUsage: { usedTokens: number; maxTokens: number; fraction: number } | null;
  modelDisplayName?: string;
  supportsManualCompact: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  compact: [];
}>();

const popoverRef = ref<InstanceType<typeof Popover> | null>(null);
const compacting = ref(false);

// ─── Public API ───────────────────────────────────────────────────────────────

function toggle(event: MouseEvent) {
  popoverRef.value?.toggle(event);
}

function getContainer(): HTMLElement | null {
  return (popoverRef.value as unknown as { $el?: HTMLElement })?.$el ?? null;
}

defineExpose({ toggle, getContainer, setCompacting });

// ─── Actions ──────────────────────────────────────────────────────────────────

function onCompact() {
  emit("compact");
}

/** Called by the parent after compact finishes to reset the loading state. */
function setCompacting(value: boolean) {
  compacting.value = value;
}
</script>

<style scoped>
.ctx-popover {
  min-width: 240px;
  max-width: 300px;
  display: flex;
  flex-direction: column;
}

.ctx-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem 0.25rem;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.ctx-popover__title {
  font-weight: 600;
  font-size: 0.85rem;
}

.ctx-popover__body {
  padding: 0.75rem;
}

.ctx-popover__model-name {
  font-size: 0.78rem;
  color: var(--p-text-muted-color, #64748b);
  margin-bottom: 0.5rem;
}

.ctx-popover__bar-track {
  height: 8px;
  border-radius: 4px;
  background: var(--p-surface-200, #e2e8f0);
  overflow: hidden;
  margin-bottom: 0.4rem;
}

.ctx-popover__bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--p-green-500, #22c55e);
  transition: width 0.3s ease;
}

.ctx-popover__bar-fill--warn {
  background: var(--p-yellow-500, #eab308);
}

.ctx-popover__bar-fill--danger {
  background: var(--p-red-500, #ef4444);
}

.ctx-popover__gauge-label {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.ctx-popover__pct {
  font-size: 0.85rem;
  font-weight: 600;
}

.ctx-popover__tokens {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #64748b);
}

.ctx-popover__empty {
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
}

.ctx-popover__footer {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 0.4rem 0.5rem 0.35rem;
  flex-shrink: 0;
}

.ctx-popover__compact-btn {
  width: 100%;
  justify-content: center;
}
</style>
