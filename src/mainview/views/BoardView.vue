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
        <Button
          icon="pi pi-comments"
          severity="secondary"
          text
          rounded
          aria-label="Chat sessions"
          class="chat-sidebar-toggle toolbar-btn--chat"
          :class="{ 'is-active': chatSidebarOpen }"
          @click="chatSidebarOpen = !chatSidebarOpen"
        />

      </div>
    </div>

    <!-- Board columns -->
    <div v-if="boardStore.activeBoard" class="board-columns">
      <template v-for="slot in renderSlots" :key="slot.type === 'standalone' ? slot.column.id : slot.groupId">
        <!-- Standalone column -->
        <div
          v-if="slot.type === 'standalone'"
          class="board-column"
          :class="{
            'is-drag-over': dragOverColumnId === slot.column.id && !columnAtCapacity(slot.column.id),
            'is-drag-over--full': dragOverColumnId === slot.column.id && columnAtCapacity(slot.column.id),
          }"
          :data-column-id="slot.column.id"
          @drop.prevent
        >
          <div class="board-column__header">
            <span class="board-column__name">{{ slot.column.label }}</span>
            <Badge
              :value="slot.column.limit != null ? `${columnTasksMap[slot.column.id]?.length ?? 0}/${slot.column.limit}` : (columnTasksMap[slot.column.id]?.length ?? 0)"
              :severity="columnAtCapacity(slot.column.id) ? 'danger' : 'secondary'"
            />
          </div>
          <div v-if="slot.column.id === 'backlog'" class="board-column__create-task">
            <Button label="New Task" icon="pi pi-plus" @click="openCreateOverlay" />
          </div>
          <div class="board-column__cards">
            <TaskCard
              v-for="task in columnTasksMap[slot.column.id] ?? []"
              :key="task.id"
              :task="task"
              v-memo="[task, taskStore.hasUnread(task.id), taskStore.changedFileCounts[task.id]]"
              @pointerdown="onCardPointerDown($event, task.id)"
              @click="onCardClick(task.id)"
              @open-review="onOpenReview(task.id)"
            />
            <div
              v-if="dragOverColumnId === slot.column.id"
              class="drop-indicator"
              :style="{ top: dropIndicatorY + 'px' }"
            />
          </div>
        </div>

        <!-- Group column: stacked sub-columns, wrapper has NO data-column-id -->
        <div v-else class="board-column-group">
          <div v-if="slot.label" class="board-column-group__label">{{ slot.label }}</div>
          <div
            v-for="col in slot.columns"
            :key="col.id"
            class="board-column"
            :class="{
              'is-drag-over': dragOverColumnId === col.id && !columnAtCapacity(col.id),
              'is-drag-over--full': dragOverColumnId === col.id && columnAtCapacity(col.id),
            }"
            :data-column-id="col.id"
            @drop.prevent
          >
            <div class="board-column__header">
              <span class="board-column__name">{{ col.label }}</span>
              <Badge
                :value="col.limit != null ? `${columnTasksMap[col.id]?.length ?? 0}/${col.limit}` : (columnTasksMap[col.id]?.length ?? 0)"
                :severity="columnAtCapacity(col.id) ? 'danger' : 'secondary'"
              />
            </div>
            <div v-if="col.id === 'backlog'" class="board-column__create-task">
              <Button label="New Task" icon="pi pi-plus" @click="openCreateOverlay" />
            </div>
            <div class="board-column__cards">
              <TaskCard
                v-for="task in columnTasksMap[col.id] ?? []"
                :key="task.id"
                :task="task"
                v-memo="[task, taskStore.hasUnread(task.id), taskStore.changedFileCounts[task.id]]"
                @pointerdown="onCardPointerDown($event, task.id)"
                @click="onCardClick(task.id)"
                @open-review="onOpenReview(task.id)"
              />
              <div
                v-if="dragOverColumnId === col.id"
                class="drop-indicator"
                :style="{ top: dropIndicatorY + 'px' }"
              />
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Empty state -->
    <div v-else-if="!boardStore.loading" class="board-empty">
      <i class="pi pi-inbox" style="font-size: 3rem; color: var(--p-text-muted-color)" />
      <p>No boards yet. <a href="#" @click.prevent="router.push('/setup')">Create one in setup.</a></p>
    </div>

    <!-- Unified conversation drawer (tasks + chat sessions) -->
    <ConversationDrawer />

    <!-- Code review overlay -->
    <CodeReviewOverlay />

    <!-- Code server overlay (z-index: 800, behind chat drawer) -->
    <CodeServerOverlay />

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
    <!-- Chat sidebar (right docked panel) -->
    <ChatSidebar
      v-if="chatSidebarOpen"
      @close="chatSidebarOpen = false"
    />

    <!-- Terminal area: sits above the chat sidebar -->
    <div class="terminal-area">
    <!-- Terminal Panel -->
    <TerminalPanel
      v-if="terminalStore.isPanelOpen"
      :style="{ height: terminalStore.panelHeight + 'px' }"
    />

    <!-- Footer strip -->
    <div class="terminal-footer" @click="onFooterClick">
      <template v-if="terminalStore.sessions.length === 0">
        <i class="pi pi-terminal" style="font-size: 11px;" />
        <span>Terminal</span>
        <kbd>Ctrl+`</kbd>
      </template>
      <template v-else>
        <span class="terminal-footer__dot" />
        <span>{{ terminalStore.sessions.length }} session{{ terminalStore.sessions.length > 1 ? 's' : '' }}</span>
        <span class="terminal-footer__sep">·</span>
        <span>{{ terminalStore.sessions.find(s => s.sessionId === terminalStore.activeSessionId)?.label ?? '' }}</span>
      </template>
    </div>
    </div><!-- end terminal-area -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
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
import { useTerminalStore } from "../stores/terminal";
import { useChatStore } from "../stores/chat";
import TaskCard from "../components/TaskCard.vue";
import ConversationDrawer from "../components/ConversationDrawer.vue";
import TaskDetailOverlay from "../components/TaskDetailOverlay.vue";
import CodeReviewOverlay from "../components/CodeReviewOverlay.vue";
import WorkflowEditorOverlay from "../components/WorkflowEditorOverlay.vue";
import TerminalPanel from "../components/TerminalPanel.vue";
import CodeServerOverlay from "../components/CodeServerOverlay.vue";
import ChatSidebar from "../components/ChatSidebar.vue";
import { useDrawerStore } from "../stores/drawer";
import type { Task } from "../../shared/rpc-types";

const CHAT_SIDEBAR_OPEN_KEY = "railyn.chatSidebarOpen";

function loadChatSidebarOpen(): boolean {
  return localStorage.getItem(CHAT_SIDEBAR_OPEN_KEY) === "true";
}

const router = useRouter();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const taskStore = useTaskStore();
const projectStore = useProjectStore();
const reviewStore = useReviewStore();
const terminalStore = useTerminalStore();
const chatStore = useChatStore();
const drawerStore = useDrawerStore();
const chatSidebarOpen = ref(loadChatSidebarOpen());
const { isDark, toggle: toggleDark } = useDarkMode();

const showCreateTask = ref(false);
const activeTaskForOverlay = ref<number | null>(null);
const dragOverColumnId = ref<string | null>(null);
const dropIndex = ref<number | null>(null);
const dropIndicatorY = ref<number>(0);
let lastDragEndTime = 0;

async function onFooterClick() {
  if (terminalStore.sessions.length === 0) {
    // No sessions yet — create one in the workspace root
    const cwd = workspaceStore.config?.worktreeBasePath ?? ".";
    const result = await api("launch.shell", { cwd });
    terminalStore.addSession(result.sessionId, "bash", cwd);
  } else {
    terminalStore.togglePanel();
  }
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

let scrollRAF: number | null = null;
let scrollTarget: { container: HTMLElement; direction: number } | null = null;

function startAutoScroll(container: HTMLElement, direction: number) {
  if (scrollTarget?.container === container && scrollTarget?.direction === direction) return;
  stopAutoScroll();
  scrollTarget = { container, direction };
  const tick = () => {
    if (!scrollTarget) return;
    scrollTarget.container.scrollTop += scrollTarget.direction * 8;
    scrollRAF = requestAnimationFrame(tick);
  };
  scrollRAF = requestAnimationFrame(tick);
}

function stopAutoScroll() {
  if (scrollRAF != null) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
  scrollTarget = null;
}

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

function onKeyDown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === "`") {
    // Don't fire if focus is inside the terminal panel
    const panel = document.querySelector(".terminal-panel");
    if (panel && panel.contains(document.activeElement)) return;
    e.preventDefault();
    terminalStore.togglePanel();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeyDown);
  await projectStore.loadProjects();
  if (workspaceStore.activeWorkspaceKey != null && !boardStore.activeBoard) {
    boardStore.selectFirstBoardInWorkspace(workspaceStore.activeWorkspaceKey);
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
});

const columnTasksMap = computed<Record<string, Task[]>>(() => {
  const boardId = boardStore.activeBoardId;
  if (!boardId) return {};
  const tasks = taskStore.tasksByBoard[boardId] ?? [];
  const template = boardStore.activeBoard?.template;
  const result: Record<string, Task[]> = {};
  for (const col of template?.columns ?? []) {
    result[col.id] = [];
  }
  for (const task of tasks) {
    if (result[task.workflowState]) {
      result[task.workflowState].push(task);
    }
  }
  for (const colId of Object.keys(result)) {
    result[colId].sort((a, b) => a.position - b.position);
  }
  return result;
});

function columnAtCapacity(columnId: string): boolean {
  const template = boardStore.activeBoard?.template;
  const col = template?.columns.find((c) => c.id === columnId);
  if (col?.limit == null) return false;
  return (columnTasksMap.value[columnId]?.length ?? 0) >= col.limit;
}

type RenderSlot =
  | { type: 'standalone'; column: import('../../shared/rpc-types.ts').WorkflowColumn }
  | { type: 'group'; groupId: string; label?: string; columns: import('../../shared/rpc-types.ts').WorkflowColumn[] };

const renderSlots = computed((): RenderSlot[] => {
  const template = boardStore.activeBoard?.template;
  if (!template) return [];
  const groups = template.groups ?? [];
  const emittedGroups = new Set<string>();
  return template.columns.flatMap((col) => {
    const group = groups.find((g) => g.columns.includes(col.id));
    // No group, or single-member group → standalone
    if (!group || group.columns.length <= 1) {
      return [{ type: 'standalone' as const, column: col }];
    }
    // Use a stable key derived from the group's column list (id may be absent in YAML)
    const groupKey = group.columns.join('\0');
    // Multi-column group: emit the group on first encounter
    if (emittedGroups.has(groupKey)) return [];
    emittedGroups.add(groupKey);
    const groupCols = group.columns
      .map((id) => template.columns.find((c) => c.id === id))
      .filter((c): c is import('../../shared/rpc-types.ts').WorkflowColumn => c != null);
    return [{ type: 'group' as const, groupId: groupKey, label: group.label, columns: groupCols }];
  });
});

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
      if (visibleCards.length === 0) {
        dropIndicatorY.value = 4;
      } else if (idx === 0) {
        const firstRect = visibleCards[0].getBoundingClientRect();
        dropIndicatorY.value = firstRect.top - containerRect.top - 1;
      } else if (idx >= visibleCards.length) {
        const lastRect = visibleCards[visibleCards.length - 1].getBoundingClientRect();
        dropIndicatorY.value = lastRect.bottom - containerRect.top + 1;
      } else {
        const prevRect = visibleCards[idx - 1].getBoundingClientRect();
        const nextRect = visibleCards[idx].getBoundingClientRect();
        dropIndicatorY.value = (prevRect.bottom + nextRect.top) / 2 - containerRect.top;
      }

      // Auto-scroll the board when cursor is near top/bottom edge of the viewport
      const SCROLL_ZONE = 60;
      const boardContainer = document.querySelector('.board-columns') as HTMLElement | null;
      if (boardContainer) {
        const boardRect = boardContainer.getBoundingClientRect();
        if (event.clientY < boardRect.top + SCROLL_ZONE) {
          startAutoScroll(boardContainer, -1);
        } else if (event.clientY > boardRect.bottom - SCROLL_ZONE) {
          startAutoScroll(boardContainer, 1);
        } else {
          stopAutoScroll();
        }
      }
    }
  } else {
    dropIndex.value = null;
    stopAutoScroll();
  }
}

async function onPointerUp(event: PointerEvent) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  stopAutoScroll();
  if (!activeDrag) return;
  // Always restore user-select regardless of whether a real drag occurred
  document.body.style.userSelect = '';
  document.documentElement.style.userSelect = '';
  if (activeDrag.active) {
    lastDragEndTime = Date.now();
    const dragSnapshot = activeDrag;

    // Capture drop target BEFORE clearing state
    const targetColumnId = dragOverColumnId.value;
    const targetIdx = dropIndex.value;

    // Clean up ghost and visual state IMMEDIATELY (before any async work)
    if (dragSnapshot.ghostEl) document.body.removeChild(dragSnapshot.ghostEl);
    if (dragSnapshot.sourceEl) dragSnapshot.sourceEl.style.opacity = '';
    document.body.style.cursor = '';
    dragOverColumnId.value = null;
    dropIndex.value = null;

    if (targetColumnId) {
      const task = Object.values(taskStore.tasksByBoard).flat().find((t) => t.id === dragSnapshot.taskId);
      if (task) {
        const colTasks = columnTasksMap.value[targetColumnId] ?? [];
        const boardId = boardStore.activeBoardId;
        if (!boardId) return;

        // Check capacity before firing — reject silently if full
        if (!columnAtCapacity(targetColumnId)) {
          if (targetColumnId === dragSnapshot.sourceColumnId) {
            // Same-column reorder: splice task into new position, batch-sync positions
            const others = colTasks.filter((t) => t.id !== dragSnapshot.taskId);
            const idx = targetIdx ?? others.length;
            others.splice(idx, 0, task);
            taskStore.reorderColumnBatch(boardId, targetColumnId, others.map((t) => t.id));
          } else {
            // Cross-column transition: optimistic move + batch-sync target column order
            const idx = targetIdx ?? colTasks.length;
            const newColOrder = [...colTasks];
            newColOrder.splice(idx, 0, task);
            // fire-and-forget
            taskStore.transitionTask(dragSnapshot.taskId, targetColumnId);
            taskStore.reorderColumnBatch(boardId, targetColumnId, newColOrder.map((t) => t.id));
          }
        }
      }
    }
  }
  activeDrag = null;
}

function onCardClick(taskId: number) {
  if (Date.now() - lastDragEndTime < 200) return;
  const task = Object.values(taskStore.tasksByBoard).flat().find(t => t.id === taskId);
  taskStore.selectTask(taskId);
  if (task) drawerStore.openForTask(taskId, task.conversationId);
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

// Auto-open sidebar when a chat session becomes active
watch(
  () => chatStore.activeChatSessionId,
  (id) => {
    if (id != null) chatSidebarOpen.value = true;
  },
);

watch(chatSidebarOpen, (isOpen) => {
  localStorage.setItem(CHAT_SIDEBAR_OPEN_KEY, String(isOpen));
});
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
  overflow-y: auto;
  align-items: flex-start;
}

.board-column {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  background: var(--p-content-hover-background);
  border-radius: 10px;
  padding: 12px;
  min-height: 120px;
  transition: outline 0.1s;
}

.board-column.is-drag-over {
  background: color-mix(in srgb, var(--p-primary-color, #6366f1) 8%, var(--p-content-hover-background));
}

.board-column.is-drag-over--full {
  outline: 2px dashed var(--p-danger-color, #ef4444);
}

.board-column-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 260px;
}

.board-column-group__label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--p-text-muted-color, #64748b);
  padding: 0 4px 2px 4px;
}

.board-column-group > .board-column {
  flex: none;
  min-height: 80px;
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

.terminal-area {
  position: relative;
  z-index: 901; /* above chat-sidebar (z-index: 900) */
  flex-shrink: 0;
}

.terminal-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 22px;
  flex-shrink: 0;
  background: #007acc;
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.terminal-footer:hover {
  background: #1a8cd8;
}

.terminal-footer kbd {
  opacity: 0.7;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  padding: 1px 4px;
  margin-left: 4px;
}

.terminal-footer__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4caf50;
  flex-shrink: 0;
}

.terminal-footer__sep {
  opacity: 0.5;
}
</style>
