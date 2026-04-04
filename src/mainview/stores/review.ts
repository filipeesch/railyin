import { defineStore } from "pinia";
import { ref } from "vue";
import type { HunkDecision } from "@shared/rpc-types";

export type ReviewMode = "changes" | "review";
export type ReviewFilter = "all" | "unreviewed" | "needs_action" | "accepted";

export const useReviewStore = defineStore("review", () => {
  const isOpen = ref(false);
  const mode = ref<ReviewMode>("changes");
  const selectedFile = ref<string | null>(null);
  const filter = ref<ReviewFilter>("all");
  const taskId = ref<number | null>(null);
  const files = ref<string[]>([]); // ordered list of changed file paths

  // Optimistic updates: hunk hash → pending decision (in-flight write)
  const optimisticUpdates = ref(new Map<string, { decision: HunkDecision; comment: string | null }>());

  function openReview(forTaskId: number, filePaths: string[]) {
    taskId.value = forTaskId;
    files.value = filePaths;
    isOpen.value = true;
    mode.value = "changes";
    filter.value = "all";
    optimisticUpdates.value.clear();
    selectedFile.value = filePaths[0] ?? null;
  }

  function closeReview() {
    isOpen.value = false;
  }

  function resetSession() {
    taskId.value = null;
    files.value = [];
    isOpen.value = false;
    mode.value = "changes";
    selectedFile.value = null;
    filter.value = "all";
    optimisticUpdates.value.clear();
  }

  return {
    isOpen,
    mode,
    selectedFile,
    filter,
    taskId,
    files,
    optimisticUpdates,
    openReview,
    closeReview,
    resetSession,
  };
});
