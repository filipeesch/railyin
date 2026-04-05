<template>
  <div class="board-view">
    <!-- Header bar -->
    <div class="board-header">
      <div class="board-header__left">
        <Select
          v-model="boardStore.activeBoardId"
          :options="boardStore.boards"
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
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="Settings"
          @click="router.push('/setup')"
        />
        <Button
          v-if="boardStore.activeBoard"
          label="New Task"
          icon="pi pi-plus"
          @click="showCreateTask = true"
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

        <!-- Task cards -->
        <div class="board-column__cards">
          <TaskCard
            v-for="task in columnTasks(column.id)"
            :key="task.id"
            :task="task"
            @pointerdown="onCardPointerDown($event, task.id)"
            @click="onCardClick(task.id)"
            @open-review="onOpenReview(task.id)"
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
      :template-id="workflowEditor.templateId"
      :template-name="workflowEditor.templateName"
      :initial-yaml="workflowEditor.yaml"
      @close="workflowEditor.visible = false"
      @saved="onWorkflowSaved"
    />

    <!-- Create task dialog -->
    <CreateTaskDialog
      v-if="boardStore.activeBoardId"
      v-model:visible="showCreateTask"
      :board-id="boardStore.activeBoardId"
      @created="onTaskCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { electroview, onWorkflowReloaded } from "../rpc";
import Select from "primevue/select";
import Button from "primevue/button";
import Badge from "primevue/badge";
import { useBoardStore } from "../stores/board";
import { useTaskStore } from "../stores/task";
import { useProjectStore } from "../stores/project";
import { useReviewStore } from "../stores/review";
import TaskCard from "../components/TaskCard.vue";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";
import CreateTaskDialog from "../components/CreateTaskDialog.vue";
import CodeReviewOverlay from "../components/CodeReviewOverlay.vue";
import WorkflowEditorOverlay from "../components/WorkflowEditorOverlay.vue";

const router = useRouter();
const boardStore = useBoardStore();
const taskStore = useTaskStore();
const projectStore = useProjectStore();
const reviewStore = useReviewStore();

const showCreateTask = ref(false);
const dragOverColumnId = ref<string | null>(null);
let lastDragEndTime = 0;

// ─── Workflow editor state ────────────────────────────────────────────────────

const workflowEditor = ref({
  visible: false,
  templateId: "",
  templateName: "",
  yaml: "",
});

async function onEditWorkflow() {
  const board = boardStore.activeBoard;
  if (!board) return;
  try {
    const { yaml } = await electroview.rpc.request["workflow.getYaml"]({
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
});

function columnTasks(columnId: string) {
  const boardId = boardStore.activeBoardId;
  if (!boardId) return [];
  return (taskStore.tasksByBoard[boardId] ?? []).filter(
    (t) => t.workflowState === columnId,
  );
}

async function onBoardChange() {
  const id = boardStore.activeBoardId;
  if (id != null) await taskStore.loadTasks(id);
}

function onCardPointerDown(event: PointerEvent, taskId: number) {
  if (event.button !== 0) return;
  event.preventDefault(); // prevents Chromium from starting a text selection gesture
  const sourceEl = (event.currentTarget as HTMLElement);
  const rect = sourceEl.getBoundingClientRect();
  activeDrag = {
    taskId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    active: false,
    ghostEl: null,
    sourceEl,
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
  dragOverColumnId.value = col?.getAttribute('data-column-id') ?? null;
}

async function onPointerUp(event: PointerEvent) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  if (!activeDrag) return;
  if (activeDrag.active) {
    lastDragEndTime = Date.now();
    if (dragOverColumnId.value) {
      const task = Object.values(taskStore.tasksByBoard).flat().find((t) => t.id === activeDrag!.taskId);
      if (task && task.workflowState !== dragOverColumnId.value) {
        await taskStore.transitionTask(activeDrag.taskId, dragOverColumnId.value);
      }
    }
    if (activeDrag.ghostEl) document.body.removeChild(activeDrag.ghostEl);
    if (activeDrag.sourceEl) activeDrag.sourceEl.style.opacity = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.documentElement.style.userSelect = '';
    dragOverColumnId.value = null;
  }
  activeDrag = null;
}

function onCardClick(taskId: number) {
  if (Date.now() - lastDragEndTime < 200) return;
  taskStore.selectTask(taskId);
}

async function onOpenReview(taskId: number) {
  const files = await electroview.rpc.request["tasks.getChangedFiles"]({ taskId });
  reviewStore.openReview(taskId, files);
}

async function onTaskCreated() {
  const id = boardStore.activeBoardId;
  if (id != null) await taskStore.loadTasks(id);
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
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  background: var(--p-surface-0, #fff);
  gap: 12px;
  flex-shrink: 0;
}

.board-header__left,
.board-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
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
  background: var(--p-surface-100, #f1f5f9);
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
