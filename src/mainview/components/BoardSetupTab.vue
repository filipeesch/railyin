<template>
  <div class="setup-section">
    <div class="boards-header">
      <h3>Boards</h3>
      <Button
        label="Add board"
        icon="pi pi-plus"
        size="small"
        severity="secondary"
        outlined
        @click="openAddBoard"
      />
    </div>

    <div v-if="visibleBoards.length === 0" class="setup-hint">
      No boards yet. Create one to get started.
    </div>

    <div v-else class="project-list">
      <div v-for="board in visibleBoards" :key="board.id" class="project-item">
        <i class="pi pi-table project-item__icon" />
        <div class="project-item__info">
          <span class="project-item__name">{{ board.name }}</span>
          <span class="project-item__path">{{ board.template.name }}</span>
        </div>
        <div class="project-item__actions">
          <Button
            icon="pi pi-pencil"
            severity="secondary"
            text
            size="small"
            aria-label="Edit board"
            title="Edit board"
            @click="openEditBoard(board)"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            size="small"
            aria-label="Delete board"
            title="Delete board"
            @click="onDeleteBoard(board)"
          />
        </div>
      </div>
    </div>
  </div>

  <BoardDetailDialog
    v-model="boardDialogVisible"
    :workspace-key="workspaceStore.activeWorkspaceKey ?? ''"
    :board="editingBoard ?? undefined"
    ref="boardDialogRef"
    @save="onBoardSave"
    @close="boardDialogVisible = false"
  />

  <Dialog
    v-model:visible="deleteConfirmVisible"
    header="Delete Board"
    :modal="true"
    :style="{ width: '420px' }"
  >
    <p v-if="deletingBoard" style="line-height: 1.6">
      Delete <strong>{{ deletingBoard.name }}</strong>? This cannot be undone.
    </p>
    <Message v-if="deleteError" severity="error" :closable="false" class="mt-2">
      {{ deleteError }}
    </Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="deleteConfirmVisible = false" :disabled="deleteInProgress" />
      <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deleteInProgress" @click="doDeleteBoard" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import { useToast } from "primevue/usetoast";
import { useBoardStore } from "../stores/board";
import { useWorkspaceStore } from "../stores/workspace";
import type { Board, WorkflowTemplate } from "@shared/rpc-types";
import BoardDetailDialog from "./BoardDetailDialog.vue";

type BoardWithTemplate = Board & { template: WorkflowTemplate };

const boardStore = useBoardStore();
const workspaceStore = useWorkspaceStore();
const toast = useToast();

const visibleBoards = computed(() =>
  boardStore.boards.filter((b) => b.workspaceKey === workspaceStore.activeWorkspaceKey),
);

// ── Board dialog ──────────────────────────────────────────────────────────────
const boardDialogVisible = ref(false);
const editingBoard = ref<BoardWithTemplate | null>(null);
const boardDialogRef = ref<InstanceType<typeof BoardDetailDialog> | null>(null);

function openAddBoard() {
  editingBoard.value = null;
  boardDialogVisible.value = true;
}

function openEditBoard(board: BoardWithTemplate) {
  editingBoard.value = board;
  boardDialogVisible.value = true;
}

async function onBoardSave(data: { name: string; workflowTemplateId: string; projectKeys: string[] }) {
  const dialog = boardDialogRef.value;
  dialog?.setSaving(true);
  try {
    if (editingBoard.value) {
      await boardStore.updateBoard(editingBoard.value.id, data);
    } else {
      await boardStore.createBoard(
        workspaceStore.activeWorkspaceKey ?? "default",
        data.name,
        data.workflowTemplateId,
        data.projectKeys,
      );
    }
    boardDialogVisible.value = false;
  } catch (e) {
    dialog?.setSaveError(e instanceof Error ? e.message : String(e));
  } finally {
    dialog?.setSaving(false);
  }
}

// ── Board delete ──────────────────────────────────────────────────────────────
const deleteConfirmVisible = ref(false);
const deletingBoard = ref<BoardWithTemplate | null>(null);
const deleteInProgress = ref(false);
const deleteError = ref<string | null>(null);

function onDeleteBoard(board: BoardWithTemplate) {
  if (board.taskCount > 0) {
    toast.add({
      severity: "warn",
      summary: "Cannot delete board",
      detail: `"${board.name}" has ${board.taskCount} task${board.taskCount !== 1 ? "s" : ""}. Delete all tasks first.`,
      life: 5000,
    });
    return;
  }
  deletingBoard.value = board;
  deleteError.value = null;
  deleteConfirmVisible.value = true;
}

async function doDeleteBoard() {
  if (!deletingBoard.value) return;
  deleteError.value = null;
  deleteInProgress.value = true;
  try {
    await boardStore.deleteBoard(deletingBoard.value.id);
    deleteConfirmVisible.value = false;
    deletingBoard.value = null;
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : String(e);
  } finally {
    deleteInProgress.value = false;
  }
}
</script>

<style scoped>
.setup-section { padding: 8px 0; }

.boards-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.boards-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.setup-hint {
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
  margin: 0 0 16px;
}

.project-list {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--p-surface-100, #f1f5f9);
  font-size: 0.88rem;
}

.project-item:last-child { border-bottom: none; }

.project-item__icon { color: var(--p-text-muted-color, #94a3b8); flex-shrink: 0; }

.project-item__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.project-item__name { font-weight: 500; }

.project-item__path {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-item__actions { display: flex; gap: 2px; flex-shrink: 0; }

.mt-2 { margin-top: 8px; }
</style>
