<template>
  <div class="notes-panel">
    <div class="notes-panel__toolbar">
      <Button
        icon="pi pi-plus"
        label="New note"
        size="small"
        severity="secondary"
        @click="openNew"
      />
    </div>

    <div v-if="loading" class="notes-empty">Loading notes…</div>
    <div v-else-if="!notes.length" class="notes-empty">No notes yet. Create one to get started.</div>
    <div v-else class="notes-list">
      <div
        v-for="note in notes"
        :key="note.id"
        class="note-item"
        @click="openEdit(note)"
      >
        <div class="note-item__header">
          <span v-if="note.title" class="note-item__title">{{ note.title }}</span>
          <span v-if="note.isSourceAi" class="note-item__ai-badge">AI</span>
          <span class="note-item__date">{{ formatDate(note.createdAt) }}</span>
        </div>
        <div class="note-item__preview">{{ previewText(note.content) }}</div>
      </div>
    </div>

    <NoteDetailOverlay
      :visible="overlayVisible"
      :conversation-id="conversationId"
      :note-id="editingNoteId"
      :initial-title="editingNote?.title ?? null"
      :initial-content="editingNote?.content ?? ''"
      @close="overlayVisible = false"
      @saved="onSaved"
      @deleted="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import type { TaskNote } from "@shared/rpc-types";
import { listNotes } from "@/rpc";
import Button from "primevue/button";
import NoteDetailOverlay from "./NoteDetailOverlay.vue";

const props = defineProps<{
  conversationId: number;
  refreshTrigger?: number;
}>();

const notes = ref<TaskNote[]>([]);
const loading = ref(false);
const overlayVisible = ref(false);
const editingNoteId = ref<number | null>(null);
const editingNote = ref<TaskNote | null>(null);

async function fetchNotes() {
  loading.value = true;
  try {
    notes.value = await listNotes({ conversationId: props.conversationId });
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editingNoteId.value = null;
  editingNote.value = null;
  overlayVisible.value = true;
}

function openEdit(note: TaskNote) {
  editingNoteId.value = note.id;
  editingNote.value = note;
  overlayVisible.value = true;
}

async function onSaved() {
  overlayVisible.value = false;
  await fetchNotes();
}

function previewText(content: string): string {
  const firstLine = content.replace(/#+\s*/g, "").split("\n").find((l) => l.trim());
  return firstLine ? (firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine) : "";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

onMounted(fetchNotes);
watch(() => props.conversationId, fetchNotes);
watch(() => props.refreshTrigger, fetchNotes);
</script>

<style scoped>
.notes-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.notes-panel__toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.notes-empty {
  color: var(--text-secondary, #64748b);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}

.notes-list {
  overflow-y: auto;
  flex: 1;
  padding: 8px;
}

.note-item {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--p-content-border-color);
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.note-item:hover {
  background: var(--p-content-hover-background);
}

.note-item__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.note-item__title {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-item__ai-badge {
  font-size: 10px;
  background: var(--accent-color, #3b82f6);
  color: white;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  flex-shrink: 0;
}

.note-item__date {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
  flex-shrink: 0;
}

.note-item__preview {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
