<script setup lang="ts">
import { ArrowRight, Clock3, LoaderCircle, LogIn, Play, RefreshCw, Sparkles, UsersRound, X } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { listCommunityPosts } from '../services/api'
import type { CommunityPost } from '../types'
import BrandMark from './BrandMark.vue'

defineProps<{ signedIn: boolean }>()
const emit = defineEmits<{
  home: []
  'open-auth': []
  create: []
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

async function loadPosts(reset = true) {
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
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '社区暂时没有连上'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') selectedPost.value = null
}

function handlePublished() {
  void loadPosts()
}

onMounted(() => {
  void loadPosts()
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('mooncut:community-published', handlePublished)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape)
  window.removeEventListener('mooncut:community-published', handlePublished)
})
</script>

<template>
  <section class="public-community-page community-page">
    <header v-if="!signedIn" class="public-community-nav">
      <button class="brand-home-button" type="button" aria-label="返回 MoonCut 首页" @click="emit('home')">
        <BrandMark />
      </button>
      <nav aria-label="公开导航">
        <button type="button" @click="emit('home')">首页</button>
        <button class="is-active" type="button" aria-current="page">社区</button>
      </nav>
      <div>
        <button class="public-community-login" type="button" @click="emit('open-auth')"><LogIn :size="15" /> 登录</button>
        <button class="public-community-create" type="button" @click="emit('create')">开始创作 <ArrowRight :size="15" /></button>
      </div>
    </header>

    <div class="public-community-content workspace-page">
      <div class="community-heading reveal">
        <div>
          <span class="eyebrow"><UsersRound :size="15" /> MoonCut 社区</span>
          <h1>看看别人，<br>怎么把话说出来。</h1>
          <p>创作者主动分享的真实口播成片。无需登录，先来找找灵感。</p>
        </div>
        <button class="community-refresh" type="button" :disabled="loading" @click="loadPosts(true)">
          <RefreshCw :size="16" :class="{ 'is-spinning': loading }" /> 刷新作品
        </button>
      </div>

      <div class="community-trust-strip reveal">
        <span><UsersRound :size="16" /> 仅展示创作者主动分享的真实成片</span><i /><span>浏览和播放无需登录</span>
      </div>

      <div v-if="loading" class="community-loading" role="status"><LoaderCircle :size="24" class="is-spinning" /><strong>正在打开社区…</strong></div>
      <div v-else-if="error" class="community-empty" role="alert"><span><RefreshCw :size="25" /></span><h2>社区暂时没有连上</h2><p>{{ error }}</p><button class="secondary-button" type="button" @click="loadPosts(true)">再试一次</button></div>
      <div v-else-if="!posts.length" class="community-empty reveal"><span><UsersRound :size="28" /></span><h2>社区还没有作品</h2><p>完成一条新口播后，创作者可以选择主动分享到这里。</p><button class="primary-button" type="button" @click="emit('create')">去创作第一条 <ArrowRight :size="17" /></button></div>
      <template v-else>
        <div class="community-grid reveal">
          <article v-for="post in posts" :key="post.id" class="community-card">
            <button class="community-poster" type="button" :aria-label="`播放 ${post.title}`" @click="selectedPost = post">
              <img v-if="post.posterUrl" :src="post.posterUrl" :alt="`${post.title} 视频预览`">
              <span v-else class="community-poster-fallback"><Sparkles :size="28" /></span>
              <i class="community-play"><Play :size="20" fill="currentColor" /></i>
              <small><Clock3 :size="12" /> {{ durationLabel(post.durationMs) }}</small>
            </button>
            <div class="community-card-body">
              <div class="community-author"><span>{{ post.authorName.slice(0, 1).toUpperCase() }}</span><strong>{{ post.authorName }}</strong><time :datetime="post.createdAt">{{ dateLabel(post.createdAt) }}</time></div>
              <h2>{{ post.title }}</h2>
              <p>{{ post.caption || '创作者分享了一条 MoonCut 口播成片。' }}</p>
            </div>
          </article>
        </div>
        <button v-if="nextCursor" class="community-load-more" type="button" :disabled="loadingMore" @click="loadPosts(false)"><LoaderCircle v-if="loadingMore" :size="16" class="is-spinning" />{{ loadingMore ? '加载中…' : '查看更多作品' }}</button>
      </template>
    </div>

    <div v-if="selectedPost" class="community-player-backdrop" role="presentation" @click.self="selectedPost = null">
      <section class="community-player" role="dialog" aria-modal="true" :aria-label="selectedPost.title">
        <button class="community-player-close" type="button" aria-label="关闭视频" @click="selectedPost = null"><X :size="18" /></button>
        <video :src="selectedPost.videoUrl" :poster="selectedPost.posterUrl" controls autoplay playsinline preload="metadata" />
        <div><span>{{ selectedPost.authorName }}</span><h2>{{ selectedPost.title }}</h2><p>{{ selectedPost.caption || '创作者分享了一条 MoonCut 口播成片。' }}</p></div>
      </section>
    </div>
  </section>
</template>
