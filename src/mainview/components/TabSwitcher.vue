<template>
  <div class="tab-switcher">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="tab-btn"
      :class="{ active: modelValue === tab.id }"
      @click="$emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  tabs: Array<{ id: string; label: string }>;
  modelValue: string;
}>();
defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<style scoped>
.tab-switcher {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
.tab-btn {
  padding: 4px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  border-radius: 4px;
  color: var(--text-secondary, #64748b);
}
.tab-btn.active {
  background: var(--accent-color, #3b82f6);
  color: white;
}
</style>
