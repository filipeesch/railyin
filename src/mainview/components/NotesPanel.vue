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

    <!-- Tag bar -->
    <div v-if="!loading && notes.length > 0" class="notes-panel__tag-bar">
      <button
        class="tag-chip"
        :class="{ 'tag-chip--active': selectedTag == null }"
        @click="selectedTag = null"
      >
        All
      </button>
      <button
        v-for="tag in uniqueTags"
        :key="tag"
        class="tag-chip"
        :class="{ 'tag-chip--active': selectedTag === tag }"
        @click="toggleTag(tag)"
      >
        {{ tag }}
      </button>
    </div>

    <div v-if="loading" class="notes-empty">Loading notes…</div>
    <div v-else-if="!filteredNotes.length" class="notes-empty">
      <span v-if="notes.length === 0">No notes yet. Create one to get started.</span>
      <span v-else>No notes match the selected tag.</span>
    </div>
    <div v-else class="notes-list">
      <div
        v-for="note in filteredNotes"
        :key="note.id"
        class="note-item"
        @click="openEdit(note)"
      >
        <span v-if="note.isSourceAi" class="note-item__ai-badge">AI</span>
        <div v-if="note.tags && note.tags.length > 0" class="note-item__tags">
          <span v-for="tag in note.tags" :key="tag" class="note-item__tag-chip">{{ tag }}</span>
        </div>
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
import { ref, computed, onMounted, watch } from "vue";
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
const selectedTag = ref<string | null>(null);

const { renderMd } = useMarkdown();

// Compute unique tags from all notes, sorted alphabetically
const uniqueTags = computed(() => {
  const tagSet = new Set<string>();
  for (const note of notes.value) {
    if (note.tags) {
      for (const tag of note.tags) {
        tagSet.add(tag);
      }
    }
  }
  return Array.from(tagSet).sort();
});

// Filter notes by selected tag (client-side)
const filteredNotes = computed(() => {
  if (selectedTag.value == null) return notes.value;
  return notes.value.filter((note) => {
    if (!note.tags) return false;
    return note.tags.includes(selectedTag.value!);
  });
});

function toggleTag(tag: string) {
  selectedTag.value = selectedTag.value === tag ? null : tag;
}

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

.notes-panel__tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.tag-chip {
  background: var(--p-content-border-color, #e2e8f0);
  color: var(--p-text-color, #1e293b);
  border: none;
  border-radius: 12px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tag-chip:hover {
  background: var(--p-content-hover-background, #f1f5f9);
}

.tag-chip--active {
  background: var(--accent-color, #3b82f6);
  color: white;
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

.note-item__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.note-item__tag-chip {
  background: var(--p-content-border-color, #e2e8f0);
  color: var(--p-text-muted-color, #64748b);
  border-radius: 8px;
  padding: 1px 8px;
  font-size: 10px;
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
