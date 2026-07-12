<script setup lang="ts">
/**
 * 收件箱 / 渲染队列看板 — 三段式：
 *  1. 顶部摘要（运行中 / 排队中 / 今日完成）
 *  2. 中部「当前运行队列」active items
 *  3. 底部「最近完成」recent items + inbox 已完成成片列表
 */
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import {getMooncut} from "../composables/useMooncut";
import UiIcon from "./UiIcon.vue";
import {STAGE_LABELS, type InboxItem, type RenderQueueItem, type RenderQueueSnapshot} from "@mooncut/studio-shared";

const snapshot = ref<RenderQueueSnapshot | null>(null);
const inboxItems = ref<InboxItem[]>([]);
const loading = ref(false);
const error = ref("");
const expandedId = ref<string | null>(null);
const previewUrls = ref<Record<string, string>>({});
let refreshTimer: number | undefined;

const stageLabels: Record<string, string> = STAGE_LABELS;

function stageLabel(item: RenderQueueItem): string {
  return stageLabels[item.stage] || item.stage || "处理中";
}

function statusLabel(item: RenderQueueItem): string {
  if (item.status === "running") return `${Math.round(item.progress * 100)}%`;
  if (item.status === "queued") return item.queuePosition === 1 ? "即将开始" : `前方 ${item.queuePosition! - 1} 个任务`;
  if (item.status === "completed") return "已完成";
  return "未完成";
}

function progressBarWidth(item: RenderQueueItem): string {
  if (item.status === "queued") return "4%";
  return `${Math.max(4, Math.round(item.progress * 100))}%`;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"});
  } catch {
    return iso;
  }
}

async function refresh(silent = false) {
  if (!silent) loading.value = true;
  error.value = "";
  try {
    const api = getMooncut();
    const [queue, inbox] = await Promise.all([
      api.getRenderQueue().catch(() => null),
      api.listAllJobs().catch(() => [] as InboxItem[]),
    ]);
    snapshot.value = queue;
    inboxItems.value = inbox;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function togglePreview(item: InboxItem) {
  if (expandedId.value === item.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = item.id;
  const videoPath = item.artifacts?.video;
  if (videoPath && !previewUrls.value[item.id] && !videoPath.startsWith("http")) {
    try {
      previewUrls.value[item.id] = await getMooncut().mediaPreviewUrl(videoPath);
    } catch {
      /* leave empty */
    }
  }
}

async function revealArtifact(item: InboxItem) {
  const path = item.artifacts?.video;
  if (path) await getMooncut().revealArtifact(path);
}

const hasActive = computed(() => (snapshot.value?.active?.length ?? 0) > 0);
const hasRecent = computed(() => (snapshot.value?.recent?.length ?? 0) > 0);
const hasInbox = computed(() => inboxItems.value.length > 0);

onMounted(() => {
  void refresh();
  refreshTimer = window.setInterval(() => void refresh(true), 3000);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
</script>

<template>
  <div class="inbox-page">
    <div class="library-header">
      <h1>收件箱</h1>
      <div class="library-actions">
        <button type="button" class="ghost compact icon-only" title="刷新" :disabled="loading" @click="refresh()">
          <UiIcon name="refresh" :size="14" />
        </button>
      </div>
    </div>

    <div v-if="error && !snapshot" class="notice alert">{{ error }}</div>

    <!-- 摘要卡 -->
    <div v-if="snapshot" class="queue-stats">
      <article class="queue-stat-card">
        <small>运行中</small>
        <strong>{{ snapshot.summary.running }}</strong>
      </article>
      <article class="queue-stat-card">
        <small>排队中</small>
        <strong>{{ snapshot.summary.queued }}</strong>
      </article>
      <article class="queue-stat-card">
        <small>今日完成</small>
        <strong>{{ snapshot.summary.completedToday }}</strong>
      </article>
    </div>

    <!-- 当前运行队列 -->
    <section v-if="snapshot" class="queue-section">
      <span class="mini-label">当前运行队列</span>
      <div v-if="hasActive" class="queue-board">
        <div v-for="(item, index) in snapshot.active" :key="index" class="queue-item">
          <span class="queue-index">{{ String(index + 1).padStart(2, "0") }}</span>
          <div class="queue-item-body">
            <div class="queue-item-top">
              <strong>{{ item.name }}</strong>
              <span v-if="item.mine" class="queue-mine-tag">我的</span>
            </div>
            <span class="queue-stage">{{ stageLabel(item) }}</span>
            <div class="queue-progress">
              <i :style="{width: progressBarWidth(item)}" />
            </div>
          </div>
          <span class="queue-status">{{ statusLabel(item) }}</span>
        </div>
      </div>
      <div v-else class="queue-empty">制作线已就绪，暂无运行中的任务。</div>
    </section>

    <!-- 最近动态 -->
    <section v-if="snapshot && hasRecent" class="queue-section">
      <span class="mini-label">最近动态</span>
      <div class="queue-recent">
        <div v-for="(item, index) in snapshot.recent" :key="index" class="queue-recent-item">
          <UiIcon :name="item.status === 'completed' ? 'check' : 'media'" :size="14" />
          <span class="queue-recent-name">{{ item.name }}</span>
          <span class="queue-recent-meta">{{ stageLabel(item) }} · {{ formatTime(item.updatedAt) }}</span>
          <span v-if="item.mine" class="queue-mine-tag">我的</span>
        </div>
      </div>
    </section>

    <!-- 已完成成片列表 -->
    <section v-if="!loading && !hasInbox && !hasActive" class="empty-state compact-empty">
      <div class="empty-state-icon">
        <UiIcon name="empty" :size="20" />
      </div>
      <h3>还没有完成的成片</h3>
      <p>去「一键剪辑」或「剪辑台」完成一条剪辑后，成片会出现在这里。</p>
    </section>

    <section v-if="hasInbox" class="queue-section">
      <span class="mini-label">已完成成片</span>
      <div class="grid-cards">
        <article
          v-for="item in inboxItems"
          :key="item.id"
          class="card inbox-card"
          :class="{'is-expanded': expandedId === item.id}"
        >
          <div class="card-thumb" aria-hidden="true" @click="togglePreview(item)">
            <UiIcon name="media" :size="22" />
          </div>
          <div class="card-project-body">
            <div class="card-project-top">
              <h3>{{ item.title || '未命名成片' }}</h3>
              <div class="meta card-stats">
                <span class="inbox-source">{{ item.projectName }}</span>
                · {{ formatTime(item.updatedAt) }}
              </div>
            </div>
            <div v-if="expandedId === item.id" class="inbox-preview">
              <video
                v-if="previewUrls[item.id]"
                class="studio-preview-video"
                :src="previewUrls[item.id]"
                controls
                playsinline
              />
              <div v-else class="preview-fallback">预览加载中…</div>
            </div>
            <div class="actions">
              <button type="button" class="ghost compact" @click="togglePreview(item)">
                <UiIcon name="media" :size="13" />
                {{ expandedId === item.id ? '收起' : '预览' }}
              </button>
              <button type="button" class="primary compact" @click="revealArtifact(item)">
                <UiIcon name="folder" :size="13" />
                打开成片
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
