<script setup lang="ts">
import { ArrowRight, Clock3, LoaderCircle, Play, RefreshCw, Sparkles, UsersRound, X } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { listCommunityPosts } from '../services/api'
import type { CommunityPost } from '../types'

const emit = defineEmits<{
  create: []
  'pet-message': [message: string]
}>()

const posts = ref<CommunityPost[]>([])
const nextCursor = ref<string | undefined>()
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const selectedPost = ref<CommunityPost | null>(null)

function durationLabel(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function dateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

async function load(reset = true) {
  if (reset) {
    loading.value = true
    error.value = ''
  } else {
    loadingMore.value = true
  }
  try {
    const page = await listCommunityPosts(reset ? undefined : nextCursor.value)
    posts.value = reset ? page.items : [...posts.value, ...page.items]
    nextCursor.value = page.nextCursor
    if (reset && page.items.length) emit('pet-message', '社区里有新的口播作品，一起看看别人怎么讲吧！')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '社区暂时没有连上'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function openPost(post: CommunityPost) {
  selectedPost.value = post
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') selectedPost.value = null
}

function handlePublished() {
  void load(true)
}

onMounted(() => {
  void load(true)
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('mooncut:community-published', handlePublished)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape)
  window.removeEventListener('mooncut:community-published', handlePublished)
})
</script>

<template>
  <section class="workspace-page community-page">
    <div class="community-heading reveal">
      <div>
        <span class="eyebrow"><UsersRound :size="15" /> MoonCut 社区</span>
        <h1>看看别人，怎么把话说出来。</h1>
        <p>这里都是创作者主动分享的真实口播成片。找到表达灵感，也欢迎把你的作品放进来。</p>
      </div>
      <button class="community-refresh" type="button" :disabled="loading" @click="load(true)">
        <RefreshCw :size="16" :class="{ 'is-spinning': loading }" /> 刷新
      </button>
    </div>

    <div class="community-trust-strip reveal reveal-delay">
      <span><Sparkles :size="16" /> 只展示用户主动发布的成片</span>
      <i />
      <span>视频仍由 MoonCut 任务服务托管</span>
    </div>

    <div v-if="loading" class="community-loading" role="status">
      <LoaderCircle :size="24" class="is-spinning" />
      <strong>正在打开社区…</strong>
    </div>

    <div v-else-if="error" class="community-empty" role="alert">
      <span><RefreshCw :size="25" /></span>
      <h2>社区暂时没有连上</h2>
      <p>{{ error }}</p>
      <button class="secondary-button" type="button" @click="load(true)">再试一次</button>
    </div>

    <div v-else-if="!posts.length" class="community-empty reveal">
      <span><UsersRound :size="28" /></span>
      <h2>还没有人发布作品</h2>
      <p>历史成片不会被自动公开。完成一条新口播后，由你亲自选择是否分享到这里。</p>
      <button class="primary-button" type="button" @click="emit('create')">去创作第一条 <ArrowRight :size="17" /></button>
    </div>

    <template v-else>
      <div class="community-grid reveal">
        <article v-for="post in posts" :key="post.id" class="community-card">
          <button class="community-poster" type="button" :aria-label="`播放 ${post.title}`" @click="openPost(post)">
            <img v-if="post.posterUrl" :src="post.posterUrl" :alt="`${post.title} 视频预览`">
            <span v-else class="community-poster-fallback"><Sparkles :size="28" /></span>
            <i class="community-play"><Play :size="20" fill="currentColor" /></i>
            <small><Clock3 :size="12" /> {{ durationLabel(post.durationMs) }}</small>
          </button>
          <div class="community-card-body">
            <div class="community-author">
              <span>{{ post.authorName.slice(0, 1).toUpperCase() }}</span>
              <strong>{{ post.authorName }}</strong>
              <time :datetime="post.createdAt">{{ dateLabel(post.createdAt) }}</time>
            </div>
            <h2>{{ post.title }}</h2>
            <p>{{ post.caption || '创作者分享了一条 MoonCut 口播成片。' }}</p>
          </div>
        </article>
      </div>
      <button v-if="nextCursor" class="community-load-more" type="button" :disabled="loadingMore" @click="load(false)">
        <LoaderCircle v-if="loadingMore" :size="16" class="is-spinning" />
        {{ loadingMore ? '加载中…' : '查看更多作品' }}
      </button>
    </template>

    <div v-if="selectedPost" class="community-player-backdrop" role="presentation" @click.self="selectedPost = null">
      <section class="community-player" role="dialog" aria-modal="true" :aria-label="selectedPost.title">
        <button class="community-player-close" type="button" aria-label="关闭视频" @click="selectedPost = null"><X :size="18" /></button>
        <video :src="selectedPost.videoUrl" :poster="selectedPost.posterUrl" controls autoplay playsinline preload="metadata" />
        <div>
          <span>{{ selectedPost.authorName }}</span>
          <h2>{{ selectedPost.title }}</h2>
          <p>{{ selectedPost.caption || '创作者分享了一条 MoonCut 口播成片。' }}</p>
        </div>
      </section>
    </div>
  </section>
</template>
