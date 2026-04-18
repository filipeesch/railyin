<template>
  <div class="board-view">
    <!-- Header bar -->
    <div class="board-header">
      <div class="board-header__left">
        <div v-if="workspaceStore.workspaces.length > 0" class="workspace-tabs">
          <button
            v-for="workspace in workspaceStore.workspaces"
            :key="workspace.key"
            type="button"
            class="workspace-tab"
            :class="{ 'is-active': workspaceStore.activeWorkspaceKey === workspace.key }"
            @click="onWorkspaceChange(workspace.key)"
          >
            <span>{{ workspace.name }}</span>
            <span
              v-if="taskStore.workspaceHasUnread(workspace.key, boardStore.boards)"
              class="workspace-tab__unread-dot"
              aria-label="Unread workspace activity"
            />
          </button>
        </div>
        <Select
          v-model="boardStore.activeBoardId"
          :options="visibleBoards"
          option-label="name"
          option-value="id"
          placeholder="Select board"
          class="board-selector"
          @change="onBoardChange"
        />
        <Button
          icon="pi pi-pencil"
          severity="secondary"
          text
          rounded
          aria-label="Edit workflow"
          :disabled="!boardStore.activeBoard"
          @click="onEditWorkflow"
        />
      </div>
      <div class="board-header__right">
        <Button
          :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
          severity="secondary"
          text
          rounded
          :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleDark"
        />
        <Button
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="Settings"
          @click="router.push('/setup')"
        />

      </div>
    </div>

    <!-- Board columns -->
    <div v-if="boardStore.activeBoard" class="board-columns">
      <div
        v-for="column in boardStore.activeBoard.template.columns"
        :key="column.id"
        class="board-column"
        :class="{ 'is-drag-over': dragOverColumnId === column.id }"
        :data-column-id="column.id"
        @drop.prevent
      >
        <!-- Column header -->
        <div class="board-column__header">
          <span class="board-column__name">{{ column.label }}</span>
          <Badge
            :value="columnTasks(column.id).length"
            severity="secondary"
          />
        </div>

        <!-- Create Task button (only for backlog column) -->
        <div
          v-if="column.id === 'backlog'"
          class="board-column__create-task"
        >
          <Button
            label="New Task"
            icon="pi pi-plus"
            @click="openCreateOverlay"
          />
        </div>

        <!-- Task cards -->
        <div class="board-column__cards">
          <TaskCard
            v-for="task in columnTasks(column.id)"
            :key="task.id"
            :task="task"
            @pointerdown="onCardPointerDown($event, task.id)"
            @click="onCardClick(task.id)"
            @open-review="onOpenReview(task.id)"
            @open-terminal="onOpenTerminal"
          />
          <div
            v-if="dragOverColumnId === column.id"
            class="drop-indicator"
            :style="{ top: dropIndicatorY + 'px' }"
          />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!boardStore.loading" class="board-empty">
      <i class="pi pi-inbox" style="font-size: 3rem; color: var(--p-text-muted-color)" />
      <p>No boards yet. <a href="#" @click.prevent="router.push('/setup')">Create one in setup.</a></p>
    </div>

    <!-- Task detail drawer -->
    <TaskDetailDrawer />

    <!-- Code review overlay -->
    <CodeReviewOverlay />

    <!-- Workflow YAML editor overlay -->
    <WorkflowEditorOverlay
      v-if="workflowEditor.templateId"
      :visible="workflowEditor.visible"
      :workspace-key="workspaceStore.activeWorkspaceKey ?? undefined"
      :template-id="workflowEditor.templateId"
      :template-name="workflowEditor.templateName"
      :initial-yaml="workflowEditor.yaml"
      @close="workflowEditor.visible = false"
      @saved="onWorkflowSaved"
    />

    <!-- Task Detail Overlay (for both create and edit) -->
    <TaskDetailOverlay
      v-if="boardStore.activeBoardId"
      :visible="showCreateTask || activeTaskForOverlay !== null"
      :task-id="activeTaskForOverlay"
      :board-id="boardStore.activeBoardId"
      @close="handleOverlayClose"
      @saved="handleOverlaySaved"
      @deleted="handleOverlayDeleted"
    />
    <!-- PTY Terminal Dialog -->
    <Dialog
      v-model:visible="ptyDialogVisible"
      header="Terminal"
      :modal="true"
      :style="{ width: '900px', height: '600px' }"
      :content-style="{ padding: 0, height: 'calc(100% - 56px)', display: 'flex', flexDirection: 'column' }"
    >
      <PtyTerminal v-if="ptySessionId" :session-id="ptySessionId" style="flex: 1; min-height: 0;" />
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useDarkMode } from "../composables/useDarkMode";
import { api, onWorkflowReloaded } from "../rpc";
import Select from "primevue/select";
import Button from "primevue/button";
import Badge from "primevue/badge";
import { useBoardStore } from "../stores/board";
import { useTaskStore } from "../stores/task";
import { useProjectStore } from "../stores/project";
import { useReviewStore } from "../stores/review";
import { useWorkspaceStore } from "../stores/workspace";
import TaskCard from "../components/TaskCard.vue";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";
import TaskDetailOverlay from "../components/TaskDetailOverlay.vue";
import CodeReviewOverlay from "../components/CodeReviewOverlay.vue";
import WorkflowEditorOverlay from "../components/WorkflowEditorOverlay.vue";
import Dialog from "primevue/dialog";
import PtyTerminal from "../components/PtyTerminal.vue";

const router = useRouter();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const taskStore = useTaskStore();
const projectStore = useProjectStore();
const reviewStore = useReviewStore();
const { isDark, toggle: toggleDark } = useDarkMode();

const showCreateTask = ref(false);
const activeTaskForOverlay = ref<number | null>(null);
const dragOverColumnId = ref<string | null>(null);
const dropIndex = ref<number | null>(null);
const dropIndicatorY = ref<number>(0);
let lastDragEndTime = 0;
const ptySessionId = ref<string | null>(null);
const ptyDialogVisible = ref(false);

function onOpenTerminal(sessionId: string) {
  ptySessionId.value = sessionId;
  ptyDialogVisible.value = true;
}

// ─── Workflow editor state ────────────────────────────────────────────────────

const workflowEditor = ref({
  visible: false,
  templateId: "",
  templateName: "",
  yaml: "",
});

const visibleBoards = computed(() => {
  const workspaceKey = workspaceStore.activeWorkspaceKey;
  if (workspaceKey == null) return boardStore.boards;
  return boardStore.boards.filter((board) => board.workspaceKey === workspaceKey);
});

async function onEditWorkflow() {
  const board = boardStore.activeBoard;
  if (!board) return;
  try {
    const { yaml } = await api("workflow.getYaml", {
      workspaceKey: workspaceStore.activeWorkspaceKey ?? undefined,
      templateId: board.workflowTemplateId,
    });
    workflowEditor.value = {
      visible: true,
      templateId: board.workflowTemplateId,
      templateName: board.template.name,
      yaml,
    };
  } catch (err) {
    console.error("[workflow] Failed to load YAML:", err);
  }
}

async function onWorkflowSaved() {
  await boardStore.loadBoards();
}

// Reload board when backend notifies workflow was saved
onWorkflowReloaded(async () => {
  await boardStore.loadBoards();
});

type DragState = {
  taskId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
  ghostEl: HTMLElement | null;
  sourceEl: HTMLElement | null;
  sourceColumnId: string | null;
};
let activeDrag: DragState | null = null;

// Load tasks when active board changes
watch(
  () => boardStore.activeBoardId,
  async (id) => {
    if (id != null) {
      await taskStore.loadTasks(id);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await projectStore.loadProjects();
  if (workspaceStore.activeWorkspaceKey != null && !boardStore.activeBoard) {
    boardStore.selectFirstBoardInWorkspace(workspaceStore.activeWorkspaceKey);
  }
});

function columnTasks(columnId: string) {
  const boardId = boardStore.activeBoardId;
  if (!boardId) return [];
  return (taskStore.tasksByBoard[boardId] ?? [])
    .filter((t) => t.workflowState === columnId)
    .slice()
    .sort((a, b) => a.position - b.position);
}

async function onBoardChange() {
  const id = boardStore.activeBoardId;
  if (id != null) await taskStore.loadTasks(id);
}

async function onWorkspaceChange(workspaceKey: string) {
  await workspaceStore.selectWorkspace(workspaceKey);
  boardStore.selectFirstBoardInWorkspace(workspaceKey);
}

function onCardPointerDown(event: PointerEvent, taskId: number) {
  if (event.button !== 0) return;
  event.preventDefault(); // prevents Chromium from starting a text selection gesture
  const sourceEl = (event.currentTarget as HTMLElement);
  const rect = sourceEl.getBoundingClientRect();
  const colEl = sourceEl.closest('[data-column-id]');
  activeDrag = {
    taskId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    active: false,
    ghostEl: null,
    sourceEl,
    sourceColumnId: colEl?.getAttribute('data-column-id') ?? null,
  };
  document.body.style.userSelect = 'none';
  document.documentElement.style.userSelect = 'none';
  // setPointerCapture prevents text selection and ensures pointermove/pointerup
  // are received even if the pointer leaves the element.
  sourceEl.setPointerCapture(event.pointerId);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(event: PointerEvent) {
  if (!activeDrag) return;
  const dx = event.clientX - activeDrag.startX;
  const dy = event.clientY - activeDrag.startY;
  if (!activeDrag.active) {
    if (Math.hypot(dx, dy) < 5) return;
    activeDrag.active = true;
    document.body.style.cursor = 'grabbing';
    // Clone the actual card element so the ghost looks identical
    const sourceEl = activeDrag.sourceEl!;
    const rect = sourceEl.getBoundingClientRect();
    const ghost = sourceEl.cloneNode(true) as HTMLElement;
    ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;width:${rect.width}px;opacity:0.9;box-shadow:0 8px 24px rgba(0,0,0,0.18);transform:rotate(1.5deg);`;
    document.body.appendChild(ghost);
    activeDrag.ghostEl = ghost;
    // Hide original card in place (preserves layout slot)
    sourceEl.style.opacity = '0';
  }
  if (activeDrag.ghostEl) {
    activeDrag.ghostEl.style.left = (event.clientX - activeDrag.offsetX) + 'px';
    activeDrag.ghostEl.style.top = (event.clientY - activeDrag.offsetY) + 'px';
  }
  // Detect column under cursor (hide ghost first so it doesn't interfere with elementFromPoint)
  if (activeDrag.ghostEl) activeDrag.ghostEl.style.display = 'none';
  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (activeDrag.ghostEl) activeDrag.ghostEl.style.display = '';
  const col = el?.closest('[data-column-id]');
  const hoveredColumnId = col?.getAttribute('data-column-id') ?? null;
  dragOverColumnId.value = hoveredColumnId;

  // Compute drop index and indicator position within the hovered column
  if (hoveredColumnId && col) {
    const cardsContainer = (col as HTMLElement).querySelector('.board-column__cards');
    if (cardsContainer) {
      const cards = Array.from(cardsContainer.querySelectorAll<HTMLElement>('.task-card'));
      // Exclude the dragged card from index calculation
      const visibleCards = cards.filter(
        (c) => c.dataset.taskId !== String(activeDrag!.taskId),
      );
      let idx = visibleCards.length; // default: append at end
      for (let i = 0; i < visibleCards.length; i++) {
        const rect = visibleCards[i].getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          idx = i;
          break;
        }
      }
      dropIndex.value = idx;

      // Compute pixel offset for the drop indicator line
      const containerRect = cardsContainer.getBoundingClientRect();
      const scrollTop = (cardsContainer as HTMLElement).scrollTop;
      if (visibleCards.length === 0) {
        dropIndicatorY.value = scrollTop + 4;
      } else if (idx === 0) {
        const firstRect = visibleCards[0].getBoundingClientRect();
        dropIndicatorY.value = firstRect.top - containerRect.top + scrollTop - 1;
      } else if (idx >= visibleCards.length) {
        const lastRect = visibleCards[visibleCards.length - 1].getBoundingClientRect();
        dropIndicatorY.value = lastRect.bottom - containerRect.top + scrollTop + 1;
      } else {
        const prevRect = visibleCards[idx - 1].getBoundingClientRect();
        const nextRect = visibleCards[idx].getBoundingClientRect();
        dropIndicatorY.value = (prevRect.bottom + nextRect.top) / 2 - containerRect.top + scrollTop;
      }
    }
  } else {
    dropIndex.value = null;
  }
}

async function onPointerUp(event: PointerEvent) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  if (!activeDrag) return;
  // Always restore user-select regardless of whether a real drag occurred
  document.body.style.userSelect = '';
  document.documentElement.style.userSelect = '';
  if (activeDrag.active) {
    lastDragEndTime = Date.now();
    const dragSnapshot = activeDrag;
    try {
      if (dragOverColumnId.value) {
        const task = Object.values(taskStore.tasksByBoard).flat().find((t) => t.id === dragSnapshot.taskId);
        if (task) {
          const targetColumnId = dragOverColumnId.value;
          const targetIdx = dropIndex.value;
          const colTasks = columnTasks(targetColumnId);

          // Compute target float position
          let targetPosition: number;
          if (colTasks.length === 0) {
            targetPosition = 1000;
          } else {
            // When reordering within same column, exclude the dragged card from the list
            const candidates = targetColumnId === dragSnapshot.sourceColumnId
              ? colTasks.filter((t) => t.id !== dragSnapshot.taskId)
              : colTasks;
            const idx = targetIdx ?? candidates.length;
            if (candidates.length === 0) {
              targetPosition = 1000;
            } else if (idx === 0) {
              targetPosition = candidates[0].position / 2;
            } else if (idx >= candidates.length) {
              targetPosition = candidates[candidates.length - 1].position + 1000;
            } else {
              targetPosition = (candidates[idx - 1].position + candidates[idx].position) / 2;
            }
          }

          if (targetColumnId === dragSnapshot.sourceColumnId) {
            // Same-column reorder — never triggers an AI turn
            if (targetPosition !== task.position) {
              await taskStore.reorderTask(dragSnapshot.taskId, targetPosition);
            }
          } else {
            // Cross-column transition — may trigger AI turn via orchestrator
            await taskStore.transitionTask(dragSnapshot.taskId, targetColumnId, targetPosition);
          }
        }
      }
    } finally {
      if (dragSnapshot.ghostEl) document.body.removeChild(dragSnapshot.ghostEl);
      if (dragSnapshot.sourceEl) dragSnapshot.sourceEl.style.opacity = '';
      document.body.style.cursor = '';
      dragOverColumnId.value = null;
      dropIndex.value = null;
    }
  }
  activeDrag = null;
}

function onCardClick(taskId: number) {
  if (Date.now() - lastDragEndTime < 200) return;
  taskStore.selectTask(taskId);
}

async function onOpenReview(taskId: number) {
  const files = await api("tasks.getChangedFiles", { taskId });
  reviewStore.openReview(taskId, files);
}

async function onTaskCreated() {
  const id = boardStore.activeBoardId;
  if (id != null) await taskStore.loadTasks(id);
}

function openCreateOverlay() {
  activeTaskForOverlay.value = null; // null means create new task
  showCreateTask.value = true;
}

// Handler functions for TaskDetailOverlay
function handleOverlayClose() {
  showCreateTask.value = false;
  activeTaskForOverlay.value = null;
}

function handleOverlaySaved() {
  showCreateTask.value = false;
  activeTaskForOverlay.value = null;
  const id = boardStore.activeBoardId;
  if (id != null) taskStore.loadTasks(id);
}

function handleOverlayDeleted() {
  showCreateTask.value = false;
  activeTaskForOverlay.value = null;
  const id = boardStore.activeBoardId;
  if (id != null) taskStore.loadTasks(id);
}
</script>

<style scoped>
.board-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
  gap: 12px;
  flex-shrink: 0;
}

.board-header__left,
.board-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
}

.workspace-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
  color: var(--p-text-color);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  font: inherit;
}

.workspace-tab.is-active {
  border-color: var(--p-primary-color, #6366f1);
  color: var(--p-primary-color, #6366f1);
}

.workspace-tab__unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--p-blue-500, #3b82f6);
}

.board-selector {
  min-width: 200px;
}

.board-columns {
  display: flex;
  flex: 1;
  gap: 12px;
  padding: 16px;
  overflow-x: auto;
  overflow-y: hidden;
  align-items: flex-start;
}

.board-column {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  background: var(--p-content-hover-background);
  border-radius: 10px;
  padding: 12px;
  max-height: 100%;
  transition: outline 0.1s;
}

.board-column.is-drag-over {
  outline: 2px dashed var(--p-primary-color, #6366f1);
}

.board-column__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.board-column__create-task {
  padding: 0 4px 12px 4px;
  margin-bottom: 8px;
}

.board-column__name {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.board-column__cards {
  flex: 1;
  overflow-y: auto;
  min-height: 60px;
  position: relative;
}

.drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--p-primary-color, #6366f1);
  border-radius: 2px;
  pointer-events: none;
  z-index: 10;
}

.board-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--p-text-muted-color, #94a3b8);
}
</style>
