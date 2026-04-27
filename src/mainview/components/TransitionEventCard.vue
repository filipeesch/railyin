<template>
  <article class="transition-card">
    <div class="transition-card__summary">
      <i class="pi pi-arrow-right transition-card__icon" />
      <span>{{ summaryText }}</span>
    </div>

    <div class="transition-card__meta">
      <span class="transition-card__pill">
        <strong>To</strong>
        <span>{{ toLabel }}</span>
      </span>
      <span v-if="fromLabel" class="transition-card__pill transition-card__pill--muted">
        <strong>From</strong>
        <span>{{ fromLabel }}</span>
      </span>
    </div>

    <details v-if="instructionText" class="transition-card__details">
      <summary class="transition-card__details-summary">Instructions</summary>
      <div class="transition-card__details-body">
        <InlineChipText :text="instructionText" />
      </div>
    </details>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ConversationMessage } from "@shared/rpc-types";
import InlineChipText from "./InlineChipText.vue";
import {
  formatTransitionSummary,
  getTransitionInstructionText,
  normalizeTransitionEventMetadata,
} from "../utils/transition-event";

const props = defineProps<{
  message: ConversationMessage;
}>();

const meta = computed(() =>
  props.message.type === "transition_event"
    ? normalizeTransitionEventMetadata(props.message.metadata)
    : null,
);

const toLabel = computed(() => meta.value?.to?.trim() || "?");
const fromLabel = computed(() => meta.value?.from?.trim() || "");
const instructionText = computed(() => getTransitionInstructionText(meta.value));
const summaryText = computed(() => formatTransitionSummary(meta.value));
</script>

<style scoped>
.transition-card {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.9rem 1rem;
  border: 1px solid color-mix(in srgb, var(--p-primary-500, #6366f1) 20%, var(--p-content-border-color));
  border-radius: 14px;
  background: color-mix(in srgb, var(--p-primary-500, #6366f1) 7%, var(--p-content-background));
}

.transition-card__summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.transition-card__icon {
  color: var(--p-primary-500, #6366f1);
}

.transition-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.transition-card__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.28rem 0.6rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-surface-500, #64748b) 12%, transparent);
  color: var(--p-text-color);
  font-size: 0.8rem;
}

.transition-card__pill strong {
  font-weight: 700;
}

.transition-card__pill--muted {
  background: color-mix(in srgb, var(--p-surface-500, #64748b) 8%, transparent);
}

.transition-card__details {
  border-top: 1px solid color-mix(in srgb, var(--p-surface-500, #64748b) 16%, transparent);
  padding-top: 0.15rem;
}

.transition-card__details-summary {
  cursor: pointer;
  color: var(--p-primary-600, #4f46e5);
  font-size: 0.84rem;
  font-weight: 600;
  list-style: none;
}

.transition-card__details-summary::-webkit-details-marker {
  display: none;
}

.transition-card__details-summary::before {
  content: "Show ";
}

.transition-card__details[open] .transition-card__details-summary::before {
  content: "Hide ";
}

.transition-card__details-body {
  margin-top: 0.65rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--p-surface-500, #64748b) 8%, transparent);
  font-size: 0.9rem;
  line-height: 1.55;
}
</style>
