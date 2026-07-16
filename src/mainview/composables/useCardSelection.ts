import { ref, computed } from "vue";
import type { Ref, ComputedRef } from "vue";

export interface CardSelectionState {
  isSelectionMode: Ref<boolean>;
  selectedIds: Ref<Set<number>>;
  selectedCount: ComputedRef<number>;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleSelection: (taskId: number) => void;
  clearSelection: () => void;
  isSelected: (taskId: number) => boolean;
}

export function useCardSelection(): CardSelectionState {
  const isSelectionMode = ref(false);
  const selectedIds = ref<Set<number>>(new Set());
  const selectedCount = computed(() => selectedIds.value.size);

  function enterSelectionMode(): void {
    isSelectionMode.value = true;
  }

  function exitSelectionMode(): void {
    isSelectionMode.value = false;
    selectedIds.value.clear();
  }

  function toggleSelection(taskId: number): void {
    const next = new Set(selectedIds.value);
    if (next.has(taskId)) {
      next.delete(taskId);
    } else {
      next.add(taskId);
    }
    selectedIds.value = next;
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
  }

  function isSelected(taskId: number): boolean {
    return selectedIds.value.has(taskId);
  }

  return {
    isSelectionMode,
    selectedIds,
    selectedCount,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelection,
    clearSelection,
    isSelected,
  };
}
