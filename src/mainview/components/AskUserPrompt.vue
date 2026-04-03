<template>
  <!-- Read-only (already answered) -->
  <div v-if="answered" class="ask-prompt ask-prompt--answered">
    <div class="ask-prompt__question">{{ question }}</div>
    <div class="ask-prompt__answer">
      <i class="pi pi-check-circle" />
      <span>{{ answeredText }}</span>
    </div>
  </div>

  <!-- Interactive -->
  <div v-else class="ask-prompt">
    <div class="ask-prompt__question">{{ question }}</div>

    <div class="ask-prompt__options">
      <!-- Single select: radio buttons -->
      <template v-if="selectionMode === 'single'">
        <label
          v-for="opt in options"
          :key="opt"
          class="ask-prompt__option"
        >
          <input
            type="radio"
            :name="radioGroup"
            :value="opt"
            v-model="singleSelected"
            @change="otherText = ''"
          />
          <span>{{ opt }}</span>
        </label>
        <label class="ask-prompt__option">
          <input
            type="radio"
            :name="radioGroup"
            value="__other__"
            v-model="singleSelected"
          />
          <span>Other (specify)</span>
        </label>
        <input
          v-if="singleSelected === '__other__'"
          v-model="otherText"
          type="text"
          class="ask-prompt__other-input"
          placeholder="Describe your answer…"
          @keydown.enter.prevent="submit"
        />
      </template>

      <!-- Multi select: checkboxes -->
      <template v-else>
        <label
          v-for="opt in options"
          :key="opt"
          class="ask-prompt__option"
        >
          <input
            type="checkbox"
            :value="opt"
            v-model="multiSelected"
          />
          <span>{{ opt }}</span>
        </label>
        <label class="ask-prompt__option">
          <input
            type="checkbox"
            value="__other__"
            v-model="multiSelected"
          />
          <span>Other (specify)</span>
        </label>
        <input
          v-if="multiSelected.includes('__other__')"
          v-model="otherText"
          type="text"
          class="ask-prompt__other-input"
          placeholder="Describe your answer…"
          @keydown.enter.prevent="submit"
        />
      </template>
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

const props = defineProps<{
  question: string;
  selectionMode: "single" | "multi";
  options: string[];
  /** If set, the widget is read-only and shows this as the submitted answer. */
  answeredText?: string;
}>();

const emit = defineEmits<{
  submit: [answer: string];
}>();

const answered = computed(() => props.answeredText !== undefined);

// Unique name per widget instance to avoid radio-button collisions
const radioGroup = `ask-prompt-${Math.random().toString(36).slice(2)}`;

const singleSelected = ref<string>("");
const multiSelected = ref<string[]>([]);
const otherText = ref("");

const canSubmit = computed(() => {
  if (props.selectionMode === "single") {
    if (!singleSelected.value) return false;
    if (singleSelected.value === "__other__") return otherText.value.trim().length > 0;
    return true;
  } else {
    if (multiSelected.value.length === 0) return false;
    if (multiSelected.value.includes("__other__")) return otherText.value.trim().length > 0;
    return true;
  }
});

function submit() {
  if (!canSubmit.value) return;

  let parts: string[] = [];

  if (props.selectionMode === "single") {
    const sel = singleSelected.value === "__other__" ? otherText.value.trim() : singleSelected.value;
    parts = [sel];
  } else {
    parts = multiSelected.value.map((v) =>
      v === "__other__" ? otherText.value.trim() : v,
    );
  }

  emit("submit", parts.join(", "));
}
</script>

<style scoped>
.ask-prompt {
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-primary-200, #c7d2fe);
  border-radius: 10px;
  padding: 14px 16px;
  max-width: 480px;
}

.ask-prompt--answered {
  opacity: 0.7;
}

.ask-prompt__question {
  font-weight: 600;
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

.ask-prompt__option input {
  accent-color: var(--p-primary-color, #6366f1);
  width: 15px;
  height: 15px;
  flex-shrink: 0;
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
