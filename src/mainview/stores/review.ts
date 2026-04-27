import { defineStore } from "pinia";
import { ref } from "vue";

export type ReviewMode = "changes" | "review";
export type ReviewFilter = "all" | "unreviewed" | "needs_action" | "accepted";

export const useReviewStore = defineStore("review", () => {
  const isOpen = ref(false);
  const taskId = ref<number | null>(null);
  const files = ref<string[]>([]); // ordered list of changed file paths

  function openReview(forTaskId: number, filePaths: string[]) {
    taskId.value = forTaskId;
    files.value = filePaths;
    isOpen.value = true;
  }

  function closeReview() {
    isOpen.value = false;
  }

  function resetSession() {
    taskId.value = null;
    files.value = [];
    isOpen.value = false;
  }

  return {
    isOpen,
    taskId,
    files,
    openReview,
    closeReview,
    resetSession,
  };
});
