<script setup lang="ts">
import { ArrowLeft, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { destinationLabel, type AuthMode, type WorkspaceDestination } from '../lib/navigation'
import { login, register } from '../services/api'
import type { AuthUser } from '../types'
import BrandMark from './BrandMark.vue'

const props = defineProps<{
  initialMode?: AuthMode
  pendingDestination?: WorkspaceDestination | null
}>()

const emit = defineEmits<{
  authenticated: [user: AuthUser]
  cancel: []
}>()

const mode = ref<AuthMode>(props.initialMode ?? 'login')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref('')

/** Atmosphere media: video only on capable desktop with motion allowed. */
const prefersReducedMotion = ref(
  typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
)
const isNarrowViewport = ref(
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches === true,
)
const authVideoRef = ref<HTMLVideoElement | null>(null)
const videoReady = ref(false)
const videoFailed = ref(false)

let motionMedia: MediaQueryList | null = null
let widthMedia: MediaQueryList | null = null

const shouldRunAuthVideo = computed(
  () => !prefersReducedMotion.value && !isNarrowViewport.value && !videoFailed.value,
)

const title = computed(() => (mode.value === 'login' ? '欢迎回来' : '创建 MoonCut 账户'))
const intentHint = computed(() => destinationLabel(props.pendingDestination, mode.value))

watch(
  () => props.initialMode,
  (next) => {
    if (next) {
      mode.value = next
      errorMessage.value = ''
    }
  },
)

function switchMode(next: AuthMode) {
  mode.value = next
  errorMessage.value = ''
}

async function submit() {
  if (submitting.value) return
  errorMessage.value = ''
  if (password.value.length < 8) {
    errorMessage.value = '密码至少需要 8 个字符'
    return
  }
  submitting.value = true
  try {
    const result =
      mode.value === 'register'
        ? await register(email.value, password.value)
        : await login(email.value, password.value)
    emit('authenticated', result.user)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '操作失败，请稍后再试'
  } finally {
    submitting.value = false
  }
}

function updateMotionPreference() {
  prefersReducedMotion.value =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function updateViewport() {
  isNarrowViewport.value =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(max-width: 720px)').matches === true
}

async function tryPlayAuthVideo() {
  const el = authVideoRef.value
  if (!el || !shouldRunAuthVideo.value) return
  try {
    el.muted = true
    el.defaultMuted = true
    await el.play()
  } catch {
    // Autoplay blocked or decode failure — poster remains visible.
    videoFailed.value = true
  }
}

function pauseAuthVideo() {
  const el = authVideoRef.value
  if (el && !el.paused) el.pause()
}

function onMotionChange() {
  updateMotionPreference()
  if (prefersReducedMotion.value) pauseAuthVideo()
  else void tryPlayAuthVideo()
}

function onWidthChange() {
  updateViewport()
  if (isNarrowViewport.value) pauseAuthVideo()
  else void tryPlayAuthVideo()
}

function onVideoCanPlay() {
  videoReady.value = true
  void tryPlayAuthVideo()
}

function onVideoError() {
  videoFailed.value = true
}

onMounted(() => {
  updateMotionPreference()
  updateViewport()

  if (typeof window !== 'undefined' && window.matchMedia) {
    motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
    motionMedia.addEventListener?.('change', onMotionChange)

    widthMedia = window.matchMedia('(max-width: 720px)')
    widthMedia.addEventListener?.('change', onWidthChange)
  }

  void tryPlayAuthVideo()
})

onBeforeUnmount(() => {
  pauseAuthVideo()
  motionMedia?.removeEventListener?.('change', onMotionChange)
  widthMedia?.removeEventListener?.('change', onWidthChange)
})
</script>

<template>
  <main class="auth-shell">
    <!-- Abstract creative-ignition atmosphere — not product narrative about the visual. -->
    <div class="auth-atmosphere" aria-hidden="true">
      <div
        class="auth-poster"
        :class="{ 'is-dimmed': videoReady && shouldRunAuthVideo }"
      />
      <video
        v-if="shouldRunAuthVideo"
        ref="authVideoRef"
        class="auth-video"
        :class="{ 'is-ready': videoReady }"
        muted
        loop
        playsinline
        preload="metadata"
        poster="/landing/hero-poster.png"
        @canplay="onVideoCanPlay"
        @error="onVideoError"
      >
        <source src="/landing/hero-ignition.mp4" type="video/mp4">
      </video>
      <div class="auth-contrast" />
      <div class="auth-grain" />
    </div>

    <header class="auth-topbar">
      <button class="auth-back" type="button" aria-label="返回首页" @click="emit('cancel')">
        <ArrowLeft :size="16" aria-hidden="true" />
        <span class="auth-back-label">返回首页</span>
      </button>
      <button class="auth-brand-button" type="button" aria-label="返回 MoonCut 首页" @click="emit('cancel')">
        <BrandMark />
      </button>
      <span class="auth-topbar-spacer" aria-hidden="true" />
    </header>

    <section class="auth-layout" aria-labelledby="auth-title">
      <div class="auth-story">
        <span class="auth-kicker">口播创作工作台</span>
        <h1>先把想法说清楚，<br>再安心录下来。</h1>
        <p>从脚本、提词录制到剪辑导出，登录只为保存你的任务与素材。</p>
        <ul>
          <li><span><Check :size="14" aria-hidden="true" /></span> 邮箱与密码即可开始</li>
          <li><span><Check :size="14" aria-hidden="true" /></span> 注册后立即进入，无需邮箱验证</li>
          <li><span><Check :size="14" aria-hidden="true" /></span> 素材与剪辑任务按账户隔离</li>
        </ul>
      </div>

      <div class="auth-card">
        <div class="auth-tabs" role="tablist" aria-label="账户操作">
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'login'"
            :class="{ active: mode === 'login' }"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'register'"
            :class="{ active: mode === 'register' }"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>
        <div class="auth-card-heading">
          <h2 id="auth-title">{{ title }}</h2>
          <p>{{ mode === 'login' ? '继续你的口播创作。' : '两个信息，就能开始创作。' }}</p>
        </div>
        <p v-if="intentHint" class="auth-intent" role="status">{{ intentHint }}</p>
        <form class="auth-form" @submit.prevent="submit">
          <label>
            <span>邮箱</span>
            <span class="auth-input-wrap">
              <Mail :size="17" aria-hidden="true" />
              <input
                v-model.trim="email"
                name="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                maxlength="254"
                required
              >
            </span>
          </label>
          <label>
            <span>密码</span>
            <span class="auth-input-wrap">
              <LockKeyhole :size="17" aria-hidden="true" />
              <input
                v-model="password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                placeholder="至少 8 个字符"
                minlength="8"
                maxlength="128"
                required
              >
              <button
                class="password-toggle"
                type="button"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" :size="17" />
                <Eye v-else :size="17" />
              </button>
            </span>
          </label>
          <p v-if="errorMessage" class="auth-error" role="alert">{{ errorMessage }}</p>
          <button class="auth-submit" type="submit" :disabled="submitting">
            <LoaderCircle v-if="submitting" class="auth-spinner" :size="17" aria-hidden="true" />
            {{ submitting ? '请稍候…' : mode === 'login' ? '登录并继续' : '注册并继续' }}
          </button>
        </form>
        <p class="auth-no-verify">注册无需邮箱验证。可随时返回首页继续了解产品。</p>
        <button class="auth-cancel-link" type="button" @click="emit('cancel')">先看看产品介绍</button>
      </div>
    </section>
  </main>
</template>
