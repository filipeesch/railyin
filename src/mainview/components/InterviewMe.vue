<template>
  <!-- Read-only (already answered) -->
  <div v-if="answered" class="interview interview--answered">
    <div v-for="(q, qi) in questions" :key="qi" class="interview__answered-row">
      <span class="interview__answered-check">✓</span>
      <span class="interview__answered-question">{{ q.question }}</span>
      <span class="interview__answered-arrow">→</span>
      <span class="interview__answered-value">{{ answeredSummary[qi] }}</span>
    </div>
  </div>

  <!-- Interactive -->
  <div v-else class="interview">
    <!-- Context preamble -->
    <div v-if="context" class="interview__context prose" v-html="renderMd(context)" />

    <div v-for="(q, qi) in questions" :key="qi" class="interview__section">
      <!-- Question header -->
      <div class="interview__question-header">
        <span class="interview__question-text prose" v-html="renderMd(q.question)" />
        <span v-if="q.weight" class="interview__weight-badge" :class="`interview__weight-badge--${q.weight}`">
          {{ weightLabel(q.weight) }}
        </span>
      </div>

      <!-- Model lean -->
      <div v-if="q.model_lean" class="interview__model-lean">
        🤖 I lean toward <strong>{{ q.model_lean }}</strong>
        <template v-if="q.model_lean_reason"> · {{ q.model_lean_reason }}</template>
      </div>

      <!-- Freetext — just a textarea -->
      <template v-if="q.type === 'freetext'">
        <textarea
          v-model="freetextValues[qi]"
          class="interview__textarea interview__textarea--freetext"
          placeholder="Your answer…"
        />
      </template>

      <!-- Exclusive / non_exclusive options -->
      <template v-else>
        <!-- Option rows -->
        <div class="interview__options">
          <div
            v-for="opt in q.options ?? []"
            :key="opt.title"
            class="interview__option"
            :class="{ 'interview__option--focused': focusedOption[qi] === opt.title, 'interview__option--selected': isSelected(qi, q, opt.title) }"
            @click="onRowClick(qi, q, opt.title)"
          >
            <input
              v-if="q.type === 'non_exclusive'"
              type="checkbox"
              class="interview__checkbox"
              :checked="isSelected(qi, q, opt.title)"
              @click.stop="onCheckboxClick(qi, q, opt.title)"
            />
            <span class="interview__option-title">{{ opt.title }}</span>
            <span v-if="q.model_lean === opt.title" class="interview__lean-badge">AI suggests</span>
          </div>

          <!-- Other option -->
          <div
            class="interview__option"
            :class="{ 'interview__option--focused': focusedOption[qi] === '__other__', 'interview__option--selected': isSelected(qi, q, '__other__') }"
            @click="onRowClick(qi, q, '__other__')"
          >
            <input
              v-if="q.type === 'non_exclusive'"
              type="checkbox"
              class="interview__checkbox"
              :checked="isSelected(qi, q, '__other__')"
              @click.stop="onCheckboxClick(qi, q, '__other__')"
            />
            <span class="interview__option-title">Other</span>
          </div>
        </div>

        <!-- Description panel or Other textarea -->
        <div class="interview__desc-area" :class="{ 'interview__desc-area--other': focusedOption[qi] === '__other__' }">
          <template v-if="focusedOption[qi] === '__other__'">
            <textarea
              v-model="otherValues[qi]"
              class="interview__textarea interview__textarea--other"
              placeholder="Describe your choice…"
            />
          </template>
          <template v-else-if="focusedOption[qi]">
            <div
              class="interview__desc-panel prose"
              v-html="renderMd(descriptionFor(q, focusedOption[qi]!))"
            />
          </template>
          <template v-else>
            <div class="interview__desc-placeholder">Select an option to see details.</div>
          </template>
        </div>

        <!-- Notes (hidden when Other is focused) -->
        <div v-if="focusedOption[qi] !== '__other__'" class="interview__notes">
          <label class="interview__notes-label">Notes <span class="interview__notes-optional">(optional)</span></label>
          <textarea
            v-model="notesValues[qi]"
            class="interview__textarea interview__textarea--notes"
            placeholder="Any additional context…"
          />
        </div>
      </template>

      <!-- answers_affect_followup hint -->
      <div v-if="q.answers_affect_followup" class="interview__followup-hint">
        ✦ Your answer here will shape follow-up questions
      </div>
    </div>

    <button class="interview__submit" :disabled="!canSubmit" @click="submit">
      Submit
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { marked } from "marked";
import type { InterviewQuestion } from "@shared/rpc-types";

function renderMd(content: string): string {
  return marked.parse(content, { async: false, gfm: true, breaks: true }) as string;
}

const props = defineProps<{
  questions: InterviewQuestion[];
  context?: string;
  answeredText?: string;
}>();

const emit = defineEmits<{
  submit: [answer: string];
}>();

const answered = computed(() => props.answeredText !== undefined);

// Per-question state
const focusedOption = ref<string[]>(props.questions.map(() => ""));
const singleSelected = ref<string[]>(props.questions.map(() => ""));
const multiSelected = ref<string[][]>(props.questions.map(() => []));
const otherValues = ref<string[]>(props.questions.map(() => ""));
const notesValues = ref<string[]>(props.questions.map(() => ""));
const freetextValues = ref<string[]>(props.questions.map(() => ""));

function weightLabel(weight: string): string {
  if (weight === "critical") return "⚠️ Hard to change later";
  if (weight === "medium") return "🔄 Can change with effort";
  return "💡 Easy to revisit";
}

function descriptionFor(q: InterviewQuestion, title: string): string {
  return q.options?.find((o) => o.title === title)?.description ?? "";
}

function isSelected(qi: number, q: InterviewQuestion, title: string): boolean {
  if (q.type === "exclusive") return singleSelected.value[qi] === title;
  return multiSelected.value[qi]?.includes(title) ?? false;
}

function onRowClick(qi: number, q: InterviewQuestion, title: string) {
  focusedOption.value[qi] = title;
  if (q.type === "exclusive") {
    singleSelected.value[qi] = title;
  }
}

function onCheckboxClick(qi: number, q: InterviewQuestion, title: string) {
  const arr = multiSelected.value[qi] ?? [];
  const idx = arr.indexOf(title);
  if (idx >= 0) {
    multiSelected.value[qi] = arr.filter((t) => t !== title);
  } else {
    multiSelected.value[qi] = [...arr, title];
  }
}

const canSubmit = computed(() => {
  return props.questions.every((q, qi) => {
    if (q.type === "freetext") return (freetextValues.value[qi] ?? "").trim().length > 0;
    if (q.type === "exclusive") {
      const sel = singleSelected.value[qi];
      if (!sel) return false;
      if (sel === "__other__") return (otherValues.value[qi] ?? "").trim().length > 0;
      return true;
    }
    // non_exclusive
    const sel = multiSelected.value[qi] ?? [];
    if (sel.length === 0) return false;
    if (sel.includes("__other__")) return (otherValues.value[qi] ?? "").trim().length > 0;
    return true;
  });
});

// Build answered summary for read-only display
const answeredSummary = computed<string[]>(() => {
  if (!props.answeredText) return [];
  // Parse the structured Q/A/Notes format
  const lines = props.answeredText.split("\n");
  const summaries: string[] = [];
  let current = "";
  for (const line of lines) {
    if (line.startsWith("A: ")) current = line.slice(3);
    else if (line.startsWith("Q: ") && current) {
      summaries.push(current);
      current = "";
    }
  }
  if (current) summaries.push(current);
  // Pad to questions length
  while (summaries.length < props.questions.length) summaries.push("—");
  return summaries;
});

function submit() {
  if (!canSubmit.value) return;

  const parts: string[] = props.questions.map((q, qi) => {
    let answer = "";
    if (q.type === "freetext") {
      answer = freetextValues.value[qi].trim();
    } else if (q.type === "exclusive") {
      const sel = singleSelected.value[qi];
      answer = sel === "__other__" ? otherValues.value[qi].trim() : sel;
    } else {
      const sel = multiSelected.value[qi].map((v) =>
        v === "__other__" ? otherValues.value[qi].trim() : v,
      );
      answer = sel.join(", ");
    }

    const notes = q.type !== "freetext" && focusedOption.value[qi] !== "__other__"
      ? (notesValues.value[qi] ?? "").trim()
      : "";

    let part = `Q: ${q.question}\nA: ${answer}`;
    if (notes) part += `\nNotes: ${notes}`;
    return part;
  });

  emit("submit", parts.join("\n\n"));
}
</script>

<style scoped>
.interview {
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-primary-200, #c7d2fe);
  border-radius: 10px;
  padding: 16px 18px;
  max-width: 660px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.interview--answered {
  opacity: 0.75;
  gap: 6px;
}

.interview__context {
  font-size: 0.88rem;
  color: var(--p-surface-700, #334155);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
}

/* ── Section ─────────────────────────────────────── */
.interview__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.interview__question-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: -4px;
}

.interview__question-text {
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--p-surface-800, #1e293b);
  line-height: 1.4;
}

/* ── Weight badge ─────────────────────────────────── */
.interview__weight-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 1px;
}

.interview__weight-badge--critical {
  background: #fef3c7;
  color: #92400e;
}

.interview__weight-badge--medium {
  background: #dbeafe;
  color: #1e40af;
}

.interview__weight-badge--easy {
  background: #dcfce7;
  color: #166534;
}

/* ── Model lean ───────────────────────────────────── */
.interview__model-lean {
  font-size: 0.8rem;
  color: var(--p-surface-500, #64748b);
  font-style: italic;
  line-height: 1.4;
}

/* ── Options ──────────────────────────────────────── */
.interview__options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.interview__option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--p-surface-700, #334155);
  transition: background 0.1s;
  user-select: none;
}

.interview__option:hover {
  background: var(--p-surface-100, #f1f5f9);
}

.interview__option--focused {
  background: var(--p-primary-50, #eef2ff);
  color: var(--p-primary-700, #4338ca);
}

.interview__option--selected:not(.interview__option--focused) {
  font-weight: 500;
}

.interview__option-title {
  flex: 1;
}

.interview__lean-badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--p-primary-100, #e0e7ff);
  color: var(--p-primary-700, #4338ca);
}

.interview__checkbox {
  accent-color: var(--p-primary-color, #6366f1);
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  cursor: pointer;
}

/* ── Description panel ────────────────────────────── */
.interview__desc-area {
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--p-surface-0, #fff);
}

.interview__desc-area--other {
  padding: 0;
  overflow: hidden;
}

.interview__textarea--other {
  width: 100%;
  height: 100%;
  min-height: 200px;
  border: none;
  border-radius: 8px;
  resize: none;
  padding: 14px 16px;
  box-sizing: border-box;
}

.interview__desc-panel {
  font-size: 0.875rem;
  color: var(--p-surface-700, #334155);
  line-height: 1.6;
}

.interview__desc-placeholder {
  font-size: 0.85rem;
  color: var(--p-surface-400, #94a3b8);
  font-style: italic;
  padding-top: 4px;
}

/* ── Textareas ────────────────────────────────────── */
.interview__textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 6px;
  font-size: 0.875rem;
  background: var(--p-surface-0, #fff);
  color: var(--p-surface-800, #1e293b);
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  box-sizing: border-box;
}

.interview__textarea--freetext {
  min-height: 120px;
}

.interview__textarea--notes {
  min-height: 80px;
}

/* ── Notes ────────────────────────────────────────── */
.interview__notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.interview__notes-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--p-surface-600, #475569);
}

.interview__notes-optional {
  font-weight: 400;
  color: var(--p-surface-400, #94a3b8);
}

/* ── Followup hint ────────────────────────────────── */
.interview__followup-hint {
  font-size: 0.75rem;
  color: var(--p-surface-400, #94a3b8);
  font-style: italic;
}

/* ── Submit ───────────────────────────────────────── */
.interview__submit {
  align-self: flex-end;
  padding: 7px 20px;
  background: var(--p-primary-color, #6366f1);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: opacity 0.15s;
}

.interview__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Read-only ────────────────────────────────────── */
.interview__answered-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.875rem;
  flex-wrap: wrap;
}

.interview__answered-check {
  color: var(--p-primary-color, #6366f1);
  flex-shrink: 0;
}

.interview__answered-question {
  color: var(--p-surface-600, #475569);
  flex-shrink: 0;
}

.interview__answered-arrow {
  color: var(--p-surface-400, #94a3b8);
  flex-shrink: 0;
}

.interview__answered-value {
  color: var(--p-surface-800, #1e293b);
  font-weight: 500;
}
</style>

<style>
html.dark-mode .interview {
  background: var(--p-surface-800, #1e293b);
  border-color: color-mix(in srgb, var(--p-primary-color) 40%, transparent);
}

html.dark-mode .interview__context,
html.dark-mode .interview__question-text,
html.dark-mode .interview__desc-panel {
  color: var(--p-surface-100, #f1f5f9);
}

html.dark-mode .interview__option {
  color: var(--p-surface-200, #e2e8f0);
}

html.dark-mode .interview__option:hover {
  background: var(--p-surface-700, #334155);
}

html.dark-mode .interview__option--focused {
  background: color-mix(in srgb, var(--p-primary-color) 20%, transparent);
  color: var(--p-primary-300, #a5b4fc);
}

html.dark-mode .interview__desc-area {
  background: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-600, #475569);
}

html.dark-mode .interview__textarea {
  background: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-600, #475569);
  color: var(--p-surface-100, #f1f5f9);
}

html.dark-mode .interview__weight-badge--critical {
  background: #451a03;
  color: #fcd34d;
}

html.dark-mode .interview__weight-badge--medium {
  background: #1e3a5f;
  color: #93c5fd;
}

html.dark-mode .interview__weight-badge--easy {
  background: #14532d;
  color: #86efac;
}

html.dark-mode .interview__answered-value {
  color: var(--p-surface-100, #f1f5f9);
}
</style>
