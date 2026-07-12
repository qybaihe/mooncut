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
  Plus,
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
import { useSpeakingCoach, warmFaceLandmarker } from '../composables/useSpeakingCoach'
import { useTheme } from '../composables/useTheme'
import { requestCoachAdvice, requestScriptAssistant } from '../services/api'
import type { PetAnimationState, ScriptSuggestion, VideoAsset } from '../types'
import ToastMessage from './ToastMessage.vue'

const { currentTheme } = useTheme()

type StudioMode = 'compose' | 'teleprompter' | 'review'
type RecordState = 'idle' | 'countdown' | 'recording' | 'paused'
type CameraStatus = 'requesting' | 'live' | 'error'
type AspectRatioId = '16:9' | '4:3' | '1:1' | '9:16'
type ChatMessage = { id: number; role: 'assistant' | 'user'; content: string }

const ASPECT_PRESETS: Array<{ id: AspectRatioId; label: string; short: string; w: number; h: number }> = [
  { id: '16:9', label: '横屏 16:9', short: '16:9', w: 16, h: 9 },
  { id: '4:3', label: '横屏 4:3', short: '4:3', w: 4, h: 3 },
  { id: '1:1', label: '方形 1:1', short: '1:1', w: 1, h: 1 },
  { id: '9:16', label: '竖屏 9:16', short: '9:16', w: 9, h: 16 },
]

const props = defineProps<{ userEmail: string }>()
const emit = defineEmits<{
  'send-to-edit': [asset: VideoAsset]
  'mode-change': [mode: StudioMode]
  'pet-state': [state: PetAnimationState]
  'pet-message': [message: string]
}>()

const quickTopics = ['讲一个知识点', '做产品介绍', '分享个人经历', '表达一个观点']
const initialMessage: ChatMessage = {
  id: 1,
  role: 'assistant',
  content: '先告诉我：这条口播，你最想让观众记住什么？我会陪你把想法一步步变成能直接念的稿子。',
}

const storageScope = encodeURIComponent(props.userEmail.toLowerCase())
const messagesStorageKey = `mooncut:messages:${storageScope}`
const draftStorageKey = `mooncut:draft:${storageScope}`
const modelStorageKey = `mooncut:assistant-model:${storageScope}`

function loadMessages(): ChatMessage[] {
  try {
    const stored = JSON.parse(localStorage.getItem(messagesStorageKey) ?? 'null')
    return Array.isArray(stored) && stored.length ? stored : [initialMessage]
  } catch {
    return [initialMessage]
  }
}

const mode = ref<StudioMode>('compose')
const mobilePanel = ref<'chat' | 'draft'>('chat')
const messages = ref<ChatMessage[]>(loadMessages())
const input = ref('')
const isThinking = ref(false)
const selectedSuggestions = ref(new Set<number>())
const suggestionOptions = ref<(ScriptSuggestion & { icon: typeof Zap })[]>([])
const draft = ref(localStorage.getItem(draftStorageKey) ?? '')
const assistantError = ref('')
const lastFailedMessage = ref('')
const lastResponseModel = ref(localStorage.getItem(modelStorageKey) ?? '')
const {
  pace: coachPace,
  volume: coachVolume,
  wordCount: coachWordCount,
  pauseCount: coachPauseCount,
  eyeContact: coachEyeContact,
  transcript: coachTranscript,
  speechStatus: coachSpeechStatus,
  visionStatus: coachVisionStatus,
  localAdvice: coachLocalAdvice,
  adviceCategory: coachAdviceCategory,
  advicePositive: coachLocalPositive,
  activeSentenceIndex: coachSentenceIndex,
  isScriptAligned: coachScriptAligned,
  start: startCoach,
  stop: stopCoach,
  reset: resetCoach,
} = useSpeakingCoach(draft)
const toast = ref('')
/** idle = 尚未进入录制页；requesting/live/error 仅在提词器页使用 */
const cameraStatus = ref<CameraStatus | 'idle'>('idle')
const cameraError = ref('')
const recordState = ref<RecordState>('idle')
const countdown = ref<number | null>(null)
const elapsed = ref(0)
/** Preference slider (not absolute px); short scripts stay compact in a fixed rail. */
const fontSize = ref(24)
const scrollSpeed = ref(3)
const mirror = ref(true)
/** Default landscape 4:3 — camera is wide; we crop the sensor into this frame. */
const aspectRatio = ref<AspectRatioId>('4:3')
const reviewUrl = ref<string | null>(null)
const recordedMime = ref('video/webm')
const recordedBlob = ref<Blob | null>(null)
const liveAdvice = ref('看镜头，按自己的节奏开始。')
const liveAdviceCategory = ref('steady')
const liveAdvicePositive = ref(true)
const liveAdviceModel = ref('本地实时分析')

const chatEndRef = ref<HTMLDivElement | null>(null)
const cameraVideoRef = ref<HTMLVideoElement | null>(null)
const scriptScrollRef = ref<HTMLDivElement | null>(null)
let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let chunks: Blob[] = []
let countdownTimer: number | null = null
let elapsedTimer: number | null = null
let toastTimer: number | null = null
let cameraRequestId = 0
let reviewAfterStop = true
let handedOff = false
let coachAdviceTimer: number | null = null
let coachAdvicePending = false
let lastCoachRequestAt = 0
let lastCoachTranscriptLength = 0
let lastLocalAdviceAt = 0
let canvasDrawRaf = 0
let recordCanvas: HTMLCanvasElement | null = null

const characterCount = computed(() => draft.value.replace(/\s/g, '').length)
const estimatedSeconds = computed(() => characterCount.value ? Math.max(8, Math.round(characterCount.value / 4.1)) : 0)
/** Split on sentence ends + newlines so teleprompter has usable line chunks. */
const sentences = computed(() =>
  draft.value
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean),
)
const timedSentence = computed(() => {
  if (!sentences.value.length) return 0
  // scrollSpeed 1→慢, 5→快：每句约 7s…3s
  const secondsPerLine = Math.max(2.8, 8.2 - scrollSpeed.value * 1.05)
  return Math.min(sentences.value.length - 1, Math.floor(elapsed.value / secondsPerLine))
})
/** ASR drives the cue after a verified script anchor; time is startup fallback only. */
const currentSentence = computed(() => {
  if (!sentences.value.length) return 0
  const timed = timedSentence.value
  if (recordState.value !== 'recording' && recordState.value !== 'paused') return timed
  return coachScriptAligned.value
    ? Math.min(sentences.value.length - 1, coachSentenceIndex.value)
    : timed
})
const previousSentenceText = computed(() => sentences.value[Math.max(0, currentSentence.value - 1)] ?? '')
const currentSentenceText = computed(() => sentences.value[currentSentence.value] ?? '准备好后，从第一句自然开口。')
const nextSentenceText = computed(() => {
  const next = currentSentence.value + 1
  if (next >= sentences.value.length) return ''
  return sentences.value[next] ?? ''
})
const hasNextSentence = computed(() => currentSentence.value < sentences.value.length - 1)
const activeAspect = computed(
  () => ASPECT_PRESETS.find((item) => item.id === aspectRatio.value) ?? ASPECT_PRESETS[1],
)
const aspectCss = computed(() => `${activeAspect.value.w} / ${activeAspect.value.h}`)
/**
 * Keep the full script in a fixed-height rail: short 口播 uses modest type so it
 * sits in one glanceable block; long copy shrinks further and scrolls.
 */
const scriptDisplaySize = computed(() => {
  const n = characterCount.value
  let base = 14
  if (n <= 0) base = 13
  else if (n <= 140) base = 14
  else if (n <= 260) base = 13
  else if (n <= 420) base = 12
  else base = 11
  // fontSize 16–36 → bias about −2…+2
  const bias = Math.round((fontSize.value - 24) / 6)
  return Math.min(16, Math.max(11, base + bias))
})
const scriptIsCompact = computed(() => characterCount.value > 0 && characterCount.value <= 280)
const visibleCoachTranscript = computed(() => {
  const text = coachTranscript.value.trim()
  return text.length > 120 ? `…${text.slice(-120)}` : text
})
const recordingExtension = computed(() => recordedMime.value.includes('mp4') ? 'mp4' : 'webm')
const petState = computed<PetAnimationState>(() => {
  if (toast.value || mode.value === 'review') return 'jumping'
  if (mode.value === 'teleprompter') {
    if (recordState.value === 'countdown') return 'waving'
    if (recordState.value === 'recording' || recordState.value === 'paused') return liveAdvicePositive.value ? 'running' : 'waiting'
    return cameraStatus.value === 'requesting' ? 'waiting' : 'waving'
  }
  if (isThinking.value) return 'running'
  if (mobilePanel.value === 'draft' || messages.value.length > 1) return 'review'
  return 'idle'
})

watch(draft, (value) => localStorage.setItem(draftStorageKey, value))
watch(messages, (value) => localStorage.setItem(messagesStorageKey, JSON.stringify(value)), { deep: true })
watch(lastResponseModel, (value) => value ? localStorage.setItem(modelStorageKey, value) : localStorage.removeItem(modelStorageKey))
watch(mode, (value) => emit('mode-change', value), { immediate: true })
watch(petState, (state) => emit('pet-state', state), { immediate: true })
watch([messages, isThinking], async () => {
  await nextTick()
  chatEndRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})
watch(currentSentence, async (index, prev) => {
  if (
    (recordState.value === 'recording' || recordState.value === 'paused') &&
    typeof prev === 'number' &&
    index > prev
  ) {
    const upcoming = sentences.value[index + 1]
    emit(
      'pet-message',
      upcoming
        ? '往下瞄一眼下一句，可以先抛冲突再给答案。'
        : '最后一句了，把金句钉稳一点。',
    )
  }
  // Keep the active line visible in the full-script rail.
  await nextTick()
  const root = scriptScrollRef.value
  const active = root?.querySelector<HTMLElement>('.is-current')
  active?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})
watch(coachLocalAdvice, (message) => {
  lastLocalAdviceAt = Date.now()
  liveAdvice.value = message
  liveAdviceCategory.value = coachAdviceCategory.value
  liveAdvicePositive.value = coachLocalPositive.value
  liveAdviceModel.value = '本地实时分析'
  if (recordState.value === 'recording') emit('pet-message', message)
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

function releaseStreamTracks(media: MediaStream | null) {
  media?.getTracks().forEach((track) => {
    track.onended = null
    try {
      track.stop()
    } catch {
      // ignore
    }
  })
}

function clearVideoElement() {
  const video = cameraVideoRef.value
  if (!video) return
  try {
    video.pause()
  } catch {
    // ignore
  }
  video.srcObject = null
  video.removeAttribute('src')
  video.load()
}

/** Stop hardware and invalidate in-flight openCamera requests. */
function stopCamera() {
  cameraRequestId += 1
  releaseStreamTracks(stream)
  stream = null
  clearVideoElement()
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException || (error && typeof error === 'object' && 'name' in error)) {
    const name = String((error as { name?: string }).name || '')
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return '摄像头或麦克风权限未开启。请点击地址栏左侧的锁/摄像头图标，允许本站访问后点「重新连接」。'
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '没有检测到可用的摄像头或麦克风，请检查设备连接后重试。'
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return '摄像头可能正被 Zoom/会议软件或其他标签页占用。关掉占用后点「重新连接」。'
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return '当前摄像头参数不兼容，请点「重新连接」使用兼容模式。'
    }
    if (name === 'SecurityError') {
      return '浏览器阻止了摄像头访问。请使用 https://mooncut.me 打开（不要用文件协议）。'
    }
    if (name === 'AbortError') {
      return '摄像头请求被中断，请再点一次「重新连接摄像头」。'
    }
    if (name) return `摄像头连接失败（${name}），请重新连接。`
  }
  if (error instanceof Error && error.message) {
    if (/preview is unavailable|video element/i.test(error.message)) {
      return '预览画面还没准备好，请再点一次「重新连接摄像头」。'
    }
    if (/no video frames|timed out/i.test(error.message)) {
      return '已拿到摄像头权限，但预览没有出画。请关闭其他占用摄像头的应用后重试。'
    }
  }
  return '摄像头连接失败，请重新连接。'
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/** Progressive fallbacks — high ideal resolution often fails or blacks out on some devices. */
const MEDIA_CONSTRAINT_ATTEMPTS: MediaStreamConstraints[] = [
  {
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: AUDIO_CONSTRAINTS,
  },
  {
    video: { facingMode: { ideal: 'user' } },
    audio: AUDIO_CONSTRAINTS,
  },
  { video: true, audio: true },
  { video: { facingMode: 'user' }, audio: false },
  { video: true, audio: false },
]

/**
 * IMPORTANT: Call this without any `await` before it in the click handler chain.
 * Safari / some Chromium builds only show the permission prompt when getUserMedia
 * is invoked synchronously from a user gesture.
 */
function beginMediaRequest(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(
      new DOMException('getUserMedia unsupported', 'NotSupportedError'),
    )
  }
  // Kick off the first attempt synchronously for the user-gesture token.
  const first = MEDIA_CONSTRAINT_ATTEMPTS[0]
  return navigator.mediaDevices.getUserMedia(first).catch(async (firstError) => {
    let lastError: unknown = firstError
    for (let i = 1; i < MEDIA_CONSTRAINT_ATTEMPTS.length; i += 1) {
      try {
        return await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINT_ATTEMPTS[i])
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new DOMException('Unable to open camera', 'NotReadableError')
  })
}

async function waitForCameraVideoElement(requestId: number, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    if (requestId !== cameraRequestId) return null
    if (mode.value === 'teleprompter' && cameraVideoRef.value) return cameraVideoRef.value
    await nextTick()
    await new Promise((resolve) => window.setTimeout(resolve, 32))
  }
  return cameraVideoRef.value
}

function prepareVideoElement(video: HTMLVideoElement) {
  video.muted = true
  video.defaultMuted = true
  video.autoplay = true
  video.playsInline = true
  video.setAttribute('muted', '')
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', 'true')
}

async function waitForVideoPlayback(video: HTMLVideoElement) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup()
        // Don't hard-fail if we already have metadata — some devices report frames late.
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve()
        else reject(new DOMException('Camera preview timed out', 'NotReadableError'))
      }, 12_000)
      const ready = () => {
        cleanup()
        resolve()
      }
      const failed = () => {
        cleanup()
        reject(video.error ?? new DOMException('Camera preview failed', 'NotReadableError'))
      }
      const cleanup = () => {
        window.clearTimeout(timer)
        video.removeEventListener('loadeddata', ready)
        video.removeEventListener('loadedmetadata', ready)
        video.removeEventListener('error', failed)
      }
      video.addEventListener('loadeddata', ready, { once: true })
      video.addEventListener('loadedmetadata', ready, { once: true })
      video.addEventListener('error', failed, { once: true })
    })
  }
  try {
    await video.play()
  } catch (error) {
    // Autoplay may reject once; muted + playsInline usually works on retry.
    video.muted = true
    await video.play().catch(() => {
      throw error instanceof Error
        ? error
        : new DOMException('Camera preview play failed', 'NotReadableError')
    })
  }
  // Give the decoder a moment; black first frame is common.
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve) => window.setTimeout(resolve, 250))
  }
  if (!video.videoWidth || !video.videoHeight) {
    throw new DOMException('Camera returned no video frames', 'NotReadableError')
  }
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.value = 'error'
    cameraError.value = '当前浏览器不支持摄像头录制，请使用最新版 Chrome、Edge 或 Safari。'
    return
  }

  // Invalidate previous attempts and free hardware, then start a new request id.
  releaseStreamTracks(stream)
  stream = null
  clearVideoElement()
  const requestId = ++cameraRequestId
  cameraStatus.value = 'requesting'
  cameraError.value = ''

  // Start getUserMedia NOW (still inside the caller's user-gesture stack if no await before openCamera).
  const mediaPromise = beginMediaRequest()

  let requestedStream: MediaStream | null = null
  try {
    requestedStream = await mediaPromise
    if (requestId !== cameraRequestId) {
      releaseStreamTracks(requestedStream)
      return
    }
    const videoTrack = requestedStream.getVideoTracks()[0]
    if (!videoTrack || videoTrack.readyState !== 'live') {
      throw new DOMException('No live camera track', 'NotReadableError')
    }
    // Mic is preferred for recording, but preview should still work without it.
    const audioTrack = requestedStream.getAudioTracks()[0]
    if (!audioTrack) {
      toast.value = '未拿到麦克风，预览可用；录制口播需要允许麦克风权限。'
    }

    stream = requestedStream
    const video = await waitForCameraVideoElement(requestId)
    if (requestId !== cameraRequestId) return
    if (!video) throw new DOMException('Camera preview is unavailable', 'NotReadableError')

    prepareVideoElement(video)
    video.srcObject = stream
    // Show the element as soon as stream is attached — avoids "black forever" if status lags.
    cameraStatus.value = 'live'
    await waitForVideoPlayback(video)
    if (requestId !== cameraRequestId) return

    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (requestId !== cameraRequestId) return
        stopCamera()
        cameraStatus.value = 'error'
        cameraError.value = `${track.kind === 'video' ? '摄像头' : '麦克风'}连接已中断，请重新连接。`
      }
    }
    cameraStatus.value = 'live'
    cameraError.value = ''
    // Warm Face Landmarker (注视模型) while user is still on the teleprompter setup
    // screen so the ~10MB WASM+model is ready before they hit Record.
    void warmFaceLandmarker().then((result) => {
      if (requestId !== cameraRequestId) return
      if (!result.ok) {
        console.warn('[mooncut] face landmarker warm-up:', result.detail)
      }
    })
  } catch (error) {
    releaseStreamTracks(requestedStream)
    if (requestId === cameraRequestId) {
      stream = null
      clearVideoElement()
      cameraStatus.value = 'error'
      cameraError.value = cameraErrorMessage(error)
    }
  }
}

async function sendMessage(preset?: string, retry = false) {
  const content = (preset ?? input.value).trim()
  if (!content || isThinking.value) return
  if (!retry) messages.value.push({ id: Date.now(), role: 'user', content })
  input.value = ''
  isThinking.value = true
  assistantError.value = ''
  try {
    const response = await requestScriptAssistant({ action: 'guide', messages: messages.value, draft: draft.value })
    const suggestions = Array.isArray(response.suggestions) ? response.suggestions : []
    if (suggestions.length < 1) throw new Error('模型没有返回创作建议，请重试')
    const reply = (response.reply || '').trim() || '我想到了几个角度，点选后就能成稿。'
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      content: reply,
    })
    // Pad to 3 cards so the UI always has selectable options.
    const padded = [...suggestions]
    while (padded.length < 3) {
      padded.push({
        eyebrow: `角度 ${padded.length + 1}`,
        title: '换一个更具体的说法',
        detail: '补充一个真实场景或证据，让观点落地。',
      })
    }
    suggestionOptions.value = padded.slice(0, 3).map((suggestion, index) => ({
      eyebrow: suggestion.eyebrow || `角度 ${index + 1}`,
      title: suggestion.title || '继续展开这个方向',
      detail: suggestion.detail || '再具体一点，我就能帮你写成稿。',
      icon: [Zap, Lightbulb, ArrowRight][index] ?? Sparkles,
    }))
    selectedSuggestions.value = new Set([0])
    lastResponseModel.value = response.model || ''
    lastFailedMessage.value = ''
    if (response.draft) {
      draft.value = response.draft
      mobilePanel.value = 'draft'
    }
    emit('pet-message', response.petMessage || '这个方向有感觉，再具体一点吧。')
  } catch (error) {
    suggestionOptions.value = []
    lastFailedMessage.value = content
    assistantError.value = error instanceof Error ? error.message : '模型请求失败，请重试'
    toast.value = `真实模型调用失败：${assistantError.value}`
  } finally {
    isThinking.value = false
  }
}

function retryDialogue() {
  if (lastFailedMessage.value) void sendMessage(lastFailedMessage.value, true)
}

function refreshSuggestions() {
  void sendMessage('请基于我前面说的主题，再给一组完全不同、更加具体的三个表达角度。先不要成稿。')
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

async function applySuggestions() {
  if (isThinking.value || selectedSuggestions.value.size === 0) return
  isThinking.value = true
  assistantError.value = ''
  const selected = suggestionOptions.value
    .filter((_, index) => selectedSuggestions.value.has(index))
    .map((item) => `${item.eyebrow}：${item.title}（${item.detail}）`)
    .join('\n')
  try {
    const response = await requestScriptAssistant({
      action: 'generate',
      messages: [...messages.value, {
        role: 'user',
        content: `请把所选方向融合为唯一一篇 60–90 秒的完整口播稿，不要分别写多篇，不要添加标题、分隔线或创作说明：\n${selected}`,
      }],
      draft: draft.value,
    })
    const nextDraft = (response.draft || response.content || '').trim()
    if (!nextDraft) throw new Error('模型没有返回完整稿件')
    draft.value = nextDraft
    messages.value.push({
      id: Date.now(),
      role: 'assistant',
      content: (response.reply || '').trim() || '稿件已经写好，右侧可继续润色。',
    })
    lastResponseModel.value = response.model || ''
    emit('pet-message', response.petMessage || '稿子出来了，去念一遍试试！')
    mobilePanel.value = 'draft'
    toast.value = `${response.model || '模型'} 已整理成完整口播稿`
  } catch (error) {
    assistantError.value = error instanceof Error ? error.message : '模型没有生成稿件'
    toast.value = `成稿失败：${assistantError.value}`
  } finally {
    isThinking.value = false
  }
}

async function polishDraft(style: 'oral' | 'short' | 'emotional') {
  if (isThinking.value || !draft.value.trim()) return
  isThinking.value = true
  assistantError.value = ''
  try {
    const response = await requestScriptAssistant({
      action: 'polish',
      style,
      messages: messages.value,
      draft: draft.value,
    })
    const nextDraft = (response.draft || response.content || '').trim()
    if (!nextDraft) throw new Error('模型没有返回润色稿')
    draft.value = nextDraft
    lastResponseModel.value = response.model || ''
    emit('pet-message', response.petMessage || '改得更顺了，再读一遍！')
    const result = style === 'oral' ? '调得更口语' : style === 'short' ? '精简了重复信息' : '加强了感染力'
    toast.value = `${response.model || '模型'} 已${result}`
  } catch (error) {
    assistantError.value = error instanceof Error ? error.message : '模型润色失败'
    toast.value = `润色失败：${assistantError.value}`
  } finally {
    isThinking.value = false
  }
}

async function enterTeleprompter() {
  if (!draft.value.trim()) {
    toast.value = '请先通过真实对话生成口播稿'
    return
  }
  // Do NOT await anything before openCamera() — Safari drops the user-gesture
  // token after the first await, so the permission dialog never appears.
  elapsed.value = 0
  recordState.value = 'idle'
  mode.value = 'teleprompter'
  cameraStatus.value = 'requesting'
  cameraError.value = ''
  await openCamera()
}

function selectMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

function stopCanvasRecordPipeline() {
  if (canvasDrawRaf) cancelAnimationFrame(canvasDrawRaf)
  canvasDrawRaf = 0
  recordStream?.getTracks().forEach((track) => {
    if (track.kind === 'video') track.stop()
  })
  recordStream = null
  recordCanvas = null
}

/**
 * Camera sensors are landscape. We center-crop every frame into the chosen aspect
 * (4:3 / 16:9 / 1:1 / 9:16) so preview frame === exported file.
 */
function createAspectRecordStream(video: HTMLVideoElement, media: MediaStream) {
  stopCanvasRecordPipeline()
  const preset = activeAspect.value
  const targetRatio = preset.w / Math.max(0.001, preset.h)
  // Prefer 1280 on the longer side for quality without huge files.
  const longSide = 1280
  let outW: number
  let outH: number
  if (preset.w >= preset.h) {
    outW = longSide
    outH = Math.round(longSide * (preset.h / preset.w))
  } else {
    outH = longSide
    outW = Math.round(longSide * (preset.w / preset.h))
  }
  // Even dimensions help some encoders.
  outW = Math.max(2, outW - (outW % 2))
  outH = Math.max(2, outH - (outH % 2))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('无法创建画布录制')

  const draw = () => {
    const vw = video.videoWidth || 1280
    const vh = video.videoHeight || 720
    const sourceRatio = vw / Math.max(1, vh)
    // Cover-crop: landscape cam into 4:3 crops left/right; into 9:16 crops top/bottom.
    let sx = 0
    let sy = 0
    let sw = vw
    let sh = vh
    if (sourceRatio > targetRatio) {
      sw = vh * targetRatio
      sx = (vw - sw) / 2
    } else {
      sh = vw / targetRatio
      sy = (vh - sh) / 2
    }
    ctx.save()
    if (mirror.value) {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    ctx.restore()
    canvasDrawRaf = requestAnimationFrame(draw)
  }
  draw()

  const canvasStream = canvas.captureStream(30)
  const videoTrack = canvasStream.getVideoTracks()[0]
  const audioTrack = media.getAudioTracks().find((track) => track.readyState === 'live')
  const tracks = [videoTrack, audioTrack].filter(Boolean) as MediaStreamTrack[]
  recordCanvas = canvas
  recordStream = new MediaStream(tracks)
  return recordStream
}

function startElapsedTimer() {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  elapsedTimer = window.setInterval(() => (elapsed.value += 1), 1000)
}

function stopElapsedTimer() {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  elapsedTimer = null
}

function stopCoachAdviceTimer() {
  if (coachAdviceTimer) window.clearInterval(coachAdviceTimer)
  coachAdviceTimer = null
  coachAdvicePending = false
}

async function requestLiveCoachAdvice() {
  if (recordState.value !== 'recording' || elapsed.value < 6 || coachAdvicePending) return
  const now = Date.now()
  const transcriptLength = coachTranscript.value.replace(/\s/g, '').length
  if (now - lastCoachRequestAt < 14_000) return
  if (lastCoachRequestAt && transcriptLength - lastCoachTranscriptLength < 6 && now - lastCoachRequestAt < 24_000) return
  if (now - lastLocalAdviceAt < 4_500) return
  coachAdvicePending = true
  lastCoachRequestAt = now
  lastCoachTranscriptLength = transcriptLength
  try {
    const response = await requestCoachAdvice({
      transcript: coachTranscript.value.slice(-600),
      currentScript: draft.value,
      currentSentence: currentSentenceText.value,
      lastAdvice: liveAdvice.value,
      metrics: {
        pace: coachPace.value,
        wordCount: coachWordCount.value,
        volume: coachVolume.value,
        pauseCount: coachPauseCount.value,
        eyeContact: coachEyeContact.value,
        elapsedSeconds: elapsed.value,
      },
    })
    if (!response.advice) return
    liveAdvice.value = response.advice
    liveAdviceCategory.value = response.category || 'steady'
    liveAdvicePositive.value = response.positive === true
    liveAdviceModel.value = response.model || ''
    emit('pet-message', response.petMessage || response.advice)
  } catch {
    // Local real-time rules remain active when the low-latency model is unavailable.
  } finally {
    coachAdvicePending = false
  }
}

function startCoachAdviceTimer() {
  stopCoachAdviceTimer()
  lastCoachRequestAt = 0
  lastCoachTranscriptLength = 0
  lastLocalAdviceAt = 0
  window.setTimeout(() => void requestLiveCoachAdvice(), 8_000)
  coachAdviceTimer = window.setInterval(() => void requestLiveCoachAdvice(), 2_500)
}

function beginRecording() {
  chunks = []
  reviewAfterStop = true
  const hasVideo =
    cameraStatus.value === 'live' &&
    Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'))
  const hasAudio = Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live'))
  if (!hasVideo || typeof MediaRecorder === 'undefined') {
    countdown.value = null
    recordState.value = 'idle'
    cameraStatus.value = 'error'
    cameraError.value = typeof MediaRecorder === 'undefined'
      ? '当前浏览器不支持视频录制，请使用最新版 Chrome、Edge 或 Safari。'
      : '摄像头尚未就绪，请重新连接后再录制。'
    return
  }
  if (!hasAudio) {
    countdown.value = null
    recordState.value = 'idle'
    cameraStatus.value = 'error'
    cameraError.value = '录制需要麦克风权限。请允许麦克风后点「重新连接摄像头」。'
    return
  }
  try {
    const videoEl = cameraVideoRef.value
    if (!videoEl || !stream) throw new Error('预览画面未就绪')
    // Record the same cropped aspect the user sees (not raw camera orientation).
    const composed = createAspectRecordStream(videoEl, stream)
    const mimeType = selectMimeType()
    recorder = mimeType ? new MediaRecorder(composed, { mimeType }) : new MediaRecorder(composed)
    recordedMime.value = recorder.mimeType || mimeType || 'video/webm'
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onerror = () => {
      cameraError.value = '录制过程中摄像头发生错误，请重新录制。'
    }
    recorder.onstop = () => {
      stopElapsedTimer()
      stopCoachAdviceTimer()
      stopCoach()
      stopCanvasRecordPipeline()
      const hasRecording = reviewAfterStop && chunks.length > 0
      if (hasRecording) {
        if (reviewUrl.value && !handedOff) URL.revokeObjectURL(reviewUrl.value)
        const blob = new Blob(chunks, { type: recordedMime.value })
        recordedBlob.value = blob
        reviewUrl.value = URL.createObjectURL(blob)
      }
      stopCamera()
      recordState.value = 'idle'
      if (hasRecording) mode.value = 'review'
      else if (reviewAfterStop) {
        mode.value = 'teleprompter'
        cameraStatus.value = 'error'
        cameraError.value ||= '没有生成有效的视频文件，请重新连接摄像头后再录制。'
      } else mode.value = 'compose'
      recorder = null
    }
    recorder.start(250)
  } catch (error) {
    recorder = null
    stopCanvasRecordPipeline()
    stopCamera()
    cameraStatus.value = 'error'
    cameraError.value = error instanceof Error ? `无法开始录制：${error.message}` : '无法开始录制，请重新连接摄像头。'
    countdown.value = null
    recordState.value = 'idle'
    return
  }
  countdown.value = null
  recordState.value = 'recording'
  startElapsedTimer()
  // Small delay: lets MediaRecorder claim the mic, then ASR + MediaPipe attach cleanly.
  window.setTimeout(() => {
    if (recordState.value !== 'recording' || !stream) return
    void startCoach(stream, cameraVideoRef.value)
    startCoachAdviceTimer()
  }, 120)
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
  if (cameraStatus.value !== 'live' || !stream) {
    cameraStatus.value = 'error'
    cameraError.value ||= '请先连接真实摄像头和麦克风。'
    return
  }
  elapsed.value = 0
  resetCoach()
  liveAdvice.value = '看镜头，按自己的节奏开始。'
  liveAdvicePositive.value = true
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
    stopCoachAdviceTimer()
    stopCoach()
    stopCamera()
    recordState.value = 'idle'
    cameraStatus.value = 'error'
    cameraError.value = '没有正在进行的真实录制，请重新连接摄像头。'
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
    stopCoachAdviceTimer()
    stopCoach()
    stopCamera()
    recordState.value = 'idle'
    cameraStatus.value = 'idle'
    cameraError.value = ''
    mode.value = 'compose'
  }
}

async function rerecord() {
  if (reviewUrl.value && !handedOff) URL.revokeObjectURL(reviewUrl.value)
  reviewUrl.value = null
  recordedBlob.value = null
  handedOff = false
  elapsed.value = 0
  recordState.value = 'idle'
  mode.value = 'teleprompter'
  cameraStatus.value = 'requesting'
  cameraError.value = ''
  // Same rule as enterTeleprompter: openCamera before any await.
  await openCamera()
}

function handoffToEdit() {
  if (!reviewUrl.value || !recordedBlob.value) {
    toast.value = '没有可交给剪辑台的真实录制文件'
    return
  }
  const url = reviewUrl.value ?? undefined
  handedOff = true
  emit('send-to-edit', {
    name: `刚刚录制的口播.${recordingExtension.value}`,
    sizeLabel: '本地录制 · 已就绪',
    url,
    file: recordedBlob.value,
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

/** Wipe chat history, draft, suggestions and recording state — start a brand-new 口播. */
function startNewSpeakSession() {
  const hasWork =
    messages.value.length > 1 ||
    Boolean(draft.value.trim()) ||
    suggestionOptions.value.length > 0 ||
    mode.value !== 'compose' ||
    Boolean(reviewUrl.value) ||
    Boolean(recordedBlob.value)
  if (
    hasWork &&
    !window.confirm('开始新口播？当前对话、口播稿和录制状态都会清空，无法恢复。')
  ) {
    return
  }

  if (countdownTimer) window.clearTimeout(countdownTimer)
  countdownTimer = null
  stopElapsedTimer()
  stopCoachAdviceTimer()
  stopCoach()
  stopCanvasRecordPipeline()
  reviewAfterStop = false
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.onstop = null
      recorder.stop()
    } catch {
      // ignore
    }
  }
  recorder = null
  chunks = []
  stopCamera()
  if (reviewUrl.value && !handedOff) URL.revokeObjectURL(reviewUrl.value)

  mode.value = 'compose'
  mobilePanel.value = 'chat'
  messages.value = [
    {
      ...initialMessage,
      id: Date.now(),
    },
  ]
  input.value = ''
  isThinking.value = false
  selectedSuggestions.value = new Set()
  suggestionOptions.value = []
  draft.value = ''
  assistantError.value = ''
  lastFailedMessage.value = ''
  lastResponseModel.value = ''
  cameraStatus.value = 'idle'
  cameraError.value = ''
  recordState.value = 'idle'
  countdown.value = null
  elapsed.value = 0
  reviewUrl.value = null
  recordedBlob.value = null
  recordedMime.value = 'video/webm'
  liveAdvice.value = '看镜头，按自己的节奏开始。'
  liveAdviceCategory.value = 'steady'
  liveAdvicePositive.value = true
  liveAdviceModel.value = '本地实时分析'
  handedOff = false
  resetCoach()

  try {
    localStorage.setItem(messagesStorageKey, JSON.stringify(messages.value))
    localStorage.setItem(draftStorageKey, '')
    localStorage.removeItem(modelStorageKey)
  } catch {
    // private mode / quota
  }

  toast.value = '已开始新口播'
  emit('pet-message', '新的一条，我们从头聊。')
}

onBeforeUnmount(() => {
  if (countdownTimer) window.clearTimeout(countdownTimer)
  if (toastTimer) window.clearTimeout(toastTimer)
  stopElapsedTimer()
  stopCoachAdviceTimer()
  stopCoach()
  stopCanvasRecordPipeline()
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
          {{
            cameraStatus === 'live'
              ? '镜头已就绪'
              : cameraStatus === 'requesting'
                ? '等待摄像头权限'
                : '镜头未连接'
          }}
        </template>
      </div>
      <span class="teleprompter-brand">MOONCUT <img v-if="currentTheme === 'memphis'" class="memphis-sticker brand-sticker" src="/memphis-icons/camera-line.png" alt="" width="16" height="16">✦</span>
    </div>

    <div class="teleprompter-layout is-pro-layout is-lens-first">
      <main class="recording-focus">
        <section
          ref="scriptScrollRef"
          class="side-teleprompter is-full-script is-fixed-region lens-teleprompter"
          :class="{
            'is-live': recordState === 'recording' || recordState === 'paused',
            'is-compact': scriptIsCompact,
          }"
          :style="{ fontSize: `${scriptDisplaySize}px` }"
          aria-live="polite"
        >
          <div class="lens-teleprompter-head">
            <div>
              <span class="mini-label">对镜提词</span>
              <strong>{{ recordState === 'recording' || recordState === 'paused' ? '读稿时，目光留在镜头附近。' : '稿在镜头正上方，开录后自然扫读。' }}</strong>
            </div>
            <span class="lens-alignment" :class="{ 'is-synced': coachScriptAligned }">
              {{ coachScriptAligned ? '已精准对齐' : '等待语音对齐' }}
            </span>
          </div>
          <div class="side-tele-progress">
            <Sparkles :size="13" />
            全文 · {{ currentSentence + 1 }}/{{ sentences.length || 1 }}
            <em v-if="characterCount">{{ characterCount }} 字</em>
          </div>
          <div class="side-tele-list is-visible-full">
            <p
              v-for="(sentence, index) in sentences"
              :key="`${index}-${sentence.slice(0, 12)}`"
              :class="{
                'is-current': index === currentSentence,
                'is-past': index < currentSentence,
                'is-next': index === currentSentence + 1,
              }"
            >{{ sentence }}</p>
            <p v-if="!sentences.length" class="side-tele-empty">还没有口播稿，请先回到对话生成。</p>
          </div>
        </section>

        <!-- Aspect-locked camera: preview and exported crop stay identical. -->
        <div
          class="camera-stage is-hero"
          :class="{ 'is-mirrored': mirror, 'is-coaching': recordState === 'recording' || recordState === 'paused' }"
          :style="{ aspectRatio: aspectCss }"
          :data-aspect="aspectRatio"
        >
        <video
          ref="cameraVideoRef"
          class="camera-video"
          :class="{ 'is-visible': cameraStatus === 'live' }"
          autoplay
          muted
          playsinline
          webkit-playsinline
        />
        <div v-if="cameraStatus !== 'live'" class="camera-fallback camera-connection-state">
          <template v-if="cameraStatus === 'requesting'">
            <LoaderCircle class="camera-loader" :size="28" />
            <strong>正在连接摄像头和麦克风</strong>
            <p>请在浏览器弹窗里点「允许」。若没有弹窗，点地址栏的摄像头图标开启权限，再点下方重新连接。</p>
          </template>
          <template v-else>
            <span class="camera-error-icon"><Video :size="28" /></span>
            <strong>暂时没有真实画面</strong>
            <p>{{ cameraError || '摄像头尚未连接。' }}</p>
            <button type="button" @click="openCamera"><RotateCcw :size="15" /> 重新连接摄像头</button>
          </template>
        </div>
        <div class="camera-vignette" />
        <div class="camera-aspect-chip">裁剪 {{ activeAspect.short }}</div>
        <div v-if="recordState === 'recording' || recordState === 'paused'" class="camera-live-badge">
          <span class="record-dot" /> 跟读 {{ currentSentence + 1 }}/{{ sentences.length || 1 }}
        </div>
        <div v-if="recordState === 'recording' || recordState === 'paused'" class="coach-metrics-hud" aria-label="实时口播指标">
          <div><span>语速</span><strong>{{ coachPace || '—' }}<small>字/分</small></strong><i :class="{ warn: coachPace > 295 }" /></div>
          <div><span>词量</span><strong>{{ coachWordCount }}<small>字</small></strong><i /></div>
          <div class="volume-metric"><span>音量</span><strong>{{ coachVolume }}<small>%</small></strong><b><i :style="{ width: `${coachVolume}%` }" /></b></div>
          <div><span>停顿</span><strong>{{ coachPauseCount }}<small>次</small></strong><i /></div>
          <div><span>注视</span><strong>{{ coachEyeContact || '—' }}<small>{{ coachEyeContact ? '%' : '' }}</small></strong><i :class="{ warn: coachEyeContact > 0 && coachEyeContact < 60 }" /></div>
        </div>
        <div v-if="recordState === 'recording' || recordState === 'paused'" class="asr-caption" :class="{ 'is-empty': !coachTranscript }" aria-live="polite">
          <span class="asr-live-dot" />
          <p>{{ visibleCoachTranscript || '正在听你说…' }}</p>
        </div>
        <div v-if="recordState === 'countdown' && countdown !== null" class="countdown-overlay" aria-live="assertive">
          <strong>{{ countdown || '开始' }}</strong>
        </div>
        </div>
      </main>

      <!-- Secondary rail: aspect, coaching, and record controls. -->
      <aside class="prompt-rail recording-control-rail">
        <div class="prompt-rail-head">
          <span class="mini-label">录制控制</span>
          <h2>{{ recordState === 'recording' || recordState === 'paused' ? '保持镜头感。' : '选画幅 · 开录' }}</h2>
          <p class="prompt-rail-status">
            <template v-if="recordState === 'recording' || recordState === 'paused'">
              {{ coachVisionStatus }} · {{ coachSpeechStatus }}
            </template>
            <template v-else>
              摄像头是横屏，按所选比例居中裁剪成片；稿件已放到镜头正上方。
            </template>
          </p>
        </div>

        <div class="aspect-picker" role="group" aria-label="录制画幅（从横屏镜头裁剪）">
          <button
            v-for="preset in ASPECT_PRESETS"
            :key="preset.id"
            type="button"
            class="aspect-chip"
            :class="{ 'is-active': aspectRatio === preset.id }"
            :disabled="recordState === 'recording' || recordState === 'paused' || recordState === 'countdown'"
            :aria-pressed="aspectRatio === preset.id"
            @click="aspectRatio = preset.id"
          >
            <i :data-ratio="preset.id" />
            <span>{{ preset.label }}</span>
          </button>
        </div>

        <div
          v-if="recordState === 'recording' || recordState === 'paused'"
          :key="liveAdvice"
          class="side-coach-card"
          :class="[`category-${liveAdviceCategory}`, { 'is-positive': liveAdvicePositive }]"
        >
          <span><Bot :size="16" /></span>
          <div>
            <small>{{ liveAdviceModel }} · 语气</small>
            <strong>{{ liveAdvice }}</strong>
          </div>
        </div>

        <div class="prompt-controls prompt-controls-compact">
          <label class="range-setting">
            <span><Type :size="17" /> 字号偏好 <strong>{{ scriptDisplaySize }}px</strong></span>
            <input v-model.number="fontSize" type="range" min="16" max="36">
          </label>
          <label class="range-setting">
            <span><Gauge :size="17" /> 跟读速度 <strong>{{ scrollSpeed }}</strong></span>
            <input v-model.number="scrollSpeed" type="range" min="1" max="5">
          </label>
          <button class="toggle-setting" :class="{ 'is-on': mirror }" type="button" aria-label="镜像画面" :aria-pressed="mirror" @click="mirror = !mirror">
            <span><Video :size="17" /> 镜像预览</span><i><b /></i>
          </button>
          <div class="control-spacer" />
          <button
            v-if="recordState === 'idle'"
            class="record-button"
            type="button"
            aria-label="3 秒后开始录制"
            :disabled="cameraStatus !== 'live'"
            @click="startRecording"
          >
            <span><Circle :size="18" fill="currentColor" /></span>
            {{
              cameraStatus === 'live'
                ? `裁剪 ${activeAspect.short} · 开始录`
                : cameraStatus === 'requesting'
                  ? '等待镜头权限…'
                  : '请先重新连接镜头'
            }}
          </button>
          <button
            v-if="recordState === 'idle' && cameraStatus === 'error'"
            class="record-button secondary-record-button"
            type="button"
            @click="openCamera"
          >
            <RotateCcw :size="17" /> 重新连接摄像头
          </button>
          <button v-else-if="recordState === 'countdown'" class="record-button" type="button" disabled><TimerReset :size="19" /> 准备好，看镜头</button>
          <div v-else-if="recordState === 'recording' || recordState === 'paused'" class="live-controls">
            <button type="button" @click="pauseRecording">
              <Play v-if="recordState === 'paused'" :size="18" /><Pause v-else :size="18" />{{ recordState === 'paused' ? '继续' : '暂停' }}
            </button>
            <button class="finish-button" type="button" @click="finishRecording"><Square :size="16" fill="currentColor" /> 完成录制</button>
          </div>
          <p class="camera-note">
            镜头是横屏；选 {{ activeAspect.label }} 会从中间裁进左侧框，导出与预览一致。
          </p>
          <p v-if="cameraStatus === 'error'" class="camera-note">录制只会使用真实摄像头和麦克风，不会进入演示模式。</p>
        </div>
      </aside>
    </div>
    <ToastMessage :message="toast" />
  </section>

  <section v-else-if="mode === 'review'" class="workspace-page review-page reveal">
    <div class="page-heading compact-heading">
      <div><span class="eyebrow"><Check :size="15" /> 录制完成 <img v-if="currentTheme === 'memphis'" class="memphis-sticker eyebrow-sticker" src="/memphis-icons/record-line.png" alt="" width="18" height="18"></span><h1>这一遍，很自然。</h1><p>预览一下，满意就直接交给智能剪辑。</p></div>
    </div>
    <div class="review-layout">
      <div class="review-video-card">
        <div class="review-video-stage">
          <video v-if="reviewUrl" :src="reviewUrl" controls playsinline />
          <span class="video-chip">刚刚录制 · {{ secondsToClock(Math.max(elapsed, 12)) }}</span>
        </div>
      </div>
      <aside class="review-summary">
        <span class="success-kicker"><Sparkles :size="17" /> 已保存到本地</span>
        <h2>接下来，交给剪辑台。</h2>
        <p>系统会自动去掉停顿与重复表达，再加上适合口播的节奏字幕。</p>
        <div class="review-coach-metrics">
          <span><small>平均语速</small><strong>{{ coachPace || '—' }} 字/分</strong></span>
          <span><small>有效停顿</small><strong>{{ coachPauseCount }} 次</strong></span>
          <span><small>镜头注视</small><strong>{{ coachEyeContact || '—' }}{{ coachEyeContact ? '%' : '' }}</strong></span>
        </div>
        <div class="review-flow"><span class="is-done"><Check :size="13" /> 想法</span><i /><span class="is-done"><Check :size="13" /> 口播稿</span><i /><span class="is-done"><Check :size="13" /> 录制</span><i /><span>剪辑</span></div>
        <button class="primary-button large-button" type="button" @click="handoffToEdit">一键去剪辑 <ArrowRight :size="18" /></button>
        <button class="secondary-button large-button" type="button" @click="rerecord"><RotateCcw :size="17" /> 重新录制</button>
        <button class="secondary-button large-button" type="button" @click="startNewSpeakSession"><Plus :size="17" /> 新口播</button>
        <button class="text-button" type="button" @click="copyDraft"><Copy :size="15" /> 保存口播稿</button>
      </aside>
    </div>
    <ToastMessage :message="toast" />
  </section>

  <section v-else class="workspace-page record-page">
    <div class="page-heading reveal">
      <div>
        <span class="eyebrow"><MessageCircleMore :size="15" /> 口播助手 <img v-if="currentTheme === 'memphis'" class="memphis-sticker eyebrow-sticker" src="/memphis-icons/chat-line.png" alt="" width="18" height="18"></span>
        <h1>先聊明白，再开口录。</h1>
        <p>说说你想讲什么，助手会陪你把它变成一篇能直接念的口播稿。</p>
      </div>
      <div class="record-heading-actions">
        <button class="secondary-button new-speak-button" type="button" @click="startNewSpeakSession">
          <Plus :size="16" /> 新口播
        </button>
        <div class="record-flow-indicator" aria-label="口播创作流程"><span class="is-current">1 聊想法</span><i /><span>2 成稿</span><i /><span>3 录制</span></div>
      </div>
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
            <div>
              <strong>Moon 助手</strong>
              <small><span class="status-dot" :class="{ amber: isThinking }" /> {{ isThinking ? '正在调用真实模型' : lastResponseModel ? `${lastResponseModel} · 真实响应` : '真实模型等待输入' }}</small>
            </div>
          </div>
          <div class="panel-header-actions">
            <button class="text-button new-speak-inline" type="button" :disabled="isThinking" @click="startNewSpeakSession">
              <Plus :size="14" /> 新口播
            </button>
            <span class="context-pill">懂口播节奏</span>
          </div>
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
            <span class="message-avatar"><Sparkles :size="15" /></span><p><span>正在分析你的主题</span><i /><i /><i /></p>
          </div>
          <div v-if="assistantError && !isThinking" class="chat-model-error" role="alert">
            <strong>真实模型暂时没有返回结果</strong>
            <p>{{ assistantError }}</p>
            <button v-if="lastFailedMessage" type="button" @click="retryDialogue"><RotateCcw :size="14" /> 重试本次对话</button>
          </div>
          <div v-if="suggestionOptions.length === 3 && !isThinking" class="suggestion-block">
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
              <button type="button" @click="refreshSuggestions"><RotateCcw :size="14" /> 真实换一组</button>
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
          <span class="script-metrics">{{ characterCount ? `约 ${estimatedSeconds} 秒 · ${characterCount} 字` : '等待模型成稿' }}</span>
        </div>
        <div class="polish-tools" aria-label="稿件润色工具">
          <span><Sparkles :size="15" /> 快速润色</span>
          <button type="button" :disabled="!draft.trim() || isThinking" @click="polishDraft('oral')"><MessageCircleMore :size="14" /> 更口语</button>
          <button type="button" :disabled="!draft.trim() || isThinking" @click="polishDraft('short')"><Scissors :size="14" /> 再精简</button>
          <button type="button" :disabled="!draft.trim() || isThinking" @click="polishDraft('emotional')"><Heart :size="14" /> 更有感染力</button>
        </div>
        <div class="script-editor-wrap">
          <span class="quote-mark">“</span>
          <textarea v-model="draft" class="script-editor" aria-label="编辑口播稿" placeholder="先在左侧告诉 Moon 你想讲什么。选择建议后，真实模型生成的口播稿会出现在这里。" />
        </div>
        <div class="script-footer">
          <p><Check :size="14" /> {{ draft.trim() ? '已自动保存到当前账户' : '等待真实模型生成稿件' }}</p>
          <div>
            <button class="copy-button" type="button" @click="copyDraft"><Copy :size="16" /> 复制稿件</button>
            <button class="primary-button" type="button" :disabled="!draft.trim()" @click="enterTeleprompter">进入提词录制 <ArrowRight :size="17" /></button>
          </div>
        </div>
      </section>
    </div>
    <ToastMessage :message="toast" />
  </section>
</template>
