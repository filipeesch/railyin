<template>
  <div class="decisions-panel">
    <div v-if="loading" class="decisions-empty">Loading decisions…</div>
    <div v-else-if="!records.length" class="decisions-empty">No decisions recorded yet.</div>
    <div v-else>
      <div
        v-for="record in records"
        :key="record.id"
        class="decision-item"
        :class="record.weight"
      >
        <div class="decision-header">
          <span class="decision-weight">{{ record.weight.toUpperCase() }}</span>
          <span v-if="record.revisionCount > 0" class="decision-revised">
            revised {{ record.revisionCount }}×
          </span>
        </div>
        <div class="decision-question">
          <span v-html="renderMd(record.question)" /><span v-if="record.isSourceAi" class="decision-ai-badge">AI</span>
        </div>
        <div class="decision-answer">→ {{ record.answer }}</div>
        <div v-if="record.notes" class="decision-notes">{{ record.notes }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import type { DecisionRecord } from "@shared/rpc-types";
import { listDecisions } from "@/rpc";
import { useMarkdown } from "@/composables/useMarkdown";

const { renderMd } = useMarkdown();

const props = defineProps<{ conversationId: number }>();

const records = ref<DecisionRecord[]>([]);
const loading = ref(false);

async function fetchDecisions() {
  loading.value = true;
  try {
    records.value = await listDecisions({ conversationId: props.conversationId });
  } finally {
    loading.value = false;
  }
}

onMounted(fetchDecisions);
watch(() => props.conversationId, fetchDecisions);
</script>

<style scoped>
.decisions-panel {
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}
.decisions-empty {
  color: var(--text-secondary, #64748b);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}
.decision-item {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  border-left: 3px solid var(--border-color, #e2e8f0);
}
.decision-item.critical { border-left-color: #ef4444; }
.decision-item.medium { border-left-color: #f59e0b; }
.decision-item.easy { border-left-color: #22c55e; }
.decision-header {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
}
.decision-weight {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #64748b);
}
.decision-question {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 2px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.decision-ai-badge {
  font-size: 10px;
  background: var(--accent-color, #3b82f6);
  color: white;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  flex-shrink: 0;
}
.decision-answer {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}
.decision-notes {
  font-size: 12px;
  margin-top: 4px;
  color: var(--text-tertiary, #94a3b8);
  font-style: italic;
}
</style>
