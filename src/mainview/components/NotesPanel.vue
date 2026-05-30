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
        <span v-if="note.isSourceAi" class="note-item__ai-badge">AI</span>
        <div class="note-item__content markdown-content" v-html="renderMd(note.content)" />
      </div>
    </div>

    <NoteDetailOverlay
      :visible="overlayVisible"
      :conversation-id="conversationId"
      :note-id="editingNoteId"
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
import { useMarkdown } from "@/composables/useMarkdown";
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

const { renderMd } = useMarkdown();

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
  position: relative;
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

.note-item__ai-badge {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 10px;
  background: var(--accent-color, #3b82f6);
  color: white;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}

.note-item__content {
  font-size: 13px;
  line-height: 1.5;
  max-height: 120px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
}
</style>

<style>
.note-item__content.markdown-content p { margin: 0.2em 0; }
.note-item__content.markdown-content h1,
.note-item__content.markdown-content h2,
.note-item__content.markdown-content h3 { margin: 0.2em 0; font-size: 0.95em; }
.note-item__content.markdown-content ul,
.note-item__content.markdown-content ol { margin: 0.2em 0; padding-left: 1.2em; }
</style>
