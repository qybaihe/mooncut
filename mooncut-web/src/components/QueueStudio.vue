<script setup lang="ts">
import { Activity, CheckCircle2, Clock3, Layers3, LoaderCircle, RefreshCw, Sparkles, Zap } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getRenderQueue } from '../services/api'
import type { RenderQueueItem, RenderQueueSnapshot } from '../types'

const emit = defineEmits<{ create: [] }>()

const snapshot = ref<RenderQueueSnapshot | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const errorMessage = ref('')
let refreshTimer: number | null = null

const stageLabels: Record<string, string> = {
  queued: '等待进入制作线',
  'preparing-source': '整理源视频',
  'inspecting-source': '读取画面',
  transcribing: '识别口播内容',
  'scheduling-visuals': '安排视觉素材',
  'tracking-speaker': '跟踪人物镜头',
  'planning-edit': '规划剪辑节奏',
  rendering: '渲染成片',
  verifying: '检查最终画面',
  completed: '成片已完成',
  failed: '任务需要重试',
  interrupted: '任务已中断',
}

const activeCount = computed(() => (snapshot.value?.summary.running ?? 0) + (snapshot.value?.summary.queued ?? 0))

function stageLabel(item: RenderQueueItem) {
  return stageLabels[item.stage] ?? (item.status === 'running' ? '正在制作' : item.status === 'queued' ? '排队等待' : item.status === 'completed' ? '成片已完成' : '任务需要重试')
}

function statusLabel(item: RenderQueueItem) {
  if (item.status === 'running') return `${Math.round(item.progress * 100)}%`
  if (item.status === 'queued') return item.queuePosition === 1 ? '即将开始' : `前方 ${Math.max(0, (item.queuePosition ?? 1) - 1)} 个任务`
  return item.status === 'completed' ? '已完成' : '未完成'
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

async function refresh(silent = false) {
  if (refreshing.value) return
  refreshing.value = true
  if (!silent) loading.value = !snapshot.value
  try {
    snapshot.value = await getRenderQueue()
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '运行队列暂时不可用'
  } finally {
    refreshing.value = false
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  refreshTimer = window.setInterval(() => void refresh(true), 3_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

<template>
  <section class="workspace-page queue-page">
    <div class="queue-hero reveal">
      <div>
        <span class="eyebrow"><Activity :size="15" /> 实时制作线</span>
        <h1>MoonCut 正在开工。</h1>
        <p>每条口播都有自己的位置。名字经过匿名化处理，只展示制作状态，不公开用户和文件信息。</p>
      </div>
      <div class="queue-live-badge" :class="{ idle: activeCount === 0 }">
        <span /> {{ activeCount ? `${activeCount} 个任务正在流转` : '制作线已就绪' }}
      </div>
    </div>

    <div v-if="loading" class="queue-loading" role="status"><LoaderCircle :size="24" /> 正在读取制作线…</div>
    <div v-else-if="errorMessage && !snapshot" class="queue-error" role="alert">
      <strong>暂时没有读到运行队列</strong><p>{{ errorMessage }}</p>
      <button type="button" @click="refresh()"><RefreshCw :size="15" /> 重新加载</button>
    </div>
    <template v-else-if="snapshot">
      <div class="queue-stats reveal reveal-delay">
        <article><span><Zap :size="17" /></span><div><small>运行中</small><strong>{{ snapshot.summary.running }}</strong></div><em>正在制作</em></article>
        <article><span><Layers3 :size="17" /></span><div><small>排队中</small><strong>{{ snapshot.summary.queued }}</strong></div><em>按顺序进入</em></article>
        <article><span><CheckCircle2 :size="17" /></span><div><small>今日完成</small><strong>{{ snapshot.summary.completedToday }}</strong></div><em>持续交付</em></article>
      </div>

      <div class="queue-grid reveal reveal-delay">
        <section class="queue-board">
          <div class="queue-section-head">
            <div><span class="mini-label">当前运行队列</span><h2>正在发生的创作</h2></div>
            <button type="button" aria-label="刷新运行队列" :disabled="refreshing" @click="refresh()"><RefreshCw :size="15" :class="{ spinning: refreshing }" /> {{ formatTime(snapshot.updatedAt) }} 更新</button>
          </div>
          <div v-if="snapshot.active.length" class="queue-list">
            <article v-for="(item, index) in snapshot.active" :key="`${item.name}-${item.createdAt}`" class="queue-row" :class="`is-${item.status}`">
              <span class="queue-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="queue-task-copy">
                <div><strong>{{ item.name }}</strong><em v-if="item.mine">我的任务</em></div>
                <span>{{ stageLabel(item) }}</span>
                <div class="queue-progress"><i :style="{ width: `${item.status === 'queued' ? 4 : Math.max(4, Math.round(item.progress * 100))}%` }" /></div>
              </div>
              <div class="queue-state"><small>{{ item.status === 'running' ? '运行中' : '排队中' }}</small><strong>{{ statusLabel(item) }}</strong></div>
            </article>
          </div>
          <div v-else class="queue-empty">
            <span><Sparkles :size="21" /></span><strong>制作线现在很轻松</strong><p>成为下一条正在生长的口播吧。</p>
            <button type="button" @click="emit('create')">开始一条新口播</button>
          </div>
        </section>

        <aside class="queue-recent">
          <div class="queue-section-head"><div><span class="mini-label">最近动态</span><h2>刚刚完成</h2></div></div>
          <div v-if="snapshot.recent.length" class="recent-list">
            <article v-for="item in snapshot.recent" :key="`${item.name}-${item.updatedAt}`">
              <span :class="{ failed: item.status === 'failed' }"><CheckCircle2 v-if="item.status === 'completed'" :size="15" /><Clock3 v-else :size="15" /></span>
              <div><strong>{{ item.name }}</strong><small>{{ stageLabel(item) }} · {{ formatTime(item.updatedAt) }}</small></div>
              <em v-if="item.mine">我的</em>
            </article>
          </div>
          <div v-else class="recent-empty">第一条完成记录会出现在这里。</div>
        </aside>
      </div>
    </template>
  </section>
</template>
