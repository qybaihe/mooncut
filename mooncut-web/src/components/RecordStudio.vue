<script setup lang="ts">
import {
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  Circle,
  Copy,
  Gauge,
  Heart,
  Lightbulb,
  LoaderCircle,
  MessageCircleMore,
  Mic2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Send,
  Sparkles,
  Square,
  TimerReset,
  Type,
  Video,
  WandSparkles,
  Zap,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { VideoAsset } from '../types'
import ToastMessage from './ToastMessage.vue'

type StudioMode = 'compose' | 'teleprompter' | 'review'
type RecordState = 'idle' | 'countdown' | 'recording' | 'paused'
type CameraStatus = 'requesting' | 'live' | 'fallback'
type ChatMessage = { id: number; role: 'assistant' | 'user'; content: string }

const emit = defineEmits<{
  'send-to-edit': [asset: VideoAsset]
  'mode-change': [mode: StudioMode]
}>()

const quickTopics = ['讲一个知识点', '做产品介绍', '分享个人经历', '表达一个观点']
const suggestionOptions = [
  { eyebrow: '开头钩子', title: '先说一个常见误区', detail: '“不是你没内容，而是开头给得太慢。”', icon: Zap },
  { eyebrow: '中段支撑', title: '加入一个具体场景', detail: '让观众立刻联想到自己经历过的时刻。', icon: Lightbulb },
  { eyebrow: '结尾动作', title: '给一个马上能做的动作', detail: '把观点变成一句可执行的小建议。', icon: ArrowRight },
]

const defaultDraft = `很多人第一次做口播，总觉得自己没内容。

但真正的问题，往往不是没内容，而是开头给得太慢。观众刷到你的前三秒，还不知道这条视频和自己有什么关系，自然就划走了。

你可以试试一个很简单的方法：先说结果，再解释原因。比如不要从“今天想和大家聊聊”开始，直接说“如果你的口播总没人看，先检查开头这句话”。

下一条视频，先把开场白删掉，只留下观众最想知道的那一句。你会发现，表达不需要更用力，只需要更快地抵达重点。`

const initialMessage: ChatMessage = {
  id: 1,
  role: 'assistant',
  content: '先告诉我：这条口播，你最想让观众记住什么？我会陪你把想法一步步变成能直接念的稿子。',
}

function loadMessages(): ChatMessage[] {
  try {
    const stored = JSON.parse(localStorage.getItem('mooncut:messages') ?? 'null')
    return Array.isArray(stored) && stored.length ? stored : [initialMessage]
  } catch {
    return [initialMessage]
  }
}

const mode = ref<StudioMode>('compose')
const mobilePanel = ref<'chat' | 'draft'>('chat')
const messages = ref<ChatMessage[]>(loadMessages())
const input = ref('')
const topic = ref('为什么口播开头 3 秒很重要')
const isThinking = ref(false)
const selectedSuggestions = ref(new Set([0, 1, 2]))
const draft = ref(localStorage.getItem('mooncut:draft') || defaultDraft)
const toast = ref('')
const cameraStatus = ref<CameraStatus>('requesting')
const recordState = ref<RecordState>('idle')
const countdown = ref<number | null>(null)
const elapsed = ref(0)
const fontSize = ref(34)
const scrollSpeed = ref(3)
const mirror = ref(true)
const reviewUrl = ref<string | null>(null)
const recordedMime = ref('video/webm')

const chatEndRef = ref<HTMLDivElement | null>(null)
const cameraVideoRef = ref<HTMLVideoElement | null>(null)
let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let countdownTimer: number | null = null
let elapsedTimer: number | null = null
let toastTimer: number | null = null
let assistantTimer: number | null = null
let cameraTimeout: number | null = null
let cameraRequestId = 0
let reviewAfterStop = true
let handedOff = false

const characterCount = computed(() => draft.value.replace(/\s/g, '').length)
const estimatedSeconds = computed(() => Math.max(20, Math.round(characterCount.value / 4.1)))
const sentences = computed(() => draft.value.split(/(?<=[。！？])/).map((sentence) => sentence.trim()).filter(Boolean))
const currentSentence = computed(() => {
  if (!sentences.value.length) return 0
  return Math.min(sentences.value.length - 1, Math.floor(elapsed.value / Math.max(3, 9 - scrollSpeed.value)))
})
const recordingExtension = computed(() => recordedMime.value.includes('mp4') ? 'mp4' : 'webm')

watch(draft, (value) => localStorage.setItem('mooncut:draft', value))
watch(messages, (value) => localStorage.setItem('mooncut:messages', JSON.stringify(value)), { deep: true })
watch(mode, (value) => emit('mode-change', value), { immediate: true })
watch([messages, isThinking], async () => {
  await nextTick()
  chatEndRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})
watch(toast, (message) => {
  if (toastTimer) window.clearTimeout(toastTimer)
  if (message) toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
})

function secondsToClock(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const rest = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}

function stopCamera() {
  cameraRequestId += 1
  if (cameraTimeout) window.clearTimeout(cameraTimeout)
  cameraTimeout = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  if (cameraVideoRef.value) cameraVideoRef.value.srcObject = null
}

async function openCamera() {
  const requestId = ++cameraRequestId
  cameraStatus.value = 'requesting'
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.value = 'fallback'
    return
  }
  cameraTimeout = window.setTimeout(() => {
    if (requestId === cameraRequestId && cameraStatus.value === 'requesting') {
      cameraRequestId += 1
      cameraStatus.value = 'fallback'
    }
  }, 3200)
  try {
    const requestedStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
    if (requestId !== cameraRequestId) {
      requestedStream.getTracks().forEach((track) => track.stop())
      return
    }
    if (cameraTimeout) window.clearTimeout(cameraTimeout)
    cameraTimeout = null
    stream = requestedStream
    cameraStatus.value = 'live'
    await nextTick()
    if (cameraVideoRef.value) cameraVideoRef.value.srcObject = stream
  } catch {
    if (requestId === cameraRequestId) cameraStatus.value = 'fallback'
  }
}

function sendMessage(preset?: string) {
  const content = (preset ?? input.value).trim()
  if (!content || isThinking.value) return
  messages.value.push({ id: Date.now(), role: 'user', content })
  input.value = ''
  topic.value = content
  isThinking.value = true
  if (assistantTimer) window.clearTimeout(assistantTimer)
  if (cameraTimeout) window.clearTimeout(cameraTimeout)
  assistantTimer = window.setTimeout(() => {
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      content: '这个主题可以讲得很具体。我建议用“一个误区 + 一个场景 + 一个动作”来组织，观众会更容易听进去。下面三个角度都可以直接加进稿子。',
    })
    isThinking.value = false
  }, 720)
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    sendMessage()
  }
}

function toggleSuggestion(index: number) {
  const next = new Set(selectedSuggestions.value)
  next.has(index) ? next.delete(index) : next.add(index)
  selectedSuggestions.value = next
}

function applySuggestions() {
  const subject = topic.value.length > 42 ? `${topic.value.slice(0, 42)}…` : topic.value
  const hook = selectedSuggestions.value.has(0)
    ? `很多人聊到“${subject}”，第一反应是把背景讲清楚。但真正让观众留下来的，往往不是背景，而是你能不能在前三秒说到他心里。`
    : `今天想和你聊聊“${subject}”。`
  const scene = selectedSuggestions.value.has(1)
    ? `\n\n想象一下：你认真录了十分钟，信息都很有用，可观众刚听到“大家好，今天想跟大家分享一下”，就已经划走了。不是内容不好，而是重点出现得太晚。`
    : ''
  const action = selectedSuggestions.value.has(2)
    ? `\n\n下一条视频，先把开场白删掉，把最想让观众记住的那句话放到第一句。先说结果，再解释原因。你会发现，表达不需要更用力，只需要更快地抵达重点。`
    : ''
  draft.value = `${hook}${scene}\n\n所以，一个好口播不一定要讲得更多，而是要更早让观众知道：这件事为什么和他有关。${action}`
  mobilePanel.value = 'draft'
  toast.value = '建议已整理进完整口播稿'
}

function polishDraft(style: 'oral' | 'short' | 'emotional') {
  if (style === 'oral') {
    draft.value = draft.value.replaceAll('因此', '所以').replaceAll('但是', '但').replaceAll('我们可以', '你可以')
    toast.value = '已调得更像你在自然说话'
  } else if (style === 'short') {
    const parts = draft.value.match(/[^。！？]+[。！？]?/g) ?? [draft.value]
    draft.value = parts.filter((_, index) => index !== 2 && index !== 5).slice(0, 8).join('').trim()
    toast.value = '已删掉重复信息，保留核心表达'
  } else {
    if (!draft.value.startsWith('先别急着划走。')) draft.value = `先别急着划走。\n\n${draft.value}`
    toast.value = '开头的情绪张力已加强'
  }
}

async function enterTeleprompter() {
  elapsed.value = 0
  recordState.value = 'idle'
  mode.value = 'teleprompter'
  await nextTick()
  await openCamera()
}

function selectMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

function startElapsedTimer() {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  elapsedTimer = window.setInterval(() => (elapsed.value += 1), 1000)
}

function stopElapsedTimer() {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  elapsedTimer = null
}

function beginRecording() {
  chunks = []
  reviewAfterStop = true
  if (stream && typeof MediaRecorder !== 'undefined') {
    try {
      const mimeType = selectMimeType()
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recordedMime.value = recorder.mimeType || mimeType || 'video/webm'
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        cameraStatus.value = 'fallback'
      }
      recorder.onstop = () => {
        stopElapsedTimer()
        if (reviewAfterStop && chunks.length) {
          if (reviewUrl.value && !handedOff) URL.revokeObjectURL(reviewUrl.value)
          const blob = new Blob(chunks, { type: recordedMime.value })
          reviewUrl.value = URL.createObjectURL(blob)
        }
        stopCamera()
        recordState.value = 'idle'
        mode.value = reviewAfterStop ? 'review' : 'compose'
        recorder = null
      }
      recorder.start(250)
    } catch {
      recorder = null
      cameraStatus.value = 'fallback'
    }
  }
  countdown.value = null
  recordState.value = 'recording'
  startElapsedTimer()
}

function tickCountdown() {
  if (countdown.value === null) return
  if (countdown.value <= 0) {
    beginRecording()
    return
  }
  countdownTimer = window.setTimeout(() => {
    if (countdown.value !== null) countdown.value -= 1
    tickCountdown()
  }, 850)
}

function startRecording() {
  elapsed.value = 0
  countdown.value = 3
  recordState.value = 'countdown'
  tickCountdown()
}

function pauseRecording() {
  if (recordState.value === 'recording') {
    if (recorder?.state === 'recording') recorder.pause()
    stopElapsedTimer()
    recordState.value = 'paused'
  } else if (recordState.value === 'paused') {
    if (recorder?.state === 'paused') recorder.resume()
    startElapsedTimer()
    recordState.value = 'recording'
  }
}

function finishRecording() {
  reviewAfterStop = true
  stopElapsedTimer()
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  else {
    stopCamera()
    recordState.value = 'idle'
    mode.value = 'review'
  }
}

function leaveTeleprompter() {
  if (countdownTimer) window.clearTimeout(countdownTimer)
  countdownTimer = null
  countdown.value = null
  stopElapsedTimer()
  reviewAfterStop = false
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  else {
    stopCamera()
    recordState.value = 'idle'
    mode.value = 'compose'
  }
}

async function rerecord() {
  if (reviewUrl.value && !handedOff) URL.revokeObjectURL(reviewUrl.value)
  reviewUrl.value = null
  handedOff = false
  elapsed.value = 0
  recordState.value = 'idle'
  mode.value = 'teleprompter'
  await nextTick()
  await openCamera()
}

function handoffToEdit() {
  const url = reviewUrl.value ?? undefined
  handedOff = true
  emit('send-to-edit', {
    name: `刚刚录制的口播.${recordingExtension.value}`,
    sizeLabel: url ? '本地录制 · 已就绪' : '演示录制 · 已就绪',
    url,
    source: 'recording',
  })
  reviewUrl.value = null
  mode.value = 'compose'
}

async function copyDraft() {
  try {
    await navigator.clipboard.writeText(draft.value)
    toast.value = '口播稿已复制到剪贴板'
  } catch {
    toast.value = '已为你保留当前口播稿'
  }
}

onBeforeUnmount(() => {
  if (countdownTimer) window.clearTimeout(countdownTimer)
  if (toastTimer) window.clearTimeout(toastTimer)
  if (assistantTimer) window.clearTimeout(assistantTimer)
  stopElapsedTimer()
  reviewAfterStop = false
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null
    recorder.stop()
  }
  stopCamera()
  if (reviewUrl.value && !handedOff) URL.revokeObjectURL(reviewUrl.value)
})
</script>

<template>
  <section v-if="mode === 'teleprompter'" class="teleprompter-page reveal">
    <div class="teleprompter-header">
      <button class="back-button" type="button" @click="leaveTeleprompter"><ChevronLeft :size="18" /> 返回稿件</button>
      <div class="record-status" aria-live="polite">
        <template v-if="recordState === 'recording' || recordState === 'paused'">
          <span class="record-dot" /> {{ recordState === 'paused' ? '已暂停' : '录制中' }} · {{ secondsToClock(elapsed) }}
        </template>
        <template v-else>
          <span class="status-dot" :class="{ amber: cameraStatus !== 'live' }" />
          {{ cameraStatus === 'live' ? '镜头已就绪' : cameraStatus === 'requesting' ? '正在连接镜头' : '演示镜头' }}
        </template>
      </div>
      <span class="teleprompter-brand">MOONCUT ✦</span>
    </div>

    <div class="teleprompter-layout">
      <div class="camera-stage" :class="{ 'is-mirrored': mirror }">
        <video v-if="cameraStatus === 'live'" ref="cameraVideoRef" class="camera-video" autoplay muted playsinline />
        <div v-else class="camera-fallback">
          <span class="camera-glow" />
          <div class="person-silhouette large" aria-hidden="true"><span class="person-head" /><span class="person-body" /></div>
          <LoaderCircle v-if="cameraStatus === 'requesting'" class="camera-loader" :size="24" />
        </div>
        <div class="camera-vignette" />
        <div class="teleprompter-copy" :style="{ fontSize: `${fontSize}px` }">
          <span
            v-for="(sentence, index) in sentences"
            :key="`${sentence}-${index}`"
            :class="{ 'is-current': index === currentSentence, 'is-past': index < currentSentence }"
          >{{ sentence }}</span>
        </div>
        <div v-if="recordState === 'countdown' && countdown !== null" class="countdown-overlay" aria-live="assertive">
          <strong>{{ countdown || '开始' }}</strong>
        </div>
      </div>

      <aside class="prompt-controls">
        <div class="controls-heading">
          <span class="mini-label">提词设置</span><h2>看镜头，慢慢说。</h2><p>稿子会按你的设置推进，录制后可以直接送去剪辑。</p>
        </div>
        <label class="range-setting">
          <span><Type :size="17" /> 字号 <strong>{{ fontSize }}</strong></span>
          <input v-model.number="fontSize" type="range" min="26" max="46">
        </label>
        <label class="range-setting">
          <span><Gauge :size="17" /> 滚动速度 <strong>{{ scrollSpeed }}</strong></span>
          <input v-model.number="scrollSpeed" type="range" min="1" max="5">
        </label>
        <button class="toggle-setting" :class="{ 'is-on': mirror }" type="button" aria-label="镜像画面" :aria-pressed="mirror" @click="mirror = !mirror">
          <span><Video :size="17" /> 镜像画面</span><i><b /></i>
        </button>
        <div class="control-spacer" />
        <button v-if="recordState === 'idle'" class="record-button" type="button" aria-label="3 秒后开始录制" :disabled="cameraStatus === 'requesting'" @click="startRecording">
          <span><Circle :size="18" fill="currentColor" /></span>{{ cameraStatus === 'requesting' ? '镜头连接中…' : '3 秒后开始录制' }}
        </button>
        <button v-else-if="recordState === 'countdown'" class="record-button" type="button" disabled><TimerReset :size="19" /> 准备好，看镜头</button>
        <div v-else class="live-controls">
          <button type="button" @click="pauseRecording">
            <Play v-if="recordState === 'paused'" :size="18" /><Pause v-else :size="18" />{{ recordState === 'paused' ? '继续' : '暂停' }}
          </button>
          <button class="finish-button" type="button" @click="finishRecording"><Square :size="16" fill="currentColor" /> 完成录制</button>
        </div>
        <p v-if="cameraStatus === 'fallback'" class="camera-note">没有相机权限也没关系，可以继续体验完整录制流程。</p>
      </aside>
    </div>
    <ToastMessage :message="toast" />
  </section>

  <section v-else-if="mode === 'review'" class="workspace-page review-page reveal">
    <div class="page-heading compact-heading">
      <div><span class="eyebrow"><Check :size="15" /> 录制完成</span><h1>这一遍，很自然。</h1><p>预览一下，满意就直接交给智能剪辑。</p></div>
    </div>
    <div class="review-layout">
      <div class="review-video-card">
        <div class="review-video-stage">
          <video v-if="reviewUrl" :src="reviewUrl" controls playsinline />
          <div v-else class="recorded-placeholder">
            <div class="person-silhouette large" aria-hidden="true"><span class="person-head" /><span class="person-body" /></div>
            <span class="round-play" aria-hidden="true"><Play :size="20" fill="currentColor" /></span>
          </div>
          <span class="video-chip">刚刚录制 · {{ secondsToClock(Math.max(elapsed, 12)) }}</span>
        </div>
      </div>
      <aside class="review-summary">
        <span class="success-kicker"><Sparkles :size="17" /> {{ reviewUrl ? '已保存到本地' : '演示录制已完成' }}</span>
        <h2>接下来，交给剪辑台。</h2>
        <p>系统会自动去掉停顿与重复表达，再加上适合口播的节奏字幕。</p>
        <div class="review-flow"><span class="is-done"><Check :size="13" /> 想法</span><i /><span class="is-done"><Check :size="13" /> 口播稿</span><i /><span class="is-done"><Check :size="13" /> 录制</span><i /><span>剪辑</span></div>
        <button class="primary-button large-button" type="button" @click="handoffToEdit">一键去剪辑 <ArrowRight :size="18" /></button>
        <button class="secondary-button large-button" type="button" @click="rerecord"><RotateCcw :size="17" /> 重新录制</button>
        <button class="text-button" type="button" @click="copyDraft"><Copy :size="15" /> 保存口播稿</button>
      </aside>
    </div>
    <ToastMessage :message="toast" />
  </section>

  <section v-else class="workspace-page record-page">
    <div class="page-heading reveal">
      <div>
        <span class="eyebrow"><MessageCircleMore :size="15" /> 口播助手</span>
        <h1>先聊明白，再开口录。</h1>
        <p>说说你想讲什么，助手会陪你把它变成一篇能直接念的口播稿。</p>
      </div>
      <div class="record-flow-indicator" aria-label="口播创作流程"><span class="is-current">1 聊想法</span><i /><span>2 成稿</span><i /><span>3 录制</span></div>
    </div>

    <div class="mobile-compose-tabs" role="tablist" aria-label="口播创作面板">
      <button role="tab" type="button" :class="{ 'is-active': mobilePanel === 'chat' }" :aria-selected="mobilePanel === 'chat'" @click="mobilePanel = 'chat'"><MessageCircleMore :size="16" /> 和助手聊</button>
      <button role="tab" type="button" :class="{ 'is-active': mobilePanel === 'draft' }" :aria-selected="mobilePanel === 'draft'" @click="mobilePanel = 'draft'"><WandSparkles :size="16" /> 我的口播稿</button>
    </div>

    <div class="compose-layout reveal reveal-delay">
      <section class="assistant-card" :class="{ 'mobile-panel-hidden': mobilePanel !== 'chat' }">
        <div class="panel-header">
          <div class="assistant-identity">
            <span class="assistant-avatar"><Bot :size="19" /></span>
            <div><strong>Moon 助手</strong><small><span class="status-dot" /> 正在陪你构思</small></div>
          </div>
          <span class="context-pill">懂口播节奏</span>
        </div>

        <div class="chat-scroll">
          <div v-for="message in messages" :key="message.id" class="chat-message" :class="message.role">
            <span v-if="message.role === 'assistant'" class="message-avatar"><Sparkles :size="15" /></span><p>{{ message.content }}</p>
          </div>
          <div v-if="messages.length === 1" class="quick-topics">
            <span>不知道怎么说？选一个开始</span>
            <div><button v-for="item in quickTopics" :key="item" type="button" @click="sendMessage(item)">{{ item }} <ArrowRight :size="13" /></button></div>
          </div>
          <div v-if="isThinking" class="chat-message assistant thinking-message" role="status" aria-label="助手正在思考">
            <span class="message-avatar"><Sparkles :size="15" /></span><p aria-hidden="true"><i /><i /><i /></p>
          </div>
          <div v-if="messages.length > 1 && !isThinking" class="suggestion-block">
            <div class="suggestion-heading"><span>建议你从这 3 个角度讲</span><small>点击选择需要的内容</small></div>
            <button
              v-for="(suggestion, index) in suggestionOptions"
              :key="suggestion.title"
              class="suggestion-card"
              :class="{ 'is-selected': selectedSuggestions.has(index) }"
              type="button"
              :aria-pressed="selectedSuggestions.has(index)"
              @click="toggleSuggestion(index)"
            >
              <span class="suggestion-icon"><component :is="suggestion.icon" :size="17" /></span>
              <span><small>{{ suggestion.eyebrow }}</small><strong>{{ suggestion.title }}</strong><em>{{ suggestion.detail }}</em></span>
              <i><Check v-if="selectedSuggestions.has(index)" :size="13" /></i>
            </button>
            <div class="suggestion-actions">
              <button class="apply-button" type="button" :disabled="!selectedSuggestions.size" @click="applySuggestions"><WandSparkles :size="16" /> 加入口播稿</button>
              <button type="button" @click="toast = '已经换了一组更具体的表达角度'"><RotateCcw :size="14" /> 换一组</button>
            </div>
          </div>
          <div ref="chatEndRef" />
        </div>

        <div class="chat-composer">
          <textarea v-model="input" rows="2" aria-label="告诉助手你想讲的内容" placeholder="比如：我想讲为什么口播开头 3 秒很重要…" @keydown="handleInputKeydown" />
          <button type="button" :disabled="!input.trim() || isThinking" aria-label="发送消息" @click="sendMessage()"><Send :size="18" /></button>
          <small><span><Mic2 :size="13" /> 也可以直接说</span><span>Enter 发送</span></small>
        </div>
      </section>

      <section class="script-card" :class="{ 'mobile-panel-hidden': mobilePanel !== 'draft' }">
        <div class="panel-header script-header">
          <div><span class="mini-label">你的口播稿</span><h2>可以直接念，也可以继续改。</h2></div>
          <span class="script-metrics">约 {{ estimatedSeconds }} 秒 · {{ characterCount }} 字</span>
        </div>
        <div class="polish-tools" aria-label="稿件润色工具">
          <span><Sparkles :size="15" /> 快速润色</span>
          <button type="button" @click="polishDraft('oral')"><MessageCircleMore :size="14" /> 更口语</button>
          <button type="button" @click="polishDraft('short')"><Scissors :size="14" /> 再精简</button>
          <button type="button" @click="polishDraft('emotional')"><Heart :size="14" /> 更有感染力</button>
        </div>
        <div class="script-editor-wrap">
          <span class="quote-mark">“</span>
          <textarea v-model="draft" class="script-editor" aria-label="编辑口播稿" />
        </div>
        <div class="script-footer">
          <p><Check :size="14" /> 已自动保存到本地</p>
          <div>
            <button class="copy-button" type="button" @click="copyDraft"><Copy :size="16" /> 复制稿件</button>
            <button class="primary-button" type="button" @click="enterTeleprompter">进入提词录制 <ArrowRight :size="17" /></button>
          </div>
        </div>
      </section>
    </div>
    <ToastMessage :message="toast" />
  </section>
</template>
