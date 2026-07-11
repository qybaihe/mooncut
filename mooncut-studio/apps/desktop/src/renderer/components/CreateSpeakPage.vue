<script setup lang="ts">
/**
 * 创作口播 — standalone page (Cherry-style dense shell + Web RecordStudio capabilities).
 * Layout: compact page chrome + full-height assistant/script dual pane.
 */
import {computed, onMounted, ref} from "vue";
import {getMooncut} from "../composables/useMooncut";
import RecordStudio from "./RecordStudio.vue";
import UiIcon from "./UiIcon.vue";
import type {ProjectSummary} from "@mooncut/studio-shared";

const props = defineProps<{
  project: ProjectSummary | null;
}>();

const emit = defineEmits<{
  "open-project": [ProjectSummary];
  "go-edit": [ProjectSummary];
  "go-library": [];
}>();

const projects = ref<ProjectSummary[]>([]);
const bindProjectId = ref<string | null>(props.project?.id ?? null);
const toast = ref("");

const boundProject = computed(
  () => projects.value.find((p) => p.id === bindProjectId.value) ?? props.project,
);

async function loadProjects() {
  try {
    projects.value = await getMooncut().listProjects();
    if (!bindProjectId.value && projects.value[0]) {
      bindProjectId.value = projects.value[0].id;
    }
  } catch {
    projects.value = [];
  }
}

async function ensureProjectForSave(): Promise<ProjectSummary | null> {
  if (boundProject.value) return boundProject.value;
  // Auto-create a scratch project under workspace if user starts from empty library
  try {
    const settings = await getMooncut().getSettings();
    const root = settings.workspaceRoot;
    if (!root) {
      toast.value = "请先在设置中选择工作目录，或从项目库打开一个项目";
      return null;
    }
    const project = await getMooncut().createProject({
      name: `口播 ${new Date().toLocaleString("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"})}`,
      parentDirectory: root,
    });
    await loadProjects();
    bindProjectId.value = project.id;
    emit("open-project", project);
    return project;
  } catch (err) {
    toast.value = err instanceof Error ? err.message : "无法创建项目";
    return null;
  }
}

async function onSavedToProject(payload: {mediaAssetId: string; absolutePath: string}) {
  const project = boundProject.value;
  if (project) {
    emit("open-project", project);
    emit("go-edit", project);
  }
}

async function onSendToEdit() {
  const project = (await ensureProjectForSave()) ?? boundProject.value;
  if (project) {
    emit("open-project", project);
    emit("go-edit", project);
  } else {
    emit("go-library");
  }
}

onMounted(() => {
  void loadProjects();
  if (props.project) bindProjectId.value = props.project.id;
});
</script>

<template>
  <div class="create-speak-page">
    <!-- Cherry-like dense page header -->
    <header class="create-speak-header">
      <div class="create-speak-title">
        <span class="assistant-mark" aria-hidden="true">
          <UiIcon name="chat" :size="16" />
        </span>
        <div>
          <h1>创作口播</h1>
          <p>左对话 · 右成稿 · 提词录制</p>
        </div>
      </div>
      <div class="create-speak-meta">
        <label class="project-bind">
          <span class="meta">保存到项目</span>
          <select
            :value="bindProjectId ?? ''"
            @change="bindProjectId = ($event.target as HTMLSelectElement).value || null"
          >
            <option value="">自动 / 新建</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <button type="button" class="ghost compact" @click="emit('go-library')">
          <UiIcon name="library" :size="14" />
          项目库
        </button>
        <button
          type="button"
          class="ghost compact"
          :disabled="!boundProject"
          @click="boundProject && emit('go-edit', boundProject)"
        >
          <UiIcon name="workbench" :size="14" />
          剪辑台
        </button>
      </div>
    </header>

    <div v-if="toast" class="notice warn" style="margin: 0 0 8px">{{ toast }}</div>

    <!-- Full-bleed assistant surface -->
    <div class="create-speak-body">
      <RecordStudio
        :project-id="boundProject?.id"
        :project-name="boundProject?.name"
        :user-key="boundProject?.id ?? 'create-speak'"
        @saved-to-project="onSavedToProject"
        @send-to-edit="onSendToEdit"
      />
    </div>
  </div>
</template>
