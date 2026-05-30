<template>
  <Teleport to="body">
    <div v-if="visible" class="note-overlay" @mousedown.stop @keydown.esc="onClose">
      <!-- Header -->
      <div class="note-overlay__header">
        <div class="note-overlay__title">
          <i class="pi pi-file-edit" />
          <span>{{ noteId == null ? "New Note" : "Edit Note" }}</span>
        </div>
        <div class="note-overlay__header-actions">
          <Button
            v-if="noteId != null"
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            aria-label="Delete note"
            :disabled="saving"
            @click="onDelete"
          />
          <Button
            icon="pi pi-times"
            severity="secondary"
            text
            rounded
            aria-label="Close"
            @click="onClose"
          />
        </div>
      </div>

      <!-- Body -->
      <div class="note-overlay__body">
        <div class="note-overlay__toolbar">
          <button
            class="note-overlay__tab"
            :class="{ 'note-overlay__tab--active': !previewMode }"
            @click="previewMode = false"
          >Edit</button>
          <button
            class="note-overlay__tab"
            :class="{ 'note-overlay__tab--active': previewMode }"
            @click="previewMode = true"
          >Preview</button>
        </div>

        <div v-if="!previewMode" class="note-overlay__edit">
          <textarea
            v-model="form.content"
            class="note-overlay__textarea"
            placeholder="Write markdown content here…"
          />
        </div>
        <div
          v-else
          class="note-overlay__preview markdown-content"
          v-html="renderedContent"
        />
      </div>

      <!-- Footer -->
      <div class="note-overlay__footer">
        <span v-if="error" class="note-overlay__error">{{ error }}</span>
        <div class="note-overlay__footer-actions">
          <Button label="Cancel" severity="secondary" @click="onClose" :disabled="saving" />
          <Button label="Save" severity="primary" :loading="saving" @click="onSave" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import { useMarkdown } from "../composables/useMarkdown";
import { createNote, updateNote, deleteNote } from "../rpc";
import Button from "primevue/button";

const props = defineProps<{
  visible: boolean;
  conversationId: number;
  noteId: number | null;
  initialContent?: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  deleted: [];
}>();

const previewMode = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const form = reactive({ content: "" });

const { renderMd } = useMarkdown();

const renderedContent = computed(() => {
  if (!form.content) return "<p><em>No content yet.</em></p>";
  return renderMd(form.content);
});

function resetForm() {
  previewMode.value = false;
  error.value = null;
  form.content = props.initialContent ?? "";
}

async function onSave() {
  if (!form.content.trim()) {
    error.value = "Content is required.";
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    if (props.noteId == null) {
      await createNote({
        conversationId: props.conversationId,
        content: form.content.trim(),
      });
    } else {
      await updateNote({
        id: props.noteId,
        content: form.content.trim(),
      });
    }
    emit("saved");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save note.";
  } finally {
    saving.value = false;
  }
}

async function onDelete() {
  if (props.noteId == null) return;
  if (!confirm("Delete this note? This cannot be undone.")) return;
  saving.value = true;
  error.value = null;
  try {
    await deleteNote({ id: props.noteId });
    emit("deleted");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to delete note.";
  } finally {
    saving.value = false;
  }
}

function onClose() {
  emit("close");
}

watch(
  () => props.visible,
  (visible) => { if (visible) resetForm(); },
  { immediate: true },
);
</script>

<style scoped>
.note-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--p-surface-0, #fff);
  display: flex;
  flex-direction: column;
}

.note-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.note-overlay__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
}

.note-overlay__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.note-overlay__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.note-overlay__toolbar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.note-overlay__tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--p-text-muted-color);
  margin-bottom: -1px;
}

.note-overlay__tab--active {
  border-bottom-color: var(--p-primary-color);
  color: var(--p-primary-color);
  font-weight: 500;
}

.note-overlay__edit {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.note-overlay__textarea {
  flex: 1;
  resize: none;
  border: none;
  padding: 12px 16px;
  font-size: 0.85rem;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  line-height: 1.5;
  background: var(--p-content-background);
  color: var(--p-text-color);
}

.note-overlay__textarea:focus {
  outline: none;
}

.note-overlay__preview {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--p-text-color);
}

.note-overlay__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
  gap: 1rem;
}

.note-overlay__error {
  flex: 1;
  font-size: 0.8rem;
  color: var(--p-red-500, #ef4444);
}

.note-overlay__footer-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  margin: 0.5em 0 0.25em;
  font-weight: 600;
}

.markdown-content :deep(p) {
  margin: 0.4em 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.5em;
}

.markdown-content :deep(code) {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.85em;
  background: var(--p-content-hover-background);
  padding: 1px 4px;
  border-radius: 3px;
}

.markdown-content :deep(pre) {
  background: var(--p-content-hover-background);
  border-radius: 4px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0.5em 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
}
</style>

<style>
html.dark-mode .note-overlay {
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .note-overlay__header {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .note-overlay__footer {
  border-top-color: var(--p-surface-700, #334155);
}
</style>
