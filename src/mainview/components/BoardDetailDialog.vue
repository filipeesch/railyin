<template>
  <Dialog
    v-model:visible="visible"
    :header="isEdit ? 'Edit Board' : 'Add Board'"
    :modal="true"
    :style="{ width: '520px' }"
    :dismissable-mask="true"
    @hide="emit('close')"
  >
    <div class="board-dialog-body">
      <div class="field">
        <label>Board name</label>
        <InputText v-model="form.name" placeholder="Q2 Delivery" class="w-full" />
      </div>

      <div class="field">
        <label>Workflow</label>
        <select v-model="form.workflowTemplateId" class="board-native-select">
          <option disabled value="">Select workflow</option>
          <option v-for="w in workflowOptions" :key="w.value" :value="w.value">{{ w.label }}</option>
        </select>
      </div>

      <Message
        v-if="showWorkflowWarning"
        severity="warn"
        :closable="false"
        class="mb-3"
      >
        This board has tasks. Changing the workflow template may cause columns to mismatch.
      </Message>

      <div class="field">
        <label>Projects <span class="field-hint">(assign projects to this board)</span></label>
        <div class="project-checkbox-list">
          <div v-if="workspaceProjects.length === 0" class="no-projects-hint">
            No projects in this workspace yet.
          </div>
          <label v-for="p in workspaceProjects" :key="p.key" class="project-checkbox-item">
            <input type="checkbox" :value="p.key" v-model="form.projectKeys" />
            <span>{{ p.name }}</span>
            <code class="project-key-hint">{{ p.key }}</code>
          </label>
        </div>
      </div>

      <Message v-if="saveError" severity="error" :closable="false" class="mt-2">
        {{ saveError }}
      </Message>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="close" :disabled="saving" />
      <Button
        :label="isEdit ? 'Save changes' : 'Add board'"
        :icon="isEdit ? 'pi pi-save' : 'pi pi-plus'"
        :loading="saving"
        :disabled="!canSave"
        @click="onSave"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import type { WorkflowTemplate } from "@shared/rpc-types";
import type { Board } from "@shared/rpc-types";
import { useProjectStore } from "../stores/project";
import { api } from "../rpc";

type BoardWithTemplate = Board & { template: WorkflowTemplate };

const props = defineProps<{
  modelValue: boolean;
  workspaceKey: string;
  board?: BoardWithTemplate;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "close"): void;
  (e: "save", data: { name: string; workflowTemplateId: string; projectKeys: string[] }): void;
}>();

const projectStore = useProjectStore();

const visible = ref(props.modelValue);
const saving = ref(false);
const saveError = ref<string | null>(null);
const workflowOptions = ref<Array<{ label: string; value: string }>>([]);

const isEdit = computed(() => !!props.board);

const form = reactive({
  name: props.board?.name ?? "",
  workflowTemplateId: props.board?.workflowTemplateId ?? "",
  projectKeys: [...(props.board?.projectKeys ?? [])],
});

const originalTemplateId = ref(props.board?.workflowTemplateId ?? "");

const workspaceProjects = computed(() =>
  projectStore.projects.filter((p) => p.workspaceKey === props.workspaceKey),
);

const showWorkflowWarning = computed(() =>
  isEdit.value &&
  form.workflowTemplateId !== originalTemplateId.value &&
  (props.board?.taskCount ?? 0) > 0,
);

const canSave = computed(() => form.name.trim().length > 0 && form.workflowTemplateId.length > 0);

async function loadWorkflowOptions() {
  workflowOptions.value = [];
  if (!props.workspaceKey) return;
  try {
    const config = await api("workspace.getConfig", { workspaceKey: props.workspaceKey });
    workflowOptions.value = config.workflows.map((w: WorkflowTemplate) => ({ label: w.name, value: w.id }));
  } catch {
    workflowOptions.value = [];
  }
}

watch(() => props.modelValue, async (v) => {
  visible.value = v;
  if (v) {
    form.name = props.board?.name ?? "";
    form.workflowTemplateId = props.board?.workflowTemplateId ?? "";
    form.projectKeys = [...(props.board?.projectKeys ?? [])];
    originalTemplateId.value = props.board?.workflowTemplateId ?? "";
    saveError.value = null;
    await loadWorkflowOptions();
    if (!form.workflowTemplateId && workflowOptions.value.length > 0) {
      form.workflowTemplateId = workflowOptions.value[0]!.value;
    }
  }
});

watch(visible, (v) => emit("update:modelValue", v));

function onSave() {
  saveError.value = null;
  emit("save", {
    name: form.name.trim(),
    workflowTemplateId: form.workflowTemplateId,
    projectKeys: form.projectKeys,
  });
}

function close() {
  visible.value = false;
  emit("close");
}

function setSaving(v: boolean) { saving.value = v; }
function setSaveError(msg: string | null) { saveError.value = msg; }

defineExpose({ setSaving, setSaveError });
</script>

<style scoped>
.board-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}

.field label {
  font-size: 0.85rem;
  font-weight: 500;
}

.field-hint {
  font-weight: 400;
  color: var(--p-text-muted-color, #94a3b8);
}

.board-native-select {
  width: 100%;
  min-height: 2.5rem;
  border: 1px solid var(--p-content-border-color, #cbd5e1);
  border-radius: 6px;
  background: var(--p-content-background, #fff);
  color: var(--p-text-color, #1e293b);
  padding: 0.625rem 0.75rem;
  font: inherit;
}

.project-checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 6px;
  max-height: 160px;
  overflow-y: auto;
}

.project-checkbox-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  cursor: pointer;
}

.project-key-hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  background: var(--p-surface-100, #f1f5f9);
  padding: 1px 5px;
  border-radius: 4px;
}

.no-projects-hint {
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #94a3b8);
}

.w-full { width: 100%; }
.mt-2 { margin-top: 8px; }
.mb-3 { margin-bottom: 12px; }
</style>
