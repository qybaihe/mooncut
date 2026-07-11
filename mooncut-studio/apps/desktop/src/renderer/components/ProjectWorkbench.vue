<script setup lang="ts">
/**
 * Simplified project workbench — aligned with mooncut-web ClipStudio flow:
 * empty upload → ready + one-click cut → processing → done.
 * No free-form prompt wall / 3-column console chrome by default.
 */
import {computed, onMounted, onUnmounted, ref, watch} from "vue";
import {getMooncut} from "../composables/useMooncut";
import UiIcon from "./UiIcon.vue";
import {STAGE_LABELS, type ProjectMediaAsset, type ProjectSummary, type StudioJob} from "@mooncut/studio-shared";

const props = defineProps<{project: ProjectSummary}>();
const emit = defineEmits<{back: []; "create-speak": []}>();

/** Fixed product prompt — not shown as a long textarea (web-style preset). */
const DEFAULT_PROMPT = "按默认 MoonCut 原生口播规范剪辑，保留完整时长与人物表达。";

const media = ref<ProjectMediaAsset[]>([]);
const jobs = ref<StudioJob[]>([]);
const selectedMediaId = ref<string | null>(null);
const selectedJobId = ref<string | null>(null);
const previewUrl = ref<string | null>(null);
const previewError = ref("");
const resultPreviewUrl = ref<string | null>(null);
const error = ref("");
const busy = ref(false);
const showAdvanced = ref(false);
const intensity = ref<"轻" | "自然" | "紧凑">("自然");
let pollTimer: number | undefined;

const selectedMedia = computed(() => media.value.find((item) => item.id === selectedMediaId.value) ?? null);
const selectedJob = computed(() => jobs.value.find((item) => item.id === selectedJobId.value) ?? null);
const stageLabel = computed(() => STAGE_LABELS[selectedJob.value?.stage ?? ""] ?? selectedJob.value?.stage ?? "");

type ClipStage = "empty" | "ready" | "processing" | "done" | "failed";
const clipStage = computed<ClipStage>(() => {
  const job = selectedJob.value;
  if (job && (job.status === "queued" || job.status === "running")) return "processing";
  if (job && job.status === "completed") return "done";
  if (job && (job.status === "failed" || job.status === "cancelled")) return "failed";
  if (selectedMedia.value || media.value.length > 0) return "ready";
  return "empty";
});

const progressPct = computed(() => Math.round((selectedJob.value?.progress || 0) * 100));

const processingSteps = [
  {key: "inspecting-source", label: "读取口播"},
  {key: "transcribing", label: "识别内容"},
  {key: "planning-edit", label: "整理节奏"},
  {key: "rendering", label: "合成成片"},
  {key: "completed", label: "质量检查"},
];

const activeStepIndex = computed(() => {
  const stage = selectedJob.value?.stage ?? "";
  const idx = processingSteps.findIndex((s) => s.key === stage);
  if (selectedJob.value?.status === "completed") return processingSteps.length - 1;
  if (idx >= 0) return idx;
  if (progressPct.value < 20) return 0;
  if (progressPct.value < 45) return 1;
  if (progressPct.value < 70) return 2;
  if (progressPct.value < 95) return 3;
  return 4;
});

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildPrompt() {
  const intensityHint =
    intensity.value === "轻" ? "节奏偏松，少删。" : intensity.value === "紧凑" ? "节奏紧凑，适度精简停顿。" : "自然节奏，轻度精简。";
  return `${DEFAULT_PROMPT} ${intensityHint}`;
}

async function loadPreview(absolutePath: string | undefined) {
  previewError.value = "";
  previewUrl.value = null;
  if (!absolutePath) return;
  try {
    previewUrl.value = await getMooncut().mediaPreviewUrl(absolutePath);
  } catch (err) {
    previewError.value = err instanceof Error ? err.message : "无法加载预览";
  }
}

async function loadResultPreview(job: StudioJob | null) {
  resultPreviewUrl.value = null;
  const path = job?.artifacts?.video;
  if (!path) return;
  if (path.startsWith("http://") || path.startsWith("https://")) return;
  try {
    resultPreviewUrl.value = await getMooncut().mediaPreviewUrl(path);
  } catch {
    resultPreviewUrl.value = null;
  }
}

async function refresh() {
  const api = getMooncut();
  media.value = await api.listMedia(props.project.id);
  jobs.value = await api.listJobs(props.project.id);
  if (!selectedMediaId.value && media.value[0]) selectedMediaId.value = media.value[0].id;
  // Prefer active/latest job
  if (!selectedJobId.value && jobs.value[0]) selectedJobId.value = jobs.value[0].id;
  await loadPreview(selectedMedia.value?.absolutePath);
  await loadResultPreview(selectedJob.value);
}

watch(selectedMediaId, async (id) => {
  const item = media.value.find((m) => m.id === id);
  await loadPreview(item?.absolutePath);
});

watch(selectedJobId, async (id) => {
  const job = jobs.value.find((j) => j.id === id) ?? null;
  await loadResultPreview(job);
});

async function importVideo() {
  busy.value = true;
  error.value = "";
  try {
    const result = await getMooncut().importMedia(props.project.id);
    if (result.probe.error) error.value = `已导入，但媒体探测失败：${result.probe.error}`;
    selectedMediaId.value = result.asset.id;
    selectedJobId.value = null;
    resultPreviewUrl.value = null;
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function startJob() {
  if (!selectedMediaId.value) {
    error.value = "请先导入视频";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const job = await getMooncut().createJob({
      projectId: props.project.id,
      mediaAssetId: selectedMediaId.value,
      prompt: buildPrompt(),
      title: props.project.name,
    });
    selectedJobId.value = job.id;
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function pollSelected() {
  if (!selectedJobId.value) return;
  const job = selectedJob.value;
  if (!job || job.status === "completed" || job.status === "failed" || job.status === "cancelled") return;
  try {
    const latest = await getMooncut().getJob(props.project.id, selectedJobId.value);
    jobs.value = jobs.value.map((item) => (item.id === latest.id ? latest : item));
    if (latest.status === "completed") await loadResultPreview(latest);
  } catch {
    /* keep last */
  }
}

async function cancelJob() {
  if (!selectedJobId.value) return;
  busy.value = true;
  try {
    const job = await getMooncut().cancelJob(props.project.id, selectedJobId.value);
    jobs.value = jobs.value.map((item) => (item.id === job.id ? job : item));
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function retryJob() {
  if (!selectedJobId.value) return;
  busy.value = true;
  try {
    const job = await getMooncut().retryJob(props.project.id, selectedJobId.value);
    selectedJobId.value = job.id;
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function revealVideo() {
  const path = selectedJob.value?.artifacts?.video;
  if (path && !path.startsWith("http")) await getMooncut().revealArtifact(path);
  else if (selectedMedia.value) await getMooncut().revealArtifact(selectedMedia.value.absolutePath);
}

async function revealProject() {
  await getMooncut().revealProject(props.project.id);
}

function resetToNew() {
  selectedJobId.value = null;
  resultPreviewUrl.value = null;
  showAdvanced.value = false;
}

watch(() => props.project.id, () => void refresh());

onMounted(() => {
  void refresh();
  pollTimer = window.setInterval(() => void pollSelected(), 800);
});

onUnmounted(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});
</script>

<template>
  <div class="clip-page">
    <!-- Compact action bar (rail + global topbar already show project name) -->
    <header class="clip-topbar">
      <div class="clip-topbar-actions">
        <button type="button" class="ghost compact" @click="emit('create-speak')">
          <UiIcon name="chat" :size="13" />
          创作口播
        </button>
      </div>
      <div class="clip-topbar-actions">
        <button type="button" class="ghost compact" title="在访达中显示" @click="revealProject">
          <UiIcon name="folder" :size="14" />
          打开目录
        </button>
      </div>
    </header>

    <div v-if="error" class="notice alert">{{ error }}</div>

    <!-- EMPTY: compact drop target -->
    <div v-if="clipStage === 'empty'" class="upload-layout">
      <button
        type="button"
        class="upload-zone"
        :disabled="busy"
        @click="importVideo"
      >
        <span class="upload-zone-icon"><UiIcon name="upload" :size="24" /></span>
        <h2>{{ busy ? "正在导入…" : "拖入或选择一条口播视频" }}</h2>
        <p>MoonCut 会自动整理节奏与字幕</p>
        <span class="primary upload-cta">
          <UiIcon name="upload" :size="15" />
          选择视频
        </span>
        <small>支持 MP4 · MOV · WebM</small>
      </button>
      <p class="upload-alt">
        也可以
        <button type="button" class="linkish" @click="emit('create-speak')">去创作口播助手写稿 / 录制</button>
      </p>
    </div>

    <!-- READY: video + compact preset card -->
    <div v-else-if="clipStage === 'ready'" class="clip-workbench">
      <div class="video-card">
        <div class="card-toolbar">
          <span><span class="status-dot" /> 原始视频</span>
          <button type="button" class="ghost compact" :disabled="busy" @click="importVideo">
            <UiIcon name="refresh" :size="13" />
            更换
          </button>
        </div>
        <div class="preview-stage portrait-friendly">
          <video
            v-if="previewUrl"
            class="studio-preview-video"
            :src="previewUrl"
            controls
            playsinline
            @error="previewError = '视频解码失败，请确认格式为 mp4/webm/mov'"
          />
          <div v-else-if="previewError" class="preview-fallback">
            <strong>无法播放</strong>
            <p>{{ previewError }}</p>
          </div>
          <div v-else class="preview-fallback">正在准备预览…</div>
        </div>
        <div v-if="selectedMedia" class="file-meta">
          <span class="file-icon"><UiIcon name="media" :size="18" /></span>
          <div>
            <strong>{{ selectedMedia.filename }}</strong>
            <small>
              {{ formatSize(selectedMedia.bytes) }}
              <template v-if="selectedMedia.durationMs"> · {{ (selectedMedia.durationMs / 1000).toFixed(1) }}s</template>
              · 已准备好
            </small>
          </div>
          <UiIcon name="check" :size="18" class="success-icon" />
        </div>
      </div>

      <aside class="settings-card">
        <span class="mini-label">本次剪辑</span>

        <div class="setting-row">
          <span><UiIcon name="layers" :size="15" /> 节奏</span>
          <div class="segmented-control" role="group" aria-label="节奏强度">
            <button
              v-for="option in (['轻', '自然', '紧凑'] as const)"
              :key="option"
              type="button"
              :class="{'is-selected': intensity === option}"
              @click="intensity = option"
            >
              {{ option }}
            </button>
          </div>
        </div>

        <button type="button" class="primary start-cut" :disabled="busy || !selectedMedia" @click="startJob">
          <UiIcon name="sparkles" :size="16" />
          {{ busy ? "提交中…" : "开始智能剪辑" }}
        </button>

        <button type="button" class="ghost compact advanced-toggle" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? "收起素材列表" : "素材与历史" }}
          <span class="chevron" :class="{rotated: showAdvanced}"><UiIcon name="chevron-right" :size="13" /></span>
        </button>

        <div v-if="showAdvanced" class="advanced-block">
          <div class="mini-label">素材</div>
          <button
            v-for="item in media"
            :key="item.id"
            type="button"
            class="media-chip"
            :class="{active: item.id === selectedMediaId}"
            @click="selectedMediaId = item.id"
          >
            {{ item.filename }}
          </button>
          <div v-if="jobs.length" class="mini-label" style="margin-top: 12px">历史任务</div>
          <button
            v-for="job in jobs.slice(0, 5)"
            :key="job.id"
            type="button"
            class="media-chip"
            :class="{active: job.id === selectedJobId}"
            @click="selectedJobId = job.id"
          >
            {{ job.status }} · {{ STAGE_LABELS[job.stage] || job.stage }}
          </button>
        </div>
      </aside>
    </div>

    <!-- PROCESSING -->
    <div v-else-if="clipStage === 'processing'" class="clip-status-layout">
      <div class="processing-card">
        <div class="processing-header">
          <UiIcon name="sparkles" :size="20" />
          <div>
            <h2>正在智能剪辑</h2>
            <p>{{ stageLabel || "处理中" }} · {{ progressPct }}%</p>
          </div>
        </div>
        <div class="progress-track large">
          <span :style="{width: `${progressPct}%`}" />
        </div>
        <ol class="process-steps">
          <li
            v-for="(step, index) in processingSteps"
            :key="step.key"
            :class="{
              done: index < activeStepIndex,
              current: index === activeStepIndex,
            }"
          >
            <span class="step-dot" />
            {{ step.label }}
          </li>
        </ol>
        <div class="row" style="margin-top: 1rem">
          <button type="button" class="ghost" :disabled="busy" @click="cancelJob">取消任务</button>
        </div>
      </div>
    </div>

    <!-- DONE -->
    <div v-else-if="clipStage === 'done'" class="clip-workbench">
      <div class="video-card">
        <div class="card-toolbar">
          <span><span class="status-dot ok" /> 成片预览</span>
          <button type="button" class="ghost compact" @click="revealVideo">
            <UiIcon name="folder" :size="13" />
            在文件夹中显示
          </button>
        </div>
        <div class="preview-stage portrait-friendly">
          <video
            v-if="resultPreviewUrl || previewUrl"
            class="studio-preview-video"
            :src="(resultPreviewUrl || previewUrl)!"
            controls
            playsinline
          />
          <div v-else class="preview-fallback">成片已就绪，预览准备中…</div>
        </div>
      </div>
      <aside class="settings-card">
        <span class="mini-label">已完成</span>
        <p class="meta" style="margin: 0 0 0.75rem; line-height: 1.5">
          成片已保存在本机项目目录，音频、画面与字幕检查已跑完。
        </p>
        <button type="button" class="primary start-cut" @click="revealVideo">
          <UiIcon name="download" :size="16" />
          打开成片位置
        </button>
        <button type="button" class="ghost start-cut" @click="resetToNew(); importVideo()">
          <UiIcon name="upload" :size="15" />
          再剪一条
        </button>
        <button type="button" class="ghost compact" @click="resetToNew()">返回素材</button>
      </aside>
    </div>

    <!-- FAILED / CANCELLED -->
    <div v-else class="clip-status-layout">
      <div class="processing-card">
        <div class="processing-header">
          <UiIcon name="refresh" :size="20" />
          <div>
            <h2>{{ selectedJob?.status === "cancelled" ? "已取消" : "任务未完成" }}</h2>
            <p class="meta">{{ selectedJob?.error || stageLabel }}</p>
          </div>
        </div>
        <div class="row" style="margin-top: 1rem; gap: 8px">
          <button
            v-if="selectedJob?.status === 'failed'"
            type="button"
            class="primary"
            :disabled="busy"
            @click="retryJob"
          >
            <UiIcon name="refresh" :size="14" />
            重试
          </button>
          <button type="button" class="ghost" @click="resetToNew">返回</button>
          <button type="button" class="primary" :disabled="busy || !selectedMedia" @click="startJob">
            重新剪辑
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
