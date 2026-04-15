<template>
  <Dialog
    v-model:visible="show"
    modal
    header="Create Task"
    :style="{ width: '480px' }"
    @hide="reset"
  >
    <div class="create-task-form">
      <div class="field">
        <label for="ct-title">Title</label>
        <InputText
          id="ct-title"
          v-model="form.title"
          placeholder="Short descriptive title"
          class="w-full"
          autofocus
        />
      </div>

      <div class="field">
        <label for="ct-project">Project</label>
        <Select
          id="ct-project"
          v-model="form.projectKey"
          :options="visibleProjects"
          option-label="name"
          option-value="key"
          placeholder="Select project"
          class="w-full"
        />
      </div>

      <div class="field">
        <label for="ct-desc">Description</label>
        <Textarea
          id="ct-desc"
          v-model="form.description"
          rows="4"
          class="w-full"
          placeholder="What needs to be done?"
        />
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="show = false" />
      <Button
        label="Create"
        :disabled="!form.title.trim() || !form.projectKey"
        :loading="saving"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Button from "primevue/button";
import { useProjectStore } from "../stores/project";
import { useTaskStore } from "../stores/task";
import { useWorkspaceStore } from "../stores/workspace";

const props = defineProps<{ boardId: number }>();
const emit = defineEmits<{ created: [] }>();

const show = defineModel<boolean>("visible", { default: false });

const projectStore = useProjectStore();
const taskStore = useTaskStore();
const workspaceStore = useWorkspaceStore();
const saving = ref(false);
const visibleProjects = computed(() =>
  projectStore.projects.filter((project) => project.workspaceKey === workspaceStore.activeWorkspaceKey),
);

const form = reactive({ title: "", description: "", projectKey: null as string | null });

function reset() {
  form.title = "";
  form.description = "";
  form.projectKey = null;
}

async function submit() {
  if (!form.title.trim() || !form.projectKey) return;
  saving.value = true;
  try {
    await taskStore.createTask({
      boardId: props.boardId,
      projectKey: form.projectKey,
      title: form.title.trim(),
      description: form.description.trim(),
    });
    show.value = false;
    emit("created");
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.create-task-form .field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}

.create-task-form label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--p-text-muted-color, #64748b);
}
</style>
