<template>
  <Dialog
    v-model:visible="visible"
    :header="isEdit ? 'Edit Project' : 'Add Project'"
    :modal="true"
    :style="{ width: '520px' }"
    :dismissable-mask="true"
    @hide="emit('close')"
  >
    <div class="project-dialog-body">
      <Message v-if="!workspacePathSet" severity="warn" :closable="false" class="mb-3">
        <strong>workspace_path is not set.</strong> Set it in Workspace Settings before adding projects.
      </Message>

      <div class="field">
        <label>Name</label>
        <InputText v-model="form.name" placeholder="my-service" class="w-full" />
      </div>

      <div class="field">
        <label>Project path <span class="field-hint">(relative to workspace path)</span></label>
        <div class="path-row">
          <InputText
            v-model="form.projectPath"
            :placeholder="workspacePathSet ? 'my-service' : '/absolute/path/to/project'"
            class="w-full"
            @blur="onProjectPathBlur"
          />
          <Button
            icon="pi pi-folder-open"
            severity="secondary"
            outlined
            :loading="browsingProject"
            aria-label="Browse folder"
            title="Browse for project folder"
            @click="browseProjectPath"
          />
        </div>
      </div>

      <div class="field">
        <label>Git root <span class="field-hint">(may differ in monorepos)</span></label>
        <div class="path-row">
          <InputText
            v-model="form.gitRootPath"
            placeholder="/home/user/projects"
            class="w-full"
          />
          <Button
            icon="pi pi-folder-open"
            severity="secondary"
            outlined
            :loading="browsingGitRoot"
            aria-label="Browse folder"
            title="Browse for git root folder"
            @click="browseGitRootPath"
          />
          <Button
            icon="pi pi-search"
            severity="secondary"
            outlined
            :loading="detectingGitRoot"
            aria-label="Detect git root"
            title="Detect git root from project path"
            @click="detectGitRoot"
          />
        </div>
        <small v-if="gitRootHint" class="field-hint-msg" :class="{ 'is-error': gitRootError }">
          {{ gitRootHint }}
        </small>
      </div>

      <div class="field">
        <label>Default branch</label>
        <InputText v-model="form.defaultBranch" placeholder="main" class="w-full" />
      </div>

      <div class="field">
        <label>Slug <span class="field-hint">(optional, used as URL slug)</span></label>
        <InputText v-model="form.slug" placeholder="my-service" class="w-full" />
      </div>

      <div class="field">
        <label>Description <span class="field-hint">(optional)</span></label>
        <InputText v-model="form.description" placeholder="Brief description" class="w-full" />
      </div>

      <Message v-if="saveError" severity="error" :closable="false" class="mt-2">
        {{ saveError }}
      </Message>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="close" :disabled="saving" />
      <Button
        :label="isEdit ? 'Save changes' : 'Add project'"
        :icon="isEdit ? 'pi pi-save' : 'pi pi-plus'"
        :loading="saving"
        :disabled="!canSave || !workspacePathSet"
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
import type { Project } from "@shared/rpc-types";
import { useWorkspaceStore } from "../stores/workspace";
import { api } from "../rpc";

const props = defineProps<{
  modelValue: boolean;
  workspaceKey: string;
  /** If provided, dialog is in edit mode pre-populated with this project */
  project?: Project;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "close"): void;
  (e: "save", data: {
    name: string;
    projectPath: string;
    gitRootPath: string;
    defaultBranch: string;
    slug?: string;
    description?: string;
  }): void;
}>();

const workspaceStore = useWorkspaceStore();

const visible = ref(props.modelValue);
const saving = ref(false);
const saveError = ref<string | null>(null);
const detectingGitRoot = ref(false);
const gitRootHint = ref<string | null>(null);
const gitRootError = ref(false);
const browsingProject = ref(false);
const browsingGitRoot = ref(false);

const isEdit = computed(() => !!props.project);
const workspacePathSet = computed(() => !!(workspaceStore.config?.workspacePath));

const form = reactive({
  name: props.project?.name ?? "",
  projectPath: props.project?.projectPath.relative ?? "",
  gitRootPath: props.project?.gitRootPath.relative ?? "",
  defaultBranch: props.project?.defaultBranch ?? "main",
  slug: props.project?.slug ?? "",
  description: props.project?.description ?? "",
});

watch(() => props.modelValue, (v) => {
  visible.value = v;
  if (v) {
    // Reset form when dialog opens
    form.name = props.project?.name ?? "";
    form.projectPath = props.project?.projectPath.relative ?? "";
    form.gitRootPath = props.project?.gitRootPath.relative ?? "";
    form.defaultBranch = props.project?.defaultBranch ?? "main";
    form.slug = props.project?.slug ?? "";
    form.description = props.project?.description ?? "";
    saveError.value = null;
    gitRootHint.value = null;
  }
});

watch(visible, (v) => emit("update:modelValue", v));

const canSave = computed(() =>
  form.name.trim().length > 0 &&
  form.projectPath.trim().length > 0 &&
  form.gitRootPath.trim().length > 0,
);

async function detectGitRoot() {
  const path = form.projectPath.trim();
  if (!path) return;
  detectingGitRoot.value = true;
  gitRootHint.value = null;
  gitRootError.value = false;
  try {
    const gitRoot = await workspaceStore.resolveGitRoot(path);
    if (gitRoot) {
      form.gitRootPath = gitRoot;
      gitRootHint.value = "Git root detected";
      gitRootError.value = false;
    } else {
      gitRootHint.value = "No Git repository found at this path";
      gitRootError.value = true;
    }
  } catch {
    gitRootHint.value = "Could not detect Git root";
    gitRootError.value = true;
  } finally {
    detectingGitRoot.value = false;
  }
}

async function onProjectPathBlur() {
  // Auto-fill git root only when it's empty and project path is set
  if (form.projectPath.trim() && !form.gitRootPath.trim()) {
    await detectGitRoot();
  }
}

async function browseProjectPath() {
  browsingProject.value = true;
  try {
    const { path } = await api("workspace.openFolderDialog", { initialPath: form.projectPath || undefined });
    if (path) {
      form.projectPath = path;
      if (!form.gitRootPath.trim()) await detectGitRoot();
    }
  } finally {
    browsingProject.value = false;
  }
}

async function browseGitRootPath() {
  browsingGitRoot.value = true;
  try {
    const { path } = await api("workspace.openFolderDialog", { initialPath: form.gitRootPath || form.projectPath || undefined });
    if (path) form.gitRootPath = path;
  } finally {
    browsingGitRoot.value = false;
  }
}

async function onSave() {
  saveError.value = null;
  saving.value = true;
  try {
    emit("save", {
      name: form.name.trim(),
      projectPath: form.projectPath.trim(),
      gitRootPath: form.gitRootPath.trim() || form.projectPath.trim(),
      defaultBranch: form.defaultBranch.trim() || "main",
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    });
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

function close() {
  visible.value = false;
  emit("close");
}

/** Called by parent to signal save error (when save is async in parent) */
function setSaving(v: boolean) { saving.value = v; }
function setSaveError(msg: string | null) { saveError.value = msg; }

defineExpose({ setSaving, setSaveError });
</script>

<style scoped>
.project-dialog-body {
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

.field-hint-msg {
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
}

.field-hint-msg.is-error {
  color: var(--p-red-500, #ef4444);
}

.path-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.path-row .p-inputtext {
  flex: 1;
}

.w-full {
  width: 100%;
}

.mt-2 {
  margin-top: 8px;
}
</style>
