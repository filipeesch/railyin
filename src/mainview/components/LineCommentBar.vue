<template>
  <!-- Same isolation guards as HunkActionBar — prevents Monaco mouse/keyboard capture -->
  <div class="line-comment-bar" @mousedown.stop @pointerdown.stop @keydown.stop @keyup.stop @keypress.stop>
    <!-- Open state: textarea + Post/Cancel buttons -->
    <template v-if="props.state === 'open'">
      <div class="line-comment-bar__header">
        <span class="line-comment-bar__range-label">{{ rangeLabel }}</span>
      </div>
      <div class="line-comment-bar__body">
        <textarea
          ref="textareaEl"
          v-model="draftComment"
          class="line-comment-bar__textarea"
          placeholder="Add a comment…"
          rows="2"
          @input="onTextareaInput"
        />
      </div>
      <div class="line-comment-bar__actions">
        <button
          class="lcb-btn lcb-btn--post"
          :disabled="!draftComment.trim()"
          @click="onPost"
        >
          Post
        </button>
        <button class="lcb-btn lcb-btn--cancel" @click="props.onCancel()">Cancel</button>
      </div>
    </template>

    <!-- Posted state: read-only display + Delete button -->
    <template v-else>
      <div class="line-comment-bar__posted">
        <span class="line-comment-bar__range-label">{{ rangeLabel }}</span>
        <span class="line-comment-bar__comment-text">{{ props.initialComment }}</span>
        <button class="lcb-btn lcb-btn--delete" @click="props.onDelete()">Delete</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from "vue";

const props = defineProps<{
  lineStart: number;
  lineEnd: number;
  state: "open" | "posted";
  initialComment?: string;
  onPost: (comment: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}>();

const emit = defineEmits<{
  heightChange: [];
}>();

const textareaEl = ref<HTMLTextAreaElement | null>(null);
const draftComment = ref(props.initialComment ?? "");

const rangeLabel = computed(() =>
  props.lineStart === props.lineEnd
    ? `Line ${props.lineStart}`
    : `Lines ${props.lineStart}–${props.lineEnd}`,
);

function onPost() {
  if (!draftComment.value.trim()) return;
  props.onPost(draftComment.value.trim());
}

function onTextareaInput() {
  nextTick(() => {
    const el = textareaEl.value;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
    emit("heightChange");
  });
}

onMounted(() => {
  if (props.state === "open") {
    // The ViewZone DOM node is placed into Monaco's layout asynchronously after mount.
    // Wait two animation frames so Monaco has committed zone layout before focusing.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        textareaEl.value?.focus();
      });
    });
  }
});
</script>

<style scoped>
.line-comment-bar {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 10px;
  background: var(--p-surface-0, #fff);
  border-left: 3px solid var(--p-blue-400, #60a5fa);
  font-size: 12px;
  font-family: var(--p-font-family, system-ui, sans-serif);
}

.line-comment-bar__header {
  margin-bottom: 4px;
}

.line-comment-bar__range-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--p-text-muted-color, #64748b);
  margin-right: 8px;
}

.line-comment-bar__body {
  margin-bottom: 4px;
}

.line-comment-bar__textarea {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
  font-family: inherit;
  background: var(--p-surface-50, #f8fafc);
  color: var(--p-text-color, #1e293b);
  overflow: hidden;
}

.line-comment-bar__textarea:focus {
  outline: none;
  border-color: var(--p-blue-400, #60a5fa);
}

.line-comment-bar__actions {
  display: flex;
  gap: 6px;
}

.line-comment-bar__posted {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.line-comment-bar__comment-text {
  flex: 1;
  color: var(--p-text-color, #1e293b);
  font-style: italic;
}

.lcb-btn {
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--p-surface-300, #cbd5e1);
  background: var(--p-surface-0, #fff);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  color: var(--p-text-color, #374151);
  transition: background 0.1s;
}

.lcb-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.lcb-btn--post {
  background: var(--p-blue-500, #3b82f6);
  border-color: var(--p-blue-500, #3b82f6);
  color: #fff;
}

.lcb-btn--post:not(:disabled):hover {
  background: var(--p-blue-600, #2563eb);
}

.lcb-btn--cancel:hover {
  background: var(--p-surface-100, #f1f5f9);
}

.lcb-btn--delete {
  border-color: var(--p-red-300, #fca5a5);
  color: var(--p-red-500, #ef4444);
}

.lcb-btn--delete:hover {
  background: var(--p-red-50, #fef2f2);
}
</style>
