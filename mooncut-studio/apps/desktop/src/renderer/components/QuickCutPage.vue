<script setup lang="ts">
/**
 * 一键剪辑 — 轻量独立页：选视频 → 自动归到「快速剪辑」项目 → 提交 → 轮询 → 成片预览。
 * 不暴露节奏/强度选择（真一键），advanced 用户去剪辑台调。
 */
import {computed, onBeforeUnmount, ref} from "vue";
import {getMooncut} from "../composables/useMooncut";
import UiIcon from "./UiIcon.vue";
import {STAGE_LABELS, type ProjectSummary, type StudioJob, type StudioSettings} from "@mooncut/studio-shared";

const emit = defineEmits<{ "go-inbox": [] }>();

type QuickStage = "empty" | "processing" | "done" | "failed";

const stage = ref<QuickStage>("empty");
const settings = ref<StudioSettings | null>(null);
const busy = ref(false);
const error = ref("");
const activeJob = ref<StudioJob | null>(null);
const resultPreviewUrl = ref<string | null>(null);
const progressPct = ref(0);
const quickProjectId = ref<string | null>(null);
let pollTimer: number | undefined;

const QUICK_PROJECT_NAME = "快速剪辑";
const DEFAULT_PROMPT = "按默认 MoonCut 原生口播规范剪辑，保留完整时长与人物表达，自然节奏，轻度精简停顿。";

const processingSteps = [
  {key: "inspecting-source", label: "读取口播"},
  {key: "transcribing", label: "识别内容"},
  {key: "planning-edit", label: "整理节奏"},
  {key: "rendering", label: "合成成片"},
  {key: "completed", label: "质量检查"},
];

const stageLabel = computed(() => {
  const s = activeJob.value?.stage ?? "";
  return STAGE_LABELS[s] || s || "处理中";
});

const activeStepIndex = computed(() => {
  const s = activeJob.value?.stage ?? "";
  const idx = processingSteps.findIndex((step) => step.key === s);
  if (activeJob.value?.status === "completed") return processingSteps.length - 1;
  if (idx >= 0) return idx;
  if (progressPct.value < 20) return 0;
  if (progressPct.value < 45) return 1;
  if (progressPct.value < 70) return 2;
  if (progressPct.value < 95) return 3;
  return 4;
});

async function loadSettings() {
  try {
    settings.value = await getMooncut().getSettings();
  } catch {
    /* keep null */
  }
}

/** 找到或创建「快速剪辑」内置项目，返回 projectId。 */
async function ensureQuickProject(): Promise<string | null> {
  const api = getMooncut();
  const projects = await api.listProjects();
  const existing = projects.find((p: ProjectSummary) => p.name === QUICK_PROJECT_NAME);
  if (existing) return existing.id;
  if (!settings.value?.workspaceRoot) {
    error.value = "请先在设置中选择工作目录";
    return null;
  }
  try {
    const created = await api.createProject({
      name: QUICK_PROJECT_NAME,
      parentDirectory: settings.value.workspaceRoot,
    }) as { id: string };
    return created.id;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "无法创建快速剪辑项目";
    return null;
  }
}

async function selectAndCut() {
  error.value = "";
  busy.value = true;
  try {
    const filePath = await getMooncut().selectVideo();
    if (!filePath) {
      busy.value = false;
      return;
    }
    const projectId = await ensureQuickProject();
    if (!projectId) {
      busy.value = false;
      return;
    }
    quickProjectId.value = projectId;
    // 导入视频到项目
    const asset = await getMooncut().importMedia(projectId, filePath) as { id: string };
    // 提交剪辑任务
    const job = await getMooncut().createJob({
      projectId,
      mediaAssetId: asset.id,
      prompt: DEFAULT_PROMPT,
      title: `快速剪辑 ${new Date().toLocaleString("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"})}`,
    }) as StudioJob;
    activeJob.value = job;
    progressPct.value = 0;
    stage.value = "processing";
    startPolling();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    stage.value = "failed";
  } finally {
    busy.value = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(pollJob, 800);
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = undefined;
}

async function pollJob() {
  if (!activeJob.value || !quickProjectId.value) return;
  try {
    const job = await getMooncut().getJob(quickProjectId.value, activeJob.value.id) as StudioJob;
    activeJob.value = job;
    progressPct.value = Math.round((job.progress || 0) * 100);
    if (job.status === "completed") {
      stopPolling();
      await loadResultPreview(job);
      stage.value = "done";
    } else if (job.status === "failed" || job.status === "cancelled") {
      stopPolling();
      stage.value = "failed";
      error.value = job.error || "剪辑任务未完成";
    }
  } catch (err) {
    stopPolling();
    stage.value = "failed";
    error.value = err instanceof Error ? err.message : "轮询任务状态失败";
  }
}

async function loadResultPreview(job: StudioJob) {
  resultPreviewUrl.value = null;
  const videoPath = job.artifacts?.video;
  if (!videoPath) return;
  if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) return;
  try {
    resultPreviewUrl.value = await getMooncut().mediaPreviewUrl(videoPath);
  } catch {
    resultPreviewUrl.value = null;
  }
}

async function revealResult() {
  const path = activeJob.value?.artifacts?.video;
  if (path) await getMooncut().revealArtifact(path);
}

// P2: result detail computeds
const resultDuration = computed(() => {
  const ms = activeJob.value?.result?.probe?.durationMs;
  return ms ? `${(ms / 1000).toFixed(1)}秒` : "—";
});
const resultModel = computed(() => activeJob.value?.result?.models?.planner ?? "—");
const resultQuality = computed(() => (activeJob.value?.result?.quality?.ok ? "通过" : "待检查"));

function reset() {
  stopPolling();
  stage.value = "empty";
  activeJob.value = null;
  resultPreviewUrl.value = null;
  progressPct.value = 0;
  error.value = "";
}

async function retry() {
  if (!activeJob.value || !quickProjectId.value) {
    reset();
    return;
  }
  try {
    const job = await getMooncut().retryJob(quickProjectId.value, activeJob.value.id) as StudioJob;
    activeJob.value = job;
    progressPct.value = 0;
    error.value = "";
    stage.value = "processing";
    startPolling();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "重试失败";
  }
}

loadSettings();

onBeforeUnmount(() => stopPolling());
</script>

<template>
  <div class="quickcut-page">
    <!-- EMPTY -->
    <div v-if="stage === 'empty'" class="upload-layout">
      <button
        type="button"
        class="upload-zone"
        :disabled="busy"
        @click="selectAndCut"
      >
        <span class="upload-zone-icon"><UiIcon name="upload" :size="24" /></span>
        <h2>{{ busy ? "正在准备…" : "选一个视频，一键开剪" }}</h2>
        <p>自动整理节奏与字幕，无需选项目、无需调参数</p>
        <span class="primary upload-cta">
          <UiIcon name="upload" :size="15" />
          选择视频
        </span>
        <small>支持 MP4 · MOV · WebM</small>
      </button>
      <div v-if="error" class="notice alert" style="margin-top: 12px">{{ error }}</div>
    </div>

    <!-- PROCESSING -->
    <div v-else-if="stage === 'processing'" class="clip-status-layout">
      <div class="processing-card">
        <div class="processing-header">
          <UiIcon name="sparkles" :size="20" />
          <div>
            <h2>正在智能剪辑</h2>
            <p>{{ stageLabel }} · {{ progressPct }}%</p>
          </div>
        </div>
        <div class="progress-track large">
          <span :style="{width: `${progressPct}%`}" />
        </div>
        <ol class="process-steps">
          <li
            v-for="(step, index) in processingSteps"
            :key="step.key"
            :class="{done: index < activeStepIndex, current: index === activeStepIndex}"
          >
            <span class="step-dot" />
            {{ step.label }}
          </li>
        </ol>
      </div>
    </div>

    <!-- DONE -->
    <div v-else-if="stage === 'done'" class="quickcut-done">
      <div class="video-card">
        <div class="card-toolbar">
          <span><span class="status-dot ok" /> 成片预览</span>
          <button type="button" class="ghost compact" @click="revealResult">
            <UiIcon name="folder" :size="13" />
            打开目录
          </button>
        </div>
        <div class="preview-stage portrait-friendly">
          <video
            v-if="resultPreviewUrl"
            class="studio-preview-video"
            :src="resultPreviewUrl"
            controls
            playsinline
          />
          <div v-else class="preview-fallback">成片已就绪，预览准备中…</div>
        </div>
      </div>
      <aside class="settings-card">
        <span class="mini-label">已完成</span>
        <p class="meta" style="margin: 0 0 0.5rem; line-height: 1.5">
          成片已保存在本机「快速剪辑」项目目录。
        </p>
        <div class="result-stats">
          <span><small>成片时长</small><strong>{{ resultDuration }}</strong></span>
          <span><small>规划模型</small><strong>{{ resultModel }}</strong></span>
          <span><small>质量检查</small><strong>{{ resultQuality }}</strong></span>
        </div>
        <button type="button" class="primary start-cut" @click="revealResult">
          <UiIcon name="download" :size="16" />
          打开成片位置
        </button>
        <button type="button" class="ghost start-cut" @click="reset">
          <UiIcon name="upload" :size="15" />
          再剪一条
        </button>
        <button type="button" class="ghost compact" @click="emit('go-inbox')">
          <UiIcon name="media" :size="14" />
          去收件箱看全部
        </button>
      </aside>
    </div>

    <!-- FAILED -->
    <div v-else class="clip-status-layout">
      <div class="processing-card">
        <div class="processing-header">
          <UiIcon name="refresh" :size="20" />
          <div>
            <h2>任务未完成</h2>
            <p class="meta">{{ error || stageLabel }}</p>
          </div>
        </div>
        <div class="row" style="margin-top: 1rem; gap: 8px">
          <button type="button" class="primary" @click="retry">
            <UiIcon name="refresh" :size="14" />
            重试
          </button>
          <button type="button" class="ghost" @click="reset">返回</button>
        </div>
      </div>
    </div>
  </div>
</template>
