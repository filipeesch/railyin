<template>
  <!-- Answered (Phase 3 D-08 replay): collapsed summary -->
  <div v-if="answered" class="di di--answered" data-testid="decision-card">
    <div class="di__answered-head">
      <i class="pi pi-check-circle di__answered-icon" />
      <span class="di__answered-label">Decision recorded</span>
    </div>
    <div v-if="answeredText" class="di__answered-text">{{ answeredText }}</div>
  </div>

  <!-- Interactive: ported DecisionRequest form (DecisionRequest.vue) -->
  <div v-else class="di" data-testid="decision-card">
    <div v-if="payload.context" class="di__context prose" v-html="renderMd(payload.context)" />

    <div v-for="(q, qi) in payload.questions" :key="qi" class="di__section">
      <div class="di__question-header">
        <span class="di__question-text prose" v-html="renderMd(q.question)" />
        <span v-if="q.weight" class="di__weight-badge" :class="`di__weight-badge--${q.weight}`">
          {{ weightLabel(q.weight) }}
        </span>
      </div>

      <div v-if="q.model_lean" class="di__model-lean">
        🤖 I lean toward <strong>{{ q.model_lean }}</strong>
        <template v-if="q.model_lean_reason"> · {{ q.model_lean_reason }}</template>
      </div>

      <template v-if="q.type === 'freetext'">
        <textarea
          v-model="freetextValues[qi]"
          class="di__textarea di__textarea--freetext"
          placeholder="Your answer…"
        />
      </template>

      <template v-else>
        <div class="di__options">
          <div
            v-for="opt in q.options ?? []"
            :key="opt.title"
            class="di__option"
            :class="{ 'di__option--focused': focusedOption[qi] === opt.title, 'di__option--selected': isSelected(qi, q, opt.title) }"
            @click="onRowClick(qi, q, opt.title)"
          >
            <input
              v-if="q.type === 'non_exclusive'"
              type="checkbox"
              class="di__checkbox"
              :checked="isSelected(qi, q, opt.title)"
              @click.stop="onCheckboxClick(qi, q, opt.title)"
            />
            <span class="di__option-title">{{ opt.title }}</span>
            <span v-if="q.model_lean === opt.title" class="di__lean-badge">AI suggests</span>
          </div>

          <div
            class="di__option"
            :class="{ 'di__option--focused': focusedOption[qi] === '__other__', 'di__option--selected': isSelected(qi, q, '__other__') }"
            @click="onRowClick(qi, q, '__other__')"
          >
            <input
              v-if="q.type === 'non_exclusive'"
              type="checkbox"
              class="di__checkbox"
              :checked="isSelected(qi, q, '__other__')"
              @click.stop="onCheckboxClick(qi, q, '__other__')"
            />
            <span class="di__option-title">Other</span>
          </div>
        </div>

        <div class="di__desc-area" :class="{ 'di__desc-area--other': isSelected(qi, q, '__other__') || focusedOption[qi] === '__other__' }">
          <template v-if="isSelected(qi, q, '__other__') || focusedOption[qi] === '__other__'">
            <textarea
              v-model="otherValues[qi]"
              class="di__textarea di__textarea--other"
              placeholder="Describe your choice…"
            />
          </template>
          <template v-else-if="focusedOption[qi]">
            <div
              class="di__desc-panel prose"
              v-html="renderMd(descriptionFor(q, focusedOption[qi]!))"
            />
          </template>
          <template v-else>
            <div class="di__desc-placeholder">Select an option to see details.</div>
          </template>
        </div>

        <div v-if="focusedOption[qi] !== '__other__' && !isSelected(qi, q, '__other__')" class="di__notes">
          <label class="di__notes-label">Notes <span class="di__notes-optional">(optional)</span></label>
          <textarea
            v-model="notesValues[qi]"
            class="di__textarea di__textarea--notes"
            placeholder="Any additional context…"
          />
        </div>
      </template>

      <div v-if="q.answers_affect_followup" class="di__followup-hint">
        ✦ Your answer here will shape follow-up questions
      </div>
    </div>

    <div class="di__general-notes">
      <label class="di__notes-label">
        Additional context <span class="di__notes-optional">(optional)</span>
      </label>
      <textarea
        v-model="generalNotes"
        class="di__textarea di__textarea--notes"
        placeholder="Anything else the AI should know when recording these decisions…"
      />
    </div>

    <div class="di__footer">
      <label class="di__record-toggle">
        <input type="checkbox" v-model="recordAsDecisions" />
        <span>Record as decisions</span>
      </label>
      <button class="di__submit" :disabled="!canSubmit" data-testid="decision-submit" @click="submit">
        Submit Decision
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { Marked } from "marked";
import mermaid from "mermaid";
import type { Interrupt } from "@ag-ui/client";
import type { DecisionRequestPayload, DecisionRequestQuestion } from "@shared/rpc-types";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import {
  canSubmitDecisionRequest,
  buildDecisionAnswers,
  buildResumePayload,
  isOptionSelected as isOptionSelectedUtil,
  type DecisionRequestState,
} from "../../utils/decisionRequest";

/**
 * DecisionInterrupt — the `#interrupt` slot renderer (D-06, Phase 3 contract).
 *
 * Port of the legacy DecisionRequest.vue interview card. Renders
 * interrupt.metadata (DecisionRequestPayload { context?, questions[] }) with
 * the ported form logic: weight badges, "AI suggests" lean, option rows with
 * description preview, Other + notes, "Record as decisions" toggle, and the
 * "Submit Decision" CTA (UI-SPEC copy). This component does NOT call
 * resolve/cancel itself — RailyinChat wires emit → slot resolve/cancel (05-04).
 *
 * Resolved interrupts (Phase 3 D-08 replay) render a collapsed summary.
 */
const props = defineProps<{
  interrupt?: Interrupt | null;
  result?: unknown;
}>();

const emit = defineEmits<{
  submit: [
    payload: { decision: "approved"; answers: Array<{ question: string; answer: string; weight: string; notes?: string }>; generalNotes?: string; recordAsDecisions: boolean },
  ];
  cancel: [];
}>();

// ─── Mermaid-aware markdown (ported from DecisionRequest.vue:144-161) ────────

mermaid.initialize({ startOnLoad: false, theme: "dark" });

const mermaidMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      if (lang === "mermaid") {
        return `<pre class="mermaid">${text}</pre>`;
      }
      return false;
    },
  },
});

function renderMd(content: string): string {
  // CR-01: the interrupt context/question/description metadata is engine/LLM
  // controlled (prompt-injectable) — sanitize before v-html. The mermaid
  // <pre class="mermaid"> pass-through survives DOMPurify's allow-list.
  return sanitizeHtml(mermaidMarked.parse(content, { async: false }) as string);
}

// ─── Payload + answered state ────────────────────────────────────────────────

const payload = computed<DecisionRequestPayload>(() => {
  const meta = props.interrupt?.metadata;
  if (meta && typeof meta === "object" && Array.isArray((meta as DecisionRequestPayload).questions)) {
    return meta as DecisionRequestPayload;
  }
  return { questions: [] };
});

const answered = computed(() => props.result != null);

const answeredText = computed(() => {
  const r = props.result;
  if (typeof r === "string" && r.length > 0) return r;
  if (r && typeof r === "object") {
    const p = r as { payload?: { answers?: unknown[]; generalNotes?: unknown }; status?: string };
    const answers = Array.isArray(p.payload?.answers) ? p.payload.answers.length : 0;
    if (answers > 0) {
      const notes = typeof p.payload?.generalNotes === "string" && p.payload.generalNotes.length > 0
        ? ` — ${p.payload.generalNotes}`
        : "";
      return `${answers} answer${answers === 1 ? "" : "s"} recorded${notes}`;
    }
    if (p.status === "cancelled") return "Cancelled";
  }
  return "";
});

// ─── Form state (ported from DecisionRequest.vue) ─────────────────────────────

const interviewEl = ref<HTMLElement>();
const focusedOption = ref<string[]>(payload.value.questions.map(() => ""));
const singleSelected = ref<string[]>(payload.value.questions.map(() => ""));
const multiSelected = ref<string[][]>(payload.value.questions.map(() => []));
const otherValues = ref<string[]>(payload.value.questions.map(() => ""));
const notesValues = ref<string[]>(payload.value.questions.map(() => ""));
const freetextValues = ref<string[]>(payload.value.questions.map(() => ""));
const generalNotes = ref("");
const recordAsDecisions = ref(true);

watch(
  focusedOption,
  async () => {
    await nextTick();
    const nodes = interviewEl.value?.querySelectorAll<Element>(".mermaid");
    if (nodes?.length) await mermaid.run({ nodes });
  },
  { deep: true, flush: "post" },
);

watch(
  () => payload.value.questions,
  (newQuestions) => {
    focusedOption.value = newQuestions.map(() => "");
    singleSelected.value = newQuestions.map(() => "");
    multiSelected.value = newQuestions.map(() => []);
    otherValues.value = newQuestions.map(() => "");
    notesValues.value = newQuestions.map(() => "");
    freetextValues.value = newQuestions.map(() => "");
    generalNotes.value = "";
    recordAsDecisions.value = true;
  },
);

function weightLabel(weight: string): string {
  if (weight === "critical") return "⚠️ Hard to change later";
  if (weight === "medium") return "🔄 Can change with effort";
  return "💡 Easy to revisit";
}

function descriptionFor(q: DecisionRequestQuestion, title: string): string {
  return q.options?.find((o) => o.title === title)?.description ?? "";
}

function formState(): DecisionRequestState {
  return {
    singleSelected: singleSelected.value,
    multiSelected: multiSelected.value,
    otherValues: otherValues.value,
    freetextValues: freetextValues.value,
    notesValues: notesValues.value,
  };
}

function isSelected(qi: number, q: DecisionRequestQuestion, title: string): boolean {
  return isOptionSelectedUtil(q, title, formState(), qi);
}

function onRowClick(qi: number, q: DecisionRequestQuestion, title: string) {
  focusedOption.value[qi] = title;
  if (q.type === "exclusive") {
    singleSelected.value[qi] = title;
  }
}

function onCheckboxClick(qi: number, q: DecisionRequestQuestion, title: string) {
  const arr = multiSelected.value[qi] ?? [];
  const idx = arr.indexOf(title);
  if (idx >= 0) {
    multiSelected.value[qi] = arr.filter((t) => t !== title);
  } else {
    multiSelected.value[qi] = [...arr, title];
  }
}

const canSubmit = computed(() => canSubmitDecisionRequest(payload.value.questions, formState()));

function submit() {
  if (!canSubmit.value) return;
  emit("submit", buildResumePayload(payload.value.questions, formState(), generalNotes.value, recordAsDecisions.value));
}
</script>

<style scoped>
.di {
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-primary-200, #c7d2fe);
  border-radius: 10px;
  padding: 16px 18px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.di__context {
  font-size: 0.88rem;
  color: var(--p-surface-700, #334155);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
}

/* ── Section ─────────────────────────────────────── */
.di__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.di__question-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: -4px;
}

.di__question-text {
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--p-surface-800, #1e293b);
  line-height: 1.4;
}

/* ── Weight badge (ported hexes verbatim, UI-SPEC Color) ── */
.di__weight-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 1px;
}

.di__weight-badge--critical {
  background: #fef3c7;
  color: #92400e;
}

.di__weight-badge--medium {
  background: #dbeafe;
  color: #1e40af;
}

.di__weight-badge--easy {
  background: #dcfce7;
  color: #166534;
}

/* ── Model lean ───────────────────────────────────── */
.di__model-lean {
  font-size: 0.8rem;
  color: var(--p-surface-500, #64748b);
  font-style: italic;
  line-height: 1.4;
}

/* ── Options ──────────────────────────────────────── */
.di__options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.di__option {
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

.di__option:hover {
  background: var(--p-surface-100, #f1f5f9);
}

.di__option--focused {
  background: var(--p-primary-50, #eef2ff);
  color: var(--p-primary-700, #4338ca);
}

.di__option--selected:not(.di__option--focused) {
  font-weight: 500;
}

.di__option-title {
  flex: 1;
}

.di__lean-badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--p-primary-100, #e0e7ff);
  color: var(--p-primary-700, #4338ca);
}

.di__checkbox {
  accent-color: var(--p-primary-color, #6366f1);
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  cursor: pointer;
}

/* ── Description panel ────────────────────────────── */
.di__desc-area {
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--p-surface-0, #fff);
}

.di__desc-area--other {
  padding: 0;
  overflow: hidden;
}

.di__textarea--other {
  width: 100%;
  height: 100%;
  min-height: 200px;
  border: none;
  border-radius: 8px;
  resize: none;
  padding: 14px 16px;
  box-sizing: border-box;
}

.di__desc-panel {
  font-size: 0.875rem;
  color: var(--p-surface-700, #334155);
  line-height: 1.6;
}

.di__desc-placeholder {
  font-size: 0.85rem;
  color: var(--p-surface-400, #94a3b8);
  font-style: italic;
  padding-top: 4px;
}

/* ── Textareas ────────────────────────────────────── */
.di__textarea {
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

.di__textarea--freetext {
  min-height: 120px;
}

.di__textarea--notes {
  min-height: 80px;
}

/* ── Notes ────────────────────────────────────────── */
.di__notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.di__notes-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--p-surface-600, #475569);
}

.di__notes-optional {
  font-weight: 400;
  color: var(--p-surface-400, #94a3b8);
}

/* ── Followup hint ────────────────────────────────── */
.di__followup-hint {
  font-size: 0.75rem;
  color: var(--p-surface-400, #94a3b8);
  font-style: italic;
}

/* ── General notes ────────────────────────────────── */
.di__general-notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
}

/* ── Footer / toggle ──────────────────────────────── */
.di__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
}

.di__record-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--p-surface-600, #475569);
  cursor: pointer;
  user-select: none;
}

.di__record-toggle input {
  accent-color: var(--p-primary-color, #6366f1);
  width: 15px;
  height: 15px;
  cursor: pointer;
}

/* ── Submit Decision CTA (UI-SPEC copy) ───────────── */
.di__submit {
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

.di__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Answered collapsed summary ───────────────────── */
.di--answered {
  gap: 8px;
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-surface-200, #e2e8f0);
}

.di__answered-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--p-text-color, #1e293b);
}

.di__answered-icon {
  color: #16a34a;
  font-size: 0.85rem;
}

.di__answered-text {
  font-size: 0.78rem;
  color: var(--p-text-muted-color, #64748b);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

<style>
html.dark-mode .di {
  background: var(--p-surface-800, #1e293b);
  border-color: color-mix(in srgb, var(--p-primary-color) 40%, transparent);
}

html.dark-mode .di__context,
html.dark-mode .di__question-text,
html.dark-mode .di__desc-panel {
  color: var(--p-surface-100, #f1f5f9);
}

html.dark-mode .di__option {
  color: var(--p-surface-200, #e2e8f0);
}

html.dark-mode .di__option:hover {
  background: var(--p-surface-700, #334155);
}

html.dark-mode .di__option--focused {
  background: color-mix(in srgb, var(--p-primary-color) 20%, transparent);
  color: var(--p-primary-300, #a5b4fc);
}

html.dark-mode .di__desc-area {
  background: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-600, #475569);
}

html.dark-mode .di__textarea {
  background: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-600, #475569);
  color: var(--p-surface-100, #f1f5f9);
}

html.dark-mode .di__weight-badge--critical {
  background: #451a03;
  color: #fcd34d;
}

html.dark-mode .di__weight-badge--medium {
  background: #1e3a5f;
  color: #93c5fd;
}

html.dark-mode .di__weight-badge--easy {
  background: #14532d;
  color: #86efac;
}

html.dark-mode .di__general-notes {
  border-top-color: var(--p-surface-600, #475569);
}

html.dark-mode .di__footer {
  border-top-color: var(--p-surface-600, #475569);
}

html.dark-mode .di__record-toggle {
  color: var(--p-surface-300, #cbd5e1);
}

html.dark-mode .di--answered {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-700, #334155);
}
</style>
