import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { electroview } from "../rpc";
import type { Board, WorkflowTemplate } from "@shared/rpc-types";
import { findFirstBoardInWorkspace } from "../workspace-helpers";

type BoardWithTemplate = Board & { template: WorkflowTemplate };

export const useBoardStore = defineStore("board", () => {
  const boards = ref<BoardWithTemplate[]>([]);
  const activeBoardId = ref<number | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const activeBoard = computed(() =>
    boards.value.find((b) => b.id === activeBoardId.value) ?? null,
  );

  async function loadBoards() {
    loading.value = true;
    error.value = null;
    try {
      boards.value = await electroview.rpc.request["boards.list"]({});
      if (!activeBoardId.value && boards.value.length > 0) {
        activeBoardId.value = boards.value[0].id;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function createBoard(workspaceId: number, name: string, workflowTemplateId: string) {
    const board = await electroview.rpc.request["boards.create"]({
      workspaceId,
      name,
      projectIds: [],
      workflowTemplateId,
    });
    await loadBoards();
    activeBoardId.value = board.id;
    return board;
  }

  function selectBoard(id: number) {
    activeBoardId.value = id;
  }

  function selectFirstBoardInWorkspace(workspaceId: number) {
    activeBoardId.value = findFirstBoardInWorkspace(boards.value, workspaceId);
  }

  return {
    boards,
    activeBoardId,
    activeBoard,
    loading,
    error,
    loadBoards,
    createBoard,
    selectBoard,
    selectFirstBoardInWorkspace,
  };
});
