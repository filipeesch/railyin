<template>
  <div class="model-mgmt">
    <!-- Header + Create button -->
    <div class="model-mgmt__header">
      <span class="model-mgmt__title">
        <i class="pi pi-cog" />
        Models
      </span>
      <button class="model-mgmt__create-btn" @click="createModel">
        <i class="pi pi-plus" />
        Add Model
      </button>
    </div>

    <!-- No models yet -->
    <div v-if="modelKeys.length === 0" class="model-mgmt__empty">
      <i class="pi pi-info-circle" />
      No models configured. Add one to get started.
    </div>

    <!-- Model list -->
    <div v-else class="model-list">
      <!-- Existing models -->
      <div
        v-for="key in modelKeys"
        :key="key"
        class="model-card"
        :class="{ 'model-card--editing': editingId === key }"
      >
        <!-- Card header (always visible) -->
        <div class="model-card__header" @click="toggleEdit(key)">
          <span class="model-card__id">{{ key }}</span>
          <span class="model-card__name">{{ getDisplayName(key) }}</span>
          <div class="model-card__actions">
            <button v-if="editingId !== key" class="model-card__btn" title="Edit" @click.stop="toggleEdit(key)">
              <i class="pi pi-pencil" />
            </button>
            <button class="model-card__btn model-card__btn--danger" title="Delete" @click.stop="deleteModel(key)">
              <i class="pi pi-trash" />
            </button>
            <i :class="editingId === key ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" class="model-card__toggle" />
          </div>
        </div>

        <!-- Edit form (shown when editing) -->
        <div v-if="editingId === key" class="model-card__form">
          <label class="model-card__field">
            Model ID (key)
            <input
              v-model="editForm.id"
              class="model-card__input"
              type="text"
              disabled
              title="Model ID cannot be changed"
            />
          </label>

          <label class="model-card__field">
            Display Name
            <input
              v-model="editForm.name"
              class="model-card__input"
              type="text"
              placeholder="e.g. Qwen 8B"
            />
          </label>

          <div class="model-card__fields-row">
            <label class="model-card__field model-card__field--half">
              Reasoning
              <select v-model="editForm.reasoning" class="model-card__input">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label class="model-card__field model-card__field--half">
              Tool Call
              <select v-model="editForm.tool_call" class="model-card__input">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
          </div>

          <label class="model-card__field">
            Thinking Level
            <select v-model="editForm.thinking_level" class="model-card__input">
              <option value="">(unset)</option>
              <option value="off">off</option>
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
            </select>
          </label>

          <div class="model-card__fields-row">
            <label class="model-card__field model-card__field--half">
              Context Window
              <input
                v-model.number="editForm.limit_context"
                class="model-card__input"
                type="number"
                placeholder="e.g. 128000"
              />
            </label>
            <label class="model-card__field model-card__field--half">
              Output Limit
              <input
                v-model.number="editForm.limit_output"
                class="model-card__input"
                type="number"
                placeholder="e.g. 16384"
              />
            </label>
          </div>

          <!-- Variants section -->
          <div class="model-card__variants-section">
            <div class="model-card__variants-header" @click="toggleVariants(key)">
              <span>Variants</span>
              <button class="model-card__add-variant-btn" @click.stop="createVariant(key)">
                <i class="pi pi-plus" />
              </button>
              <i :class="variantExpandedIds.has(key) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
            </div>

            <!-- Variant list -->
            <div v-if="variantExpandedIds.has(key)" class="model-card__variant-list">
              <div v-for="vKey in variantKeysFor(key)" :key="vKey" class="model-card__variant-card" :class="{ 'model-card__variant-card--editing': editingVariantId === `${key}/${vKey}` }">
                <!-- Variant header -->
                <div class="model-card__variant-header" @click="toggleVariantEdit(key, vKey)">
                  <span class="model-card__variant-id">{{ vKey }}</span>
                  <span class="model-card__variant-label">{{ getVariantName(key, vKey) }}</span>
                  <div class="model-card__variant-actions">
                    <button v-if="editingVariantId !== `${key}/${vKey}`" class="model-card__btn" title="Edit" @click.stop="toggleVariantEdit(key, vKey)">
                      <i class="pi pi-pencil" />
                    </button>
                    <button class="model-card__btn model-card__btn--danger" title="Delete" @click.stop="deleteVariant(key, vKey)">
                      <i class="pi pi-trash" />
                    </button>
                    <i :class="editingVariantId === `${key}/${vKey}` ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" class="model-card__variant-toggle" />
                  </div>
                </div>

                <!-- Variant edit form -->
                <div v-if="editingVariantId === `${key}/${vKey}`" class="model-card__variant-form">
                  <label class="model-card__field">
                    Name
                    <input
                      v-model="variantEditForm.name"
                      class="model-card__input"
                      type="text"
                      disabled
                      title="Variant name cannot be changed"
                    />
                  </label>
                  <label class="model-card__field">
                    Display Label
                    <input
                      v-model="variantEditForm.label"
                      class="model-card__input"
                      type="text"
                      placeholder="e.g. Balanced"
                    />
                  </label>
                  <label class="model-card__field">
                    Thinking
                    <select v-model="variantEditForm.thinking" class="model-card__input">
                      <option :value="true">true</option>
                      <option :value="false">false</option>
                    </select>
                  </label>
                  <label class="model-card__field">
                    Options (YAML)
                    <textarea
                      v-model="variantEditForm.options"
                      class="model-card__input model-card__input--textarea"
                      rows="4"
                      placeholder="temperature: 0.8\ntop_p: 0.95"
                    />
                  </label>
                  <div class="model-card__form-actions">
                    <button class="model-card__save-btn" @click="saveVariant(key, vKey)">Save</button>
                    <button class="model-card__cancel-btn" @click="cancelVariantEdit">Cancel</button>
                  </div>
                </div>
              </div>

              <!-- New variant form -->
              <div v-if="creatingVariantId === key" class="model-card__variant-card model-card__variant-card--new">
                <label class="model-card__field">
                  Variant Name *
                  <input
                    v-model="variantNewForm.name"
                    class="model-card__input"
                    type="text"
                    placeholder="e.g. balanced"
                    @input="validateVariantNewId"
                  />
                  <span v-if="variantNewIdError" class="model-card__error">{{ variantNewIdError }}</span>
                </label>
                <label class="model-card__field">
                  Display Label
                  <input
                    v-model="variantNewForm.label"
                    class="model-card__input"
                    type="text"
                    placeholder="e.g. Balanced"
                  />
                </label>
                <label class="model-card__field">
                  Thinking
                  <select v-model="variantNewForm.thinking" class="model-card__input">
                    <option :value="true">true</option>
                    <option :value="false">false</option>
                  </select>
                </label>
                <div class="model-card__form-actions">
                  <button class="model-card__save-btn" :disabled="!!variantNewIdError" @click="confirmCreateVariant(key)">Create</button>
                  <button class="model-card__cancel-btn" @click="cancelCreateVariant">Cancel</button>
                </div>
              </div>
            </div>
          </div>

          <div class="model-card__form-actions">
            <button class="model-card__save-btn" @click="saveModel">Save</button>
            <button class="model-card__cancel-btn" @click="cancelEdit">Cancel</button>
          </div>
        </div>
      </div>

      <!-- New model form (at bottom, shown when creating) -->
      <div v-if="creating" class="model-card model-card--new">
        <label class="model-card__field">
          Model ID (key) *
          <input
            v-model="newForm.id"
            class="model-card__input"
            type="text"
            placeholder="e.g. lmstudio/qwen3-8b"
            @input="validateNewId"
          />
          <span v-if="newIdError" class="model-card__error">{{ newIdError }}</span>
        </label>

        <label class="model-card__field">
          Display Name
          <input
            v-model="newForm.name"
            class="model-card__input"
            type="text"
            placeholder="e.g. Qwen 8B"
          />
        </label>

        <div class="model-card__fields-row">
          <label class="model-card__field model-card__field--half">
            Reasoning
            <select v-model="newForm.reasoning" class="model-card__input">
              <option :value="true">true</option>
              <option :value="false">false</option>
            </select>
          </label>
          <label class="model-card__field model-card__field--half">
            Tool Call
            <select v-model="newForm.tool_call" class="model-card__input">
              <option :value="true">true</option>
              <option :value="false">false</option>
            </select>
          </label>
        </div>

        <label class="model-card__field">
          Thinking Level
          <select v-model="newForm.thinking_level" class="model-card__input">
            <option value="">(unset)</option>
            <option value="off">off</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
          </select>
        </label>

        <div class="model-card__fields-row">
          <label class="model-card__field model-card__field--half">
            Context Window
            <input
              v-model.number="newForm.limit_context"
              class="model-card__input"
              type="number"
              placeholder="e.g. 128000"
            />
          </label>
          <label class="model-card__field model-card__field--half">
            Output Limit
            <input
              v-model.number="newForm.limit_output"
              class="model-card__input"
              type="number"
              placeholder="e.g. 16384"
            />
          </label>
        </div>

        <div class="model-card__form-actions">
          <button class="model-card__save-btn" :disabled="!!newIdError" @click="confirmCreate">Create</button>
          <button class="model-card__cancel-btn" @click="cancelCreate">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import * as jsYaml from "js-yaml";

const props = defineProps<{
  rawYaml: string;
}>();

const emit = defineEmits<{
  modelUpdate: [yaml: string];
}>();

// ─── State ──────────────────────────────────────────────────────────────────

const editingId = ref<string | null>(null);
const creating = ref(false);
const newIdError = ref("");

interface EditForm {
  id: string;
  name?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  thinking_level?: string;
  limit_context?: number;
  limit_output?: number;
}

const editForm = ref<EditForm>({ id: "" });
const newForm = ref<EditForm>({ id: "" });

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseModels(): Record<string, Record<string, unknown>> {
  try {
    const doc = jsYaml.load(props.rawYaml);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      const models = (doc as Record<string, unknown>).models;
      if (models && typeof models === "object" && !Array.isArray(models)) {
        return models as Record<string, Record<string, unknown>>;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function getDisplayName(key: string): string {
  const models = parseModels();
  const model = models[key];
  if (model && typeof model === "object" && "name" in model && model.name) {
    return model.name as string;
  }
  return key;
}

const modelKeys = computed(() => {
  return Object.keys(parseModels());
});

// ─── Create ─────────────────────────────────────────────────────────────────

function createModel() {
  creating.value = true;
  newForm.value = { id: "", name: "", reasoning: false, tool_call: false, thinking_level: "", limit_context: undefined, limit_output: undefined };
  newIdError.value = "";
}

function cancelCreate() {
  creating.value = false;
}

function validateNewId() {
  const id = newForm.value.id.trim();
  if (!id) {
    newIdError.value = "Model ID is required";
    return;
  }
  if (modelKeys.value.includes(id)) {
    newIdError.value = `Model ID "${id}" already exists`;
    return;
  }
  if (!/^[a-zA-Z0-9_/.-]+$/.test(id)) {
    newIdError.value = "Invalid characters (only a-z, A-Z, 0-9, _, /, ., -)";
    return;
  }
  newIdError.value = "";
}

function confirmCreate() {
  validateNewId();
  if (newIdError.value) return;

  const models = parseModels();
  const id = newForm.value.id.trim();

  if (modelKeys.value.includes(id)) {
    newIdError.value = `Model ID "${id}" already exists`;
    return;
  }

  models[id] = buildModelConfig(newForm.value);
  rebuildYaml({ ...props.rawYaml }, id, models);
  creating.value = false;
}

// ─── Edit ───────────────────────────────────────────────────────────────────

function toggleEdit(key: string) {
  if (editingId.value === key) {
    editingId.value = null;
    return;
  }

  // Load form data
  const models = parseModels();
  const model = models[key] ?? {};
  editForm.value = {
    id: key,
    name: (model.name as string) ?? "",
    reasoning: (model.reasoning as boolean) ?? false,
    tool_call: (model.tool_call as boolean) ?? false,
    thinking_level: (model.thinking_level as string) ?? "",
    limit_context: (model.limit as Record<string, unknown>)?.context as number,
    limit_output: (model.limit as Record<string, unknown>)?.output as number,
  };
  editingId.value = key;
}

function cancelEdit() {
  editingId.value = null;
}

function saveModel() {
  if (!editingId.value) return;
  const key = editingId.value;
  const models = parseModels();
  models[key] = buildModelConfig(editForm.value);
  rebuildYaml(props.rawYaml, key, models);
  editingId.value = null;
}

// ─── Delete ─────────────────────────────────────────────────────────────────

function deleteModel(key: string) {
  if (!confirm(`Delete model "${key}"?`)) return;

  const models = parseModels();
  delete models[key];
  rebuildYaml(props.rawYaml, key, models);
  if (editingId.value === key) editingId.value = null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildModelConfig(form: EditForm): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  if (form.name) config.name = form.name;
  if (form.reasoning !== undefined) config.reasoning = form.reasoning;
  if (form.tool_call !== undefined) config.tool_call = form.tool_call;
  if (form.thinking_level) config.thinking_level = form.thinking_level;
  if (form.limit_context !== undefined || form.limit_output !== undefined) {
    config.limit = {
      ...(form.limit_context !== undefined ? { context: form.limit_context } : {}),
      ...(form.limit_output !== undefined ? { output: form.limit_output } : {}),
    };
  }

  return config;
}

function rebuildYaml(yaml: string, key: string, models: Record<string, Record<string, unknown>>) {
  try {
    const doc = jsYaml.load(yaml) as Record<string, unknown>;
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      doc.models = models;
      emit("modelUpdate", jsYaml.dump(doc));
    }
  } catch {
    emit("modelUpdate", jsYaml.dump({ models }));
  }
}

// ─── Variant state ──────────────────────────────────────────────────────────

const variantExpandedIds = ref<Set<string>>(new Set());
const editingVariantId = ref<string | null>(null);
const creatingVariantId = ref<string | null>(null);
const variantNewIdError = ref("");

interface VariantEditForm {
  name: string;
  label?: string;
  thinking?: boolean;
  options: string;
}

const variantEditForm = ref<VariantEditForm>({ name: "", label: "", options: "" });
const variantNewForm = ref<{ name: string; label?: string; thinking?: boolean }>({ name: "", label: "", thinking: false });

// ─── Variant helpers ────────────────────────────────────────────────────────

function getModelFor(key: string): Record<string, unknown> | null {
  const models = parseModels();
  return (models[key] as Record<string, unknown>) ?? null;
}

function getVariantsFor(key: string): Record<string, Record<string, unknown>> {
  const model = getModelFor(key);
  if (!model || !model.variants || typeof model.variants !== "object" || Array.isArray(model.variants)) return {};
  return model.variants as Record<string, Record<string, unknown>>;
}

function variantKeysFor(key: string): string[] {
  return Object.keys(getVariantsFor(key));
}

function getVariantName(key: string, vKey: string): string {
  const variants = getVariantsFor(key);
  const variant = variants[vKey];
  if (variant && typeof variant === "object" && "label" in variant && variant.label) {
    return variant.label as string;
  }
  return vKey;
}

// ─── Variant CRUD ───────────────────────────────────────────────────────────

function toggleVariants(key: string) {
  if (variantExpandedIds.value.has(key)) {
    variantExpandedIds.value.delete(key);
  } else {
    variantExpandedIds.value.add(key);
  }
}

function toggleVariantEdit(key: string, vKey: string) {
  const id = `${key}/${vKey}`;
  if (editingVariantId.value === id) {
    editingVariantId.value = null;
    return;
  }

  // Load form data
  const variants = getVariantsFor(key);
  const variant = variants[vKey] ?? {};
  variantEditForm.value = {
    name: vKey,
    label: (variant.label as string) ?? "",
    thinking: (variant.thinking as boolean) ?? false,
    options: variant.options ? JSON.stringify(variant.options, null, 2) : "",
  };
  editingVariantId.value = id;
}

function cancelVariantEdit() {
  editingVariantId.value = null;
}

function saveVariant(key: string, vKey: string) {
  if (!editingVariantId.value) return;
  const models = parseModels();
  const model = models[key] as Record<string, unknown> ?? {};
  if (!model.variants || typeof model.variants !== "object") {
    model.variants = {};
  }
  const variants = model.variants as Record<string, Record<string, unknown>>;

  const opts: Record<string, unknown> = {};
  if (variantEditForm.value.label) opts.label = variantEditForm.value.label;
  opts.thinking = variantEditForm.value.thinking;
  if (variantEditForm.value.options.trim()) {
    try {
      opts.options = JSON.parse(variantEditForm.value.options);
    } catch {
      // ignore invalid JSON
    }
  }
  variants[vKey] = opts;

  models[key] = model;
  rebuildYaml(props.rawYaml, key, models);
  editingVariantId.value = null;
}

function deleteVariant(key: string, vKey: string) {
  if (!confirm(`Delete variant "${vKey}" from model "${key}"?`)) return;
  const models = parseModels();
  const model = models[key] as Record<string, unknown> ?? {};
  if (model.variants && typeof model.variants === "object") {
    const variants = model.variants as Record<string, Record<string, unknown>>;
    delete variants[vKey];
    models[key] = model;
    rebuildYaml(props.rawYaml, key, models);
  }
  if (editingVariantId.value === `${key}/${vKey}`) editingVariantId.value = null;
}

function createVariant(key: string) {
  creatingVariantId.value = key;
  variantNewForm.value = { name: "", label: "", thinking: false };
  variantNewIdError.value = "";
}

function cancelCreateVariant() {
  creatingVariantId.value = null;
}

function validateVariantNewId() {
  const id = variantNewForm.value.name.trim();
  if (!id) {
    variantNewIdError.value = "Variant name is required";
    return;
  }
  if (variantKeysFor(creatingVariantId.value ?? "").includes(id)) {
    variantNewIdError.value = `Variant name "${id}" already exists`;
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    variantNewIdError.value = "Invalid characters (only a-z, A-Z, 0-9, _)";
    return;
  }
  variantNewIdError.value = "";
}

function confirmCreateVariant(key: string) {
  validateVariantNewId();
  if (variantNewIdError.value) return;
  if (variantKeysFor(key).includes(variantNewForm.value.name.trim())) {
    variantNewIdError.value = "Variant already exists";
    return;
  }
  const models = parseModels();
  const model = models[key] as Record<string, unknown> ?? {};
  if (!model.variants || typeof model.variants !== "object") {
    model.variants = {};
  }
  const variants = model.variants as Record<string, Record<string, unknown>>;
  const name = variantNewForm.value.name.trim();
  const opts: Record<string, unknown> = {};
  if (variantNewForm.value.label) opts.label = variantNewForm.value.label;
  opts.thinking = variantNewForm.value.thinking;
  variants[name] = opts;
  models[key] = model;
  rebuildYaml(props.rawYaml, key, models);
  creatingVariantId.value = null;
}
</script>

<style scoped>
.model-mgmt {
  border-top: 1px solid var(--p-content-border-color, #e2e8f0);
}

.model-mgmt__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
  background: var(--p-surface-50, #f8fafc);
}

.model-mgmt__title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.model-mgmt__create-btn {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  border: 1px solid var(--p-blue-300, #93c5fd);
  background: var(--p-blue-50, #eff6ff);
  color: var(--p-blue-600, #2563eb);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.model-mgmt__create-btn:hover {
  background: var(--p-blue-100, #dbeafe);
}

.model-mgmt__empty {
  padding: 1rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
}

.model-list {
  display: flex;
  flex-direction: column;
  max-height: 300px;
  overflow-y: auto;
}

.model-card {
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
}

.model-card--new {
  background: var(--p-blue-25, #f0f9ff);
}

.model-card__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s;
}

.model-card__header:hover {
  background: var(--p-surface-100, #f1f5f9);
}

.model-card__id {
  font-weight: 500;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.model-card__name {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #64748b);
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-card__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.model-card__btn {
  padding: 0.15rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.75rem;
  border-radius: 2px;
  transition: color 0.15s;
}

.model-card__btn--danger {
  color: var(--p-red-500, #ef4444);
}

.model-card__btn:hover {
  color: var(--p-text-color, #1e293b);
}

.model-card__btn--danger:hover {
  color: var(--p-red-600, #dc2626);
}

.model-card__toggle {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #64748b);
}

/* ── Variants ── */

.model-card__variants-section {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  margin-top: 0.5rem;
}

.model-card__variants-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  cursor: pointer;
}

.model-card__add-variant-btn {
  padding: 0.1rem 0.3rem;
  background: none;
  border: 1px solid var(--p-blue-300, #93c5fd);
  color: var(--p-blue-600, #2563eb);
  border-radius: 2px;
  font-size: 0.65rem;
  cursor: pointer;
}

.model-card__add-variant-btn:hover {
  background: var(--p-blue-100, #dbeafe);
}

.model-card__variant-list {
  display: flex;
  flex-direction: column;
  margin-top: 0.25rem;
  max-height: 250px;
  overflow-y: auto;
}

.model-card__variant-card {
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
}

.model-card__variant-card--new {
  background: var(--p-blue-25, #f0f9ff);
}

.model-card__variant-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
  font-size: 0.75rem;
}

.model-card__variant-header:hover {
  background: var(--p-surface-100, #f1f5f9);
}

.model-card__variant-id {
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__variant-label {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #64748b);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__variant-actions {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.model-card__variant-toggle {
  font-size: 0.65rem;
  color: var(--p-text-muted-color, #64748b);
}

.model-card__variant-form {
  padding: 0.5rem 0.75rem;
  background: var(--p-surface-100, #f1f5f9);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.model-card__input--textarea {
  font-family: monospace;
  font-size: 0.75rem;
  resize: vertical;
}

.model-card__form {
  padding: 0.75rem;
  background: var(--p-surface-50, #f8fafc);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.model-card__field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.model-card__fields-row {
  display: flex;
  gap: 0.75rem;
}

.model-card__field--half {
  flex: 1;
}

.model-card__error {
  font-size: 0.7rem;
  color: var(--p-red-500, #ef4444);
}

.model-card__input {
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 4px;
  font-size: 0.8rem;
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #1e293b);
  outline: none;
  transition: border-color 0.15s;
}

.model-card__input:focus {
  border-color: var(--p-blue-500, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.model-card__input:disabled {
  background: var(--p-surface-100, #f1f5f9);
  cursor: not-allowed;
}

.model-card__form-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.model-card__save-btn {
  padding: 0.3rem 0.8rem;
  background: var(--p-blue-500, #3b82f6);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s;
}

.model-card__save-btn:hover {
  background: var(--p-blue-600, #2563eb);
}

.model-card__save-btn:disabled {
  background: var(--p-surface-300, #cbd5e1);
  cursor: not-allowed;
}

.model-card__cancel-btn {
  padding: 0.3rem 0.8rem;
  background: var(--p-surface-100, #f1f5f9);
  color: var(--p-text-color, #1e293b);
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s;
}

.model-card__cancel-btn:hover {
  background: var(--p-surface-200, #e2e8f0);
}
</style>

<style>
html.dark-mode .model-mgmt__header {
  background: var(--p-surface-900, #0f172a);
  border-bottom-color: var(--p-surface-700, #334155);
}

html.dark-mode .model-mgmt__create-btn {
  background: var(--p-blue-900, #1e3a5f);
  border-color: var(--p-blue-700, #1d4ed8);
  color: var(--p-blue-300, #93c5fd);
}

html.dark-mode .model-mgmt__create-btn:hover {
  background: var(--p-blue-800, #1e40af);
}

html.dark-mode .model-card {
  border-bottom-color: var(--p-surface-700, #334155);
}

html.dark-mode .model-card--new {
  background: var(--p-blue-900, #1e3a5f);
}

html.dark-mode .model-card__header:hover {
  background: var(--p-surface-800, #1e293b);
}

html.dark-mode .model-card__form {
  background: var(--p-surface-800, #1e293b);
}

html.dark-mode .model-card__input {
  background: var(--p-surface-700, #334155);
  border-color: var(--p-surface-600, #475569);
  color: var(--p-surface-0, #fff);
}

html.dark-mode .model-card__input:focus {
  border-color: var(--p-blue-400, #60a5fa);
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
}

html.dark-mode .model-card__input:disabled {
  background: var(--p-surface-600, #475569);
}

html.dark-mode .model-card__variants-section {
  border-top-color: var(--p-surface-700, #334155);
}

html.dark-mode .model-card__add-variant-btn {
  background: var(--p-blue-900, #1e3a5f);
  border-color: var(--p-blue-700, #1d4ed8);
  color: var(--p-blue-300, #93c5fd);
}

html.dark-mode .model-card__add-variant-btn:hover {
  background: var(--p-blue-800, #1e40af);
}

html.dark-mode .model-card__variant-card {
  border-bottom-color: var(--p-surface-700, #334155);
}

html.dark-mode .model-card__variant-card--new {
  background: var(--p-blue-900, #1e3a5f);
}

html.dark-mode .model-card__variant-header:hover {
  background: var(--p-surface-800, #1e293b);
}

html.dark-mode .model-card__variant-form {
  background: var(--p-surface-700, #334155);
}
</style>
