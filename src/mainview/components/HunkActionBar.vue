<template>
  <!-- stopPropagation isolates this zone from Monaco's mouse and keyboard capture.
       mousedown.stop / pointerdown.stop prevent Monaco from calling setPointerCapture
       or e.preventDefault(), which in WebKit suppresses subsequent click events. -->
  <div class="hunk-bar" @mousedown.stop @pointerdown.stop @keydown.stop @keyup.stop @keypress.stop>
    <!-- Changes mode: read-only decision badge -->
    <div v-if="props.mode === 'changes'" class="hunk-bar__readonly">
      <span class="decision-badge" :class="`decision-badge--${currentDecision}`">
        {{ decisionLabel }}
      </span>
      <span v-if="currentComment" class="hunk-bar__comment-text">"{{ currentComment }}"</span>
    </div>

    <!-- Review mode: interactive -->
    <template v-else>
      <div class="hunk-bar__content">
        <div class="hunk-bar__actions">
          <button
            class="hunk-btn hunk-btn--accept"
            :class="{ 'hunk-btn--active': currentDecision === 'accepted' }"
            @click="handleDecide('accepted')"
          >
            ✓ Accept
          </button>
          <button
            class="hunk-btn hunk-btn--reject"
            :class="{ 'hunk-btn--active': currentDecision === 'rejected' }"
            @click="handleDecide('rejected')"
          >
            ✗ Reject
          </button>
          <button
            class="hunk-btn hunk-btn--cr"
            :class="{ 'hunk-btn--active': currentDecision === 'change_request' }"
            @click="handleDecide('change_request')"
          >
            ↩ Change Request
          </button>
          <button
            v-if="isDirty && currentDecision !== 'pending'"
            class="hunk-btn hunk-btn--save"
            @click="save"
          >
            Save
          </button>
        </div>

        <div class="hunk-bar__comment-area">
          <textarea
            ref="textareaEl"
            v-model="comment"
            class="hunk-bar__textarea"
            :class="{ 'hunk-bar__textarea--error': showCommentError }"
            placeholder="Comment (optional; required for Change Request)"
            rows="2"
            @input="onInput"
          />
          <span v-if="showCommentError" class="hunk-bar__error-msg">
            A comment is required for Change Request
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { HunkWithDecisions, HunkDecision } from "@shared/rpc-types";

const props = defineProps<{
  hunk: HunkWithDecisions;
  mode: "changes" | "review";
  onDecide: (hash: string, decision: HunkDecision, comment: string | null) => void;
}>();

const emit = defineEmits<{
  heightChange: [];
}>();

// Local state mirrors the hunk's persisted state
const currentDecision = ref<HunkDecision>(props.hunk.humanDecision);
const currentComment = ref<string | null>(props.hunk.humanComment);
const comment = ref<string>(props.hunk.humanComment ?? "");
const savedComment = ref<string>(props.hunk.humanComment ?? "");

const textareaEl = ref<HTMLTextAreaElement | null>(null);

const showCommentError = computed(
  () => currentDecision.value === "change_request" && !comment.value.trim(),
);

// Save button appears when comment has changed from persisted state
const isDirty = computed(() => comment.value !== savedComment.value);

const decisionLabel = computed<string>(() => {
  const labels: Record<HunkDecision, string> = {
    accepted: "Accepted",
    rejected: "Rejected",
    change_request: "Change Request",
    pending: "Pending",
  };
  return labels[currentDecision.value];
});

function handleDecide(decision: HunkDecision) {  console.log('[HunkActionBar] handleDecide', decision);  if (decision === "change_request" && !comment.value.trim()) {
    // Show validation error without saving
    currentDecision.value = "change_request";
    return;
  }
  currentDecision.value = decision;
  currentComment.value = comment.value || null;
  savedComment.value = comment.value;
  props.onDecide(props.hunk.hash, decision, comment.value || null);
}

function save() {
  if (currentDecision.value === "change_request" && !comment.value.trim()) return;
  currentComment.value = comment.value || null;
  savedComment.value = comment.value;
  props.onDecide(props.hunk.hash, currentDecision.value, comment.value || null);
}

function onInput() {
  emit("heightChange");
}
</script>

<style scoped>
.hunk-bar {
  background: #f8fafc;
  border-top: 2px solid #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  box-sizing: border-box;
}

.hunk-bar--highlight {
  animation: zone-highlight 0.6s ease-out;
}

@keyframes zone-highlight {
  0% {
    background: #dbeafe;
  }
  100% {
    background: #f8fafc;
  }
}

.hunk-bar__content {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hunk-bar__readonly {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.hunk-bar__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.hunk-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: #374151;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.hunk-btn:hover {
  background: #f1f5f9;
}

.hunk-btn--accept {
  background: #dcfce7;
  border-color: #86efac;
  color: #15803d;
}

.hunk-btn--accept:hover {
  background: #bbf7d0;
  border-color: #4ade80;
}

.hunk-btn--accept.hunk-btn--active {
  background: #22c55e;
  border-color: #16a34a;
  color: #fff;
}

.hunk-btn--reject {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #b91c1c;
}

.hunk-btn--reject:hover {
  background: #fecaca;
  border-color: #f87171;
}

.hunk-btn--reject.hunk-btn--active {
  background: #ef4444;
  border-color: #dc2626;
  color: #fff;
}

.hunk-btn--cr.hunk-btn--active {
  background: #ffedd5;
  border-color: #f97316;
  color: #c2410c;
}

.hunk-btn--save {
  margin-left: auto;
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}

.hunk-btn--save:hover {
  background: #2563eb;
  border-color: #2563eb;
}

.hunk-bar__comment-area {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hunk-bar__textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
  background: #fff;
  color: #374151;
  line-height: 1.4;
  outline: none;
}

.hunk-bar__textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.hunk-bar__textarea--error {
  border-color: #ef4444;
}

.hunk-bar__error-msg {
  font-size: 11px;
  color: #ef4444;
}

.decision-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.decision-badge--pending {
  background: #e2e8f0;
  color: #64748b;
}

.decision-badge--accepted {
  background: #dcfce7;
  color: #15803d;
}

.decision-badge--rejected {
  background: #fee2e2;
  color: #b91c1c;
}

.decision-badge--change_request {
  background: #ffedd5;
  color: #c2410c;
}

.hunk-bar__comment-text {
  font-size: 12px;
  color: #374151;
  font-style: italic;
}
</style>
