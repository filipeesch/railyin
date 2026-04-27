<template>
  <span class="inline-chip-text">
    <template v-for="(segment, idx) in segments" :key="idx">
      <span v-if="segment.type === 'text'">{{ segment.text }}</span>
      <span
        v-else
        :class="[
          'inline-chip-text__chip',
          'msg__chip',
          `inline-chip-text__chip--${segment.kind}`,
          `msg__chip--${segment.kind}`,
        ]"
      >{{ segment.label }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { segmentChipText } from "../utils/chat-chips";

const props = defineProps<{
  text: string;
}>();

const segments = computed(() => segmentChipText(props.text));
</script>

<style scoped>
.inline-chip-text {
  white-space: pre-wrap;
}

.inline-chip-text__chip {
  display: inline-flex;
  align-items: center;
  margin: 0 0.12rem;
  padding: 0.08rem 0.45rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: 0.82em;
  font-weight: 600;
  line-height: 1.4;
  vertical-align: baseline;
}

.inline-chip-text__chip--slash {
  background: color-mix(in srgb, var(--p-primary-500, #6366f1) 14%, transparent);
}

.inline-chip-text__chip--file {
  background: color-mix(in srgb, var(--p-green-500, #22c55e) 14%, transparent);
}

.inline-chip-text__chip--tool {
  background: color-mix(in srgb, var(--p-orange-500, #f59e0b) 14%, transparent);
}
</style>
