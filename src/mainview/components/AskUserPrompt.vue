<template>
  <!-- Read-only (already answered) -->
  <div v-if="answered" class="ask-prompt ask-prompt--answered">
    <div v-for="(q, qi) in questions" :key="qi" class="ask-prompt__section">
      <div class="ask-prompt__question prose" v-html="renderMd(q.question)" />
      <div class="ask-prompt__answer">
        <i class="pi pi-check-circle" />
        <span>{{ answeredText }}</span>
      </div>
    </div>
  </div>

  <!-- Interactive -->
  <div v-else class="ask-prompt">
    <div
      v-for="(q, qi) in questions"
      :key="qi"
      class="ask-prompt__section"
      :class="{ 'ask-prompt__section--with-preview': questionHasPreview(q) }"
    >
      <div class="ask-prompt__section-body">
        <div class="ask-prompt__question prose" v-html="renderMd(q.question)" />

        <div class="ask-prompt__options">
          <!-- Single select: radio buttons -->
          <template v-if="q.selection_mode === 'single'">
            <label
              v-for="opt in q.options"
              :key="opt.label"
              class="ask-prompt__option"
              :class="{ 'ask-prompt__option--recommended': opt.recommended }"
              @mouseenter="hoveredOption[qi] = opt.label"
              @mouseleave="hoveredOption[qi] = ''"
            >
              <input
                type="radio"
                :name="radioGroup + qi"
                :value="opt.label"
                v-model="singleSelected[qi]"
                @change="otherTexts[qi] = ''"
              />
              <span class="ask-prompt__option-label">{{ opt.label }}</span>
              <span v-if="opt.recommended" class="ask-prompt__badge">Recommended</span>
            </label>
            <p
              v-if="descriptionForSelected(q, qi)"
              class="ask-prompt__option-desc"
              v-html="renderMd(descriptionForSelected(q, qi)!)"
            />
            <label class="ask-prompt__option">
              <input
                type="radio"
                :name="radioGroup + qi"
                value="__other__"
                v-model="singleSelected[qi]"
              />
              <span class="ask-prompt__option-label">Other (specify)</span>
            </label>
            <input
              v-if="singleSelected[qi] === '__other__'"
              v-model="otherTexts[qi]"
              type="text"
              class="ask-prompt__other-input"
              placeholder="Describe your answer…"
              @keydown.enter.prevent="submit"
            />
          </template>

          <!-- Multi select: checkboxes -->
          <template v-else>
            <label
              v-for="opt in q.options"
              :key="opt.label"
              class="ask-prompt__option"
              :class="{ 'ask-prompt__option--recommended': opt.recommended }"
              @mouseenter="hoveredOption[qi] = opt.label"
              @mouseleave="hoveredOption[qi] = ''"
            >
              <input
                type="checkbox"
                :value="opt.label"
                v-model="multiSelected[qi]"
              />
              <span class="ask-prompt__option-label">{{ opt.label }}</span>
              <span v-if="opt.recommended" class="ask-prompt__badge">Recommended</span>
            </label>
            <label class="ask-prompt__option">
              <input
                type="checkbox"
                value="__other__"
                v-model="multiSelected[qi]"
              />
              <span class="ask-prompt__option-label">Other (specify)</span>
            </label>
            <input
              v-if="multiSelected[qi]?.includes('__other__')"
              v-model="otherTexts[qi]"
              type="text"
              class="ask-prompt__other-input"
              placeholder="Describe your answer…"
              @keydown.enter.prevent="submit"
            />
          </template>
        </div>
      </div>

      <!-- Preview pane: only rendered when options have preview content -->
      <div
        v-if="questionHasPreview(q) && previewFor(q, qi)"
        class="ask-prompt__preview"
      >
        <div class="ask-prompt__preview-label">Preview</div>
        <div class="ask-prompt__preview-content prose" v-html="renderMd(previewFor(q, qi)!)" />
      </div>
    </div>

    <button
      class="ask-prompt__submit"
      :disabled="!canSubmit"
      @click="submit"
    >
      Submit
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { marked } from "marked";
import type { AskUserQuestion } from "@shared/rpc-types";

function renderMd(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

const props = defineProps<{
  questions: AskUserQuestion[];
  /** If set, the widget is read-only and shows this as the submitted answer. */
  answeredText?: string;
}>();

const emit = defineEmits<{
  submit: [answer: string];
}>();

const answered = computed(() => props.answeredText !== undefined);

const radioGroup = `ask-prompt-${Math.random().toString(36).slice(2)}`;

// Per-question state arrays
const singleSelected = ref<string[]>(props.questions.map(() => ""));
const multiSelected = ref<string[][]>(props.questions.map(() => []));
const otherTexts = ref<string[]>(props.questions.map(() => ""));
const hoveredOption = ref<string[]>(props.questions.map(() => ""));

function questionHasPreview(q: AskUserQuestion): boolean {
  return q.options.some((o) => !!o.preview);
}

function currentSelection(q: AskUserQuestion, qi: number): string {
  if (q.selection_mode === "single") return singleSelected.value[qi] ?? "";
  return ""; // for multi, preview on hover
}

function previewFor(q: AskUserQuestion, qi: number): string | null {
  const focused = hoveredOption.value[qi] || currentSelection(q, qi);
  const opt = q.options.find((o) => o.label === focused);
  return opt?.preview ?? null;
}

function descriptionForSelected(q: AskUserQuestion, qi: number): string | null {
  const sel = q.selection_mode === "single" ? singleSelected.value[qi] : null;
  if (!sel || sel === "__other__") return null;
  const opt = q.options.find((o) => o.label === sel);
  return opt?.description ?? null;
}

const canSubmit = computed(() => {
  return props.questions.every((q, qi) => {
    if (q.selection_mode === "single") {
      const sel = singleSelected.value[qi];
      if (!sel) return false;
      if (sel === "__other__") return (otherTexts.value[qi] ?? "").trim().length > 0;
      return true;
    } else {
      const sel = multiSelected.value[qi] ?? [];
      if (sel.length === 0) return false;
      if (sel.includes("__other__")) return (otherTexts.value[qi] ?? "").trim().length > 0;
      return true;
    }
  });
});

function submit() {
  if (!canSubmit.value) return;

  const parts: string[] = props.questions.map((q, qi) => {
    if (q.selection_mode === "single") {
      const sel = singleSelected.value[qi];
      const val = sel === "__other__" ? otherTexts.value[qi].trim() : sel;
      return props.questions.length > 1 ? `${q.question}: ${val}` : val;
    } else {
      const sel = multiSelected.value[qi].map((v) =>
        v === "__other__" ? otherTexts.value[qi].trim() : v,
      );
      const val = sel.join(", ");
      return props.questions.length > 1 ? `${q.question}: ${val}` : val;
    }
  });

  emit("submit", parts.join("\n"));
}
</script>

<style scoped>
.ask-prompt {
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-primary-200, #c7d2fe);
  border-radius: 10px;
  padding: 14px 16px;
  max-width: 600px;
}

.ask-prompt--answered {
  opacity: 0.7;
}

.ask-prompt__section {
  margin-bottom: 16px;
}

.ask-prompt__section:last-of-type {
  margin-bottom: 0;
}

.ask-prompt__section--with-preview {
  display: flex;
  gap: 16px;
}

.ask-prompt__section-body {
  flex: 1;
  min-width: 0;
}

.ask-prompt__question {
  font-size: 0.92rem;
  margin-bottom: 12px;
  line-height: 1.4;
  color: var(--p-surface-800, #1e293b);
}

.ask-prompt__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.ask-prompt__option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--p-surface-700, #334155);
}

.ask-prompt__option--recommended .ask-prompt__option-label {
  font-weight: 500;
}

.ask-prompt__option input {
  accent-color: var(--p-primary-color, #6366f1);
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.ask-prompt__option-label {
  flex: 1;
}

.ask-prompt__badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--p-primary-100, #e0e7ff);
  color: var(--p-primary-700, #4338ca);
  letter-spacing: 0.02em;
}

.ask-prompt__option-desc {
  margin: 2px 0 4px 23px;
  font-size: 0.8rem;
  color: var(--p-surface-500, #64748b);
  line-height: 1.4;
}

.ask-prompt__preview {
  flex: 0 0 220px;
  border-left: 2px solid var(--p-surface-200, #e2e8f0);
  padding-left: 14px;
  min-width: 0;
}

.ask-prompt__preview-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-surface-400, #94a3b8);
  margin-bottom: 6px;
}

.ask-prompt__preview-content {
  font-size: 0.8rem;
  color: var(--p-surface-700, #334155);
  white-space: pre-wrap;
  word-break: break-word;
}

.ask-prompt__other-input {
  margin-left: 23px;
  padding: 6px 10px;
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 6px;
  font-size: 0.875rem;
  width: calc(100% - 23px);
  background: var(--p-surface-0, #fff);
  color: var(--p-surface-800, #1e293b);
}

.ask-prompt__submit {
  padding: 6px 18px;
  background: var(--p-primary-color, #6366f1);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: opacity 0.15s;
  margin-top: 4px;
}

.ask-prompt__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ask-prompt__answer {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--p-primary-color, #6366f1);
}
</style>
