import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { api } from "../rpc";
import type { Board, WorkflowTemplate } from "@shared/rpc-types";
import { findFirstBoardInWorkspace } from "../workspace-helpers";
import { readStorage, writeStorage } from "../utils/storage";

type BoardWithTemplate = Board & { template: WorkflowTemplate };

const STORAGE_KEY_BOARD = "railyn.activeBoardId";

export const useBoardStore = defineStore("board", () => {
  const boards = ref<BoardWithTemplate[]>([]);
  const activeBoardId = ref<number | null>(readStorage<number | null>(STORAGE_KEY_BOARD, null));
  const loading = ref(false);
  const error = ref<string | null>(null);

  const activeBoard = computed(() =>
    boards.value.find((b) => b.id === activeBoardId.value) ?? null,
  );

  watch(activeBoardId, (id) => {
    writeStorage(STORAGE_KEY_BOARD, id);
  });

  async function loadBoards(workspaceKey?: string) {
    loading.value = true;
    error.value = null;
    try {
      boards.value = await api("boards.list", {});
      const persisted = activeBoardId.value;
      const persistedBoard = persisted != null ? boards.value.find((b) => b.id === persisted) : null;
      const belongsToWorkspace = persistedBoard != null
        && (workspaceKey == null || persistedBoard.workspaceKey === workspaceKey);
      if (!belongsToWorkspace) {
        activeBoardId.value = workspaceKey != null
          ? findFirstBoardInWorkspace(boards.value, workspaceKey)
          : (boards.value[0]?.id ?? null);
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function createBoard(workspaceKey: string, name: string, workflowTemplateId: string, projectKeys: string[] = []) {
    const board = await api("boards.create", {
      workspaceKey,
      name,
      projectKeys,
      workflowTemplateId,
    });
    await loadBoards();
    activeBoardId.value = board.id;
    return board;
  }

  function selectBoard(id: number) {
    activeBoardId.value = id;
  }

  function selectFirstBoardInWorkspace(workspaceKey: string) {
    activeBoardId.value = findFirstBoardInWorkspace(boards.value, workspaceKey);
  }

  async function updateBoard(id: number, params: { name?: string; workflowTemplateId?: string; projectKeys?: string[] }) {
    const board = await api("boards.update", { id, ...params });
    await loadBoards();
    return board;
  }

  async function deleteBoard(id: number) {
    await api("boards.delete", { id });
    boards.value = boards.value.filter((b) => b.id !== id);
    if (activeBoardId.value === id) {
      activeBoardId.value = boards.value[0]?.id ?? null;
    }
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
    updateBoard,
    deleteBoard,
  };
});
