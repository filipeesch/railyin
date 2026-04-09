<template>
  <div class="shell-approval" :class="{ 'shell-approval--answered': !!answered }">
    <div class="shell-approval__header">
      <i class="pi pi-exclamation-triangle shell-approval__icon" />
      <span class="shell-approval__title">Shell command requires approval</span>
    </div>
    <div class="shell-approval__command">
      <code>{{ command }}</code>
    </div>
    <div class="shell-approval__binaries">
      <span class="shell-approval__binaries-label">Unapproved commands:</span>
      <span v-for="b in unapprovedBinaries" :key="b" class="shell-approval__binary">{{ b }}</span>
    </div>
    <div v-if="!answered" class="shell-approval__actions">
      <Button
        label="Approve once"
        size="small"
        severity="secondary"
        @click="respond('approve_once')"
      />
      <Button
        label="Approve for task"
        size="small"
        @click="respond('approve_all')"
      />
      <Button
        label="Deny"
        size="small"
        severity="danger"
        text
        @click="respond('deny')"
      />
    </div>
    <div v-else class="shell-approval__answered">
      <i class="pi pi-check-circle" />
      <span>{{ answered }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import Button from "primevue/button";

const props = defineProps<{
  command: string;
  unapprovedBinaries: string[];
  answered?: string;
}>();

const emit = defineEmits<{
  respond: [decision: "approve_once" | "approve_all" | "deny"];
}>();

function respond(decision: "approve_once" | "approve_all" | "deny") {
  emit("respond", decision);
}
</script>

<style scoped>
.shell-approval {
  border: 1px solid var(--p-orange-300, #fdba74);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--p-orange-50, #fff7ed);
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 480px;
}

.shell-approval--answered {
  opacity: 0.7;
}

.shell-approval__header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.shell-approval__icon {
  color: var(--p-orange-500, #f97316);
  font-size: 0.9rem;
}

.shell-approval__title {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--p-orange-800, #7c2d12);
}

.shell-approval__command {
  background: var(--p-surface-100, #f4f4f5);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 0.8rem;
  word-break: break-all;
}

.shell-approval__command code {
  font-family: monospace;
  color: var(--p-surface-800, #27272a);
}

.shell-approval__binaries {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.shell-approval__binaries-label {
  font-size: 0.78rem;
  color: var(--p-surface-500, #71717a);
}

.shell-approval__binary {
  background: var(--p-orange-100, #ffedd5);
  color: var(--p-orange-700, #c2410c);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.78rem;
  font-family: monospace;
}

.shell-approval__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.shell-approval__answered {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--p-surface-500, #71717a);
}
</style>

<style>
html.dark-mode .shell-approval__command {
  background: var(--p-surface-800, #1e293b);
}
html.dark-mode .shell-approval__command code {
  color: var(--p-surface-200, #e2e8f0);
}
</style>
