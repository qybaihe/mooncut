<script setup lang="ts">
import {onMounted, ref, watch} from "vue";
import {getMooncut} from "../composables/useMooncut";
import type {ProjectSummary, StudioSettings} from "@mooncut/studio-shared";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{settings: StudioSettings | null}>();
const emit = defineEmits<{open: [ProjectSummary]; settings: []}>();

const projects = ref<ProjectSummary[]>([]);
const name = ref("");
const parentDir = ref("");
const error = ref("");
const busy = ref(false);
const showCreate = ref(false);

async function refresh() {
  projects.value = await getMooncut().listProjects();
}

async function pickParent() {
  const path = await getMooncut().selectDirectory();
  if (path) parentDir.value = path;
}

function openCreate() {
  error.value = "";
  name.value = "";
  parentDir.value = props.settings?.workspaceRoot ?? parentDir.value;
  showCreate.value = true;
}

function closeCreate() {
  if (busy.value) return;
  showCreate.value = false;
  error.value = "";
}

async function create() {
  if (!name.value.trim()) {
    error.value = "请输入项目名称";
    return;
  }
  const parent = parentDir.value || props.settings?.workspaceRoot;
  if (!parent) {
    error.value = "请选择保存位置";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const project = await getMooncut().createProject({name: name.value.trim(), parentDirectory: parent});
    showCreate.value = false;
    name.value = "";
    await refresh();
    emit("open", project);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function reveal(project: ProjectSummary) {
  await getMooncut().revealProject(project.id);
}

async function remove(project: ProjectSummary) {
  if (!confirm(`从项目库移除「${project.name}」？`)) return;
  const deleteFiles = confirm("同时删除本地项目文件夹？此操作不可恢复。");
  await getMooncut().deleteProject(project.id, deleteFiles);
  await refresh();
}

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && showCreate.value) closeCreate();
}

watch(showCreate, (open) => {
  if (open) window.addEventListener("keydown", onKeydown);
  else window.removeEventListener("keydown", onKeydown);
});

onMounted(async () => {
  parentDir.value = props.settings?.workspaceRoot ?? "";
  await refresh();
});
</script>

<template>
  <div class="library-page">
    <div class="library-header">
      <h1>项目库</h1>
      <div class="library-actions">
        <button type="button" class="primary compact" @click="openCreate">
          <UiIcon name="plus" :size="14" />
          新建项目
        </button>
        <button type="button" class="ghost compact icon-only" title="刷新" @click="refresh">
          <UiIcon name="refresh" :size="14" />
        </button>
      </div>
    </div>

    <!-- Create project modal -->
    <div
      v-if="showCreate"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
      @click.self="closeCreate"
    >
      <div class="modal-card">
        <h3 id="create-project-title">
          <UiIcon name="plus" :size="16" />
          新建项目
        </h3>
        <div class="form-grid">
          <label>
            项目名称
            <input
              v-model="name"
              placeholder="例如：产品发布口播"
              autofocus
              @keydown.enter.prevent="create"
            />
          </label>
          <label>
            保存位置
            <div class="row">
              <input v-model="parentDir" readonly />
              <button type="button" class="compact" @click="pickParent">
                <UiIcon name="folder" :size="14" />
                浏览
              </button>
            </div>
          </label>
          <p class="meta" style="margin: 0">素材只保存在本地，不会自动上传。</p>
          <div v-if="error" class="notice alert" style="margin: 0">{{ error }}</div>
          <div class="modal-actions">
            <button type="button" class="ghost compact" :disabled="busy" @click="closeCreate">取消</button>
            <button type="button" class="primary compact" :disabled="busy" @click="create">
              {{ busy ? "创建中…" : "创建并打开" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="error && !showCreate" class="notice alert">{{ error }}</div>

    <div v-if="projects.length === 0" class="empty-state compact-empty">
      <div class="empty-state-icon">
        <UiIcon name="empty" :size="20" />
      </div>
      <h3>还没有本地项目</h3>
      <p>创建项目后即可导入视频、发起剪辑任务。</p>
      <button type="button" class="primary compact" @click="openCreate">
        <UiIcon name="plus" :size="14" />
        创建第一个项目
      </button>
    </div>

    <div v-else class="grid-cards">
      <article v-for="project in projects" :key="project.id" class="card card-project">
        <div class="card-thumb" aria-hidden="true">
          <UiIcon name="media" :size="22" />
        </div>
        <div class="card-project-body">
          <div class="card-project-top">
            <h3>{{ project.name }}</h3>
            <div class="meta mono card-path">
              {{ project.rootPath }}
            </div>
          </div>
          <div class="meta card-stats">
            更新 {{ formatTime(project.updatedAt) }} · 素材 {{ project.mediaCount }} · 任务 {{ project.jobCount }}
            <template v-if="project.lastJobStatus"> · {{ project.lastJobStatus }}</template>
          </div>
          <div class="actions">
            <button type="button" class="primary compact" @click="emit('open', project)">
              <UiIcon name="open" :size="13" />
              打开
            </button>
            <button type="button" class="ghost compact icon-only" title="在文件夹中显示" @click="reveal(project)">
              <UiIcon name="folder" :size="14" />
            </button>
            <button type="button" class="danger compact icon-only" title="删除" @click="remove(project)">
              <UiIcon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
