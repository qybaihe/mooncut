<script setup lang="ts">
/**
 * 收件箱 — 跨项目聚合所有已完成的剪辑成片，按完成时间倒序。
 * 每条可展开内联预览 + 打开成片位置。
 */
import {onMounted, ref} from "vue";
import {getMooncut} from "../composables/useMooncut";
import UiIcon from "./UiIcon.vue";
import type {InboxItem} from "@mooncut/studio-shared";

const items = ref<InboxItem[]>([]);
const loading = ref(false);
const error = ref("");
const expandedId = ref<string | null>(null);
const previewUrls = ref<Record<string, string>>({});

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function loadInbox() {
  loading.value = true;
  error.value = "";
  try {
    items.value = await getMooncut().listAllJobs();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载收件箱失败";
    items.value = [];
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

onMounted(() => loadInbox());
</script>

<template>
  <div class="inbox-page">
    <div class="library-header">
      <h1>收件箱</h1>
      <div class="library-actions">
        <button type="button" class="ghost compact icon-only" title="刷新" :disabled="loading" @click="loadInbox">
          <UiIcon name="refresh" :size="14" />
        </button>
      </div>
    </div>

    <div v-if="error" class="notice alert">{{ error }}</div>

    <div v-if="!loading && items.length === 0" class="empty-state compact-empty">
      <div class="empty-state-icon">
        <UiIcon name="empty" :size="20" />
      </div>
      <h3>还没有完成的成片</h3>
      <p>去「一键剪辑」或「剪辑台」完成一条剪辑后，成片会出现在这里。</p>
    </div>

    <div v-else class="grid-cards">
      <article
        v-for="item in items"
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
  </div>
</template>
