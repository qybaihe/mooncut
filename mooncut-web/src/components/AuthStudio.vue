<script setup lang="ts">
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Mail } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { destinationLabel, type AuthMode, type PostAuthIntent } from '../lib/navigation'
import { login, loginWithOtp, register, sendAuthOtp } from '../services/api'
import type { AuthUser } from '../types'
import BrandMark from './BrandMark.vue'

const props = defineProps<{
  initialMode?: AuthMode
  pendingDestination?: PostAuthIntent | null
}>()

const emit = defineEmits<{
  authenticated: [user: AuthUser]
  cancel: []
}>()

type LoginMethod = 'otp' | 'password'

const mode = ref<AuthMode>(props.initialMode ?? 'login')
const loginMethod = ref<LoginMethod>('otp')
const email = ref('')
const password = ref('')
const code = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const sendingOtp = ref(false)
const errorMessage = ref('')
const infoMessage = ref('')
const otpSent = ref(false)
const resendCooldown = ref(0)
const codeExpiresIn = ref(0)

let cooldownTimer: ReturnType<typeof setInterval> | null = null

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
const needsOtp = computed(() => mode.value === 'register' || loginMethod.value === 'otp')
const canSendOtp = computed(
  () =>
    Boolean(email.value.trim()) &&
    !sendingOtp.value &&
    !submitting.value &&
    resendCooldown.value <= 0,
)
const submitLabel = computed(() => {
  if (submitting.value) return '请稍候…'
  if (mode.value === 'register') return '验证并注册'
  if (loginMethod.value === 'otp') return '验证并登录'
  return '登录并继续'
})

watch(
  () => props.initialMode,
  (next) => {
    if (next) {
      mode.value = next
      errorMessage.value = ''
      infoMessage.value = ''
      code.value = ''
      otpSent.value = false
    }
  },
)

function clearTimers() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
}

function startCooldown(seconds: number) {
  clearTimers()
  resendCooldown.value = Math.max(0, Math.floor(seconds))
  codeExpiresIn.value = Math.max(codeExpiresIn.value, 0)
  cooldownTimer = setInterval(() => {
    if (resendCooldown.value > 0) resendCooldown.value -= 1
    if (codeExpiresIn.value > 0) codeExpiresIn.value -= 1
    if (resendCooldown.value <= 0 && codeExpiresIn.value <= 0) clearTimers()
  }, 1000)
}

function switchMode(next: AuthMode) {
  mode.value = next
  errorMessage.value = ''
  infoMessage.value = ''
  code.value = ''
  otpSent.value = false
  if (next === 'register') loginMethod.value = 'otp'
}

function switchLoginMethod(next: LoginMethod) {
  loginMethod.value = next
  errorMessage.value = ''
  infoMessage.value = ''
  code.value = ''
  if (next === 'password') otpSent.value = false
}

async function handleSendOtp() {
  if (!canSendOtp.value) return
  errorMessage.value = ''
  infoMessage.value = ''
  sendingOtp.value = true
  try {
    const purpose = mode.value === 'register' ? 'register' : 'login'
    const result = await sendAuthOtp(email.value.trim(), purpose)
    otpSent.value = true
    codeExpiresIn.value = result.expiresInSec
    startCooldown(result.resendAfterSec)
    infoMessage.value =
      mode.value === 'register'
        ? `验证码已发送到 ${result.email}，${Math.round(result.expiresInSec / 60)} 分钟内有效。`
        : `登录验证码已发送到 ${result.email}。`
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '验证码发送失败'
  } finally {
    sendingOtp.value = false
  }
}

async function submit() {
  if (submitting.value) return
  errorMessage.value = ''
  infoMessage.value = ''

  if (mode.value === 'register') {
    if (password.value.length < 8) {
      errorMessage.value = '密码至少需要 8 个字符'
      return
    }
    if (!/^\d{6}$/.test(code.value.trim())) {
      errorMessage.value = '请输入邮箱里的 6 位验证码'
      return
    }
  } else if (loginMethod.value === 'otp') {
    if (!/^\d{6}$/.test(code.value.trim())) {
      errorMessage.value = '请输入邮箱里的 6 位验证码'
      return
    }
  } else if (password.value.length < 8) {
    errorMessage.value = '密码至少需要 8 个字符'
    return
  }

  submitting.value = true
  try {
    let result: { user: AuthUser }
    if (mode.value === 'register') {
      result = await register(email.value.trim(), password.value, code.value.trim())
    } else if (loginMethod.value === 'otp') {
      result = await loginWithOtp(email.value.trim(), code.value.trim())
    } else {
      result = await login(email.value.trim(), password.value)
    }
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
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches === true
}

async function tryPlayAuthVideo() {
  const el = authVideoRef.value
  if (!el || !shouldRunAuthVideo.value) return
  try {
    el.muted = true
    el.defaultMuted = true
    await el.play()
  } catch {
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
  clearTimers()
  motionMedia?.removeEventListener?.('change', onMotionChange)
  widthMedia?.removeEventListener?.('change', onWidthChange)
})
</script>

<template>
  <main class="auth-shell">
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
          <li><span><Check :size="14" aria-hidden="true" /></span> 注册需邮箱验证码确认</li>
          <li><span><Check :size="14" aria-hidden="true" /></span> 支持验证码登录，也可密码登录</li>
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
          <p>
            {{
              mode === 'login'
                ? loginMethod === 'otp'
                  ? '用邮箱验证码安全登录。'
                  : '使用密码继续你的口播创作。'
                : '邮箱验证后即可开始创作。'
            }}
          </p>
        </div>
        <p v-if="intentHint" class="auth-intent" role="status">{{ intentHint }}</p>

        <div v-if="mode === 'login'" class="auth-method-toggle" role="group" aria-label="登录方式">
          <button
            type="button"
            :class="{ active: loginMethod === 'otp' }"
            @click="switchLoginMethod('otp')"
          >
            验证码登录
          </button>
          <button
            type="button"
            :class="{ active: loginMethod === 'password' }"
            @click="switchLoginMethod('password')"
          >
            密码登录
          </button>
        </div>

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

          <label v-if="mode === 'register' || loginMethod === 'password'">
            <span>{{ mode === 'register' ? '设置密码' : '密码' }}</span>
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
                :required="mode === 'register' || loginMethod === 'password'"
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

          <div v-if="needsOtp" class="auth-otp-block">
            <label>
              <span>邮箱验证码</span>
              <span class="auth-input-wrap auth-otp-wrap">
                <KeyRound :size="17" aria-hidden="true" />
                <input
                  v-model.trim="code"
                  name="otp"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="6 位数字"
                  maxlength="6"
                  pattern="[0-9]{6}"
                  :required="needsOtp"
                >
                <button
                  class="auth-otp-send"
                  type="button"
                  :disabled="!canSendOtp"
                  @click="handleSendOtp"
                >
                  <LoaderCircle v-if="sendingOtp" class="auth-spinner" :size="15" aria-hidden="true" />
                  <template v-else-if="resendCooldown > 0">{{ resendCooldown }}s 后重发</template>
                  <template v-else-if="otpSent">重新发送</template>
                  <template v-else>获取验证码</template>
                </button>
              </span>
            </label>
            <p v-if="otpSent && codeExpiresIn > 0" class="auth-otp-hint">
              验证码约 {{ Math.ceil(codeExpiresIn / 60) }} 分钟内有效
            </p>
          </div>

          <p v-if="infoMessage" class="auth-info" role="status">{{ infoMessage }}</p>
          <p v-if="errorMessage" class="auth-error" role="alert">{{ errorMessage }}</p>
          <button class="auth-submit" type="submit" :disabled="submitting || sendingOtp">
            <LoaderCircle v-if="submitting" class="auth-spinner" :size="17" aria-hidden="true" />
            {{ submitLabel }}
          </button>
        </form>
        <p class="auth-no-verify">
          {{
            mode === 'register'
              ? '注册前会向邮箱发送验证码，确认邮箱归属后再创建账户。'
              : '验证码由 Resend 发送；也可切换到密码登录。'
          }}
        </p>
        <button class="auth-cancel-link" type="button" @click="emit('cancel')">先看看产品介绍</button>
      </div>
    </section>
  </main>
</template>
