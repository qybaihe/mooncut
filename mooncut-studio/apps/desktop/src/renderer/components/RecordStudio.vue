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
import { useSpeakingCoach } from '../composables/useSpeakingCoach'
import { useTheme } from '../composables/useTheme'
import { getMooncut } from '../composables/useMooncut'
import ToastMessage from './ToastMessage.vue'

const { currentTheme } = useTheme()
const assetUrl = (path: string) => `${import.meta.env.BASE_URL || './'}${path.replace(/^\//, '')}`

type StudioMode = 'compose' | 'teleprompter' | 'review'
type RecordState = 'idle' | 'countdown' | 'recording' | 'paused'
type CameraStatus = 'requesting' | 'live' | 'error'
type ChatMessage = { id: number; role: 'assistant' | 'user'; content: string }
type PetAnimationState = 'idle' | 'running' | 'waving' | 'jumping' | 'failed' | 'waiting' | 'review'
type ScriptSuggestion = { eyebrow: string; title: string; detail: string }
export type StudioRecordingAsset = {
  name: string
  sizeLabel: string
  url?: string
  file?: Blob
  source: 'recording'
  mediaAssetId?: string
  absolutePath?: string
}

const props = defineProps<{
  /** Stable local identity for draft storage (no account). */
  userKey?: string
  projectId?: string
  projectName?: string
}>()
const emit = defineEmits<{
  'send-to-edit': [asset: StudioRecordingAsset]
  'mode-change': [mode: StudioMode]
  'pet-state': [state: PetAnimationState]
  'pet-message': [message: string]
  'saved-to-project': [payload: { mediaAssetId: string; absolutePath: string }]
}>()

const quickTopics = ['讲一个知识点', '做产品介绍', '分享个人经历', '表达一个观点']
const initialMessage: ChatMessage = {
  id: 1,
  role: 'assistant',
  content: '先告诉我：这条口播，你最想让观众记住什么？我会陪你把想法一步步变成能直接念的稿子。',
}

const storageScope = encodeURIComponent((props.userKey || props.projectId || 'local').toLowerCase())
const messagesStorageKey = `mooncut-studio:messages:${storageScope}`
const draftStorageKey = `mooncut-studio:draft:${storageScope}`
const modelStorageKey = `mooncut-studio:assistant-model:${storageScope}`

async function requestScriptAssistant(payload: {
  action?: 'guide' | 'generate' | 'polish'
  style?: 'oral' | 'short' | 'emotional'
  messages: Array<{ role: 'assistant' | 'user'; content: string }>
  draft?: string
}) {
  return getMooncut().assistantScript(payload) as Promise<{
    reply: string
    phase: string
    ready: boolean
    draft: string
    petMessage: string
    suggestions: ScriptSuggestion[]
    model: string
  }>
}

async function requestCoachAdvice(payload: {
  transcript: string
  currentScript: string
  currentSentence: string
  lastAdvice?: string
  metrics: {
    pace: number
    wordCount: number
    volume: number
    pauseCount: number
    eyeContact?: number
    elapsedSeconds: number
  }
}) {
  return getMooncut().assistantCoach(payload) as Promise<{
    category: string
    advice: string
    petMessage: string
    positive: boolean
    model: string
  }>
}

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
  start: startCoach,
  stop: stopCoach,
  reset: resetCoach,
} = useSpeakingCoach(draft)
const toast = ref('')
const cameraStatus = ref<CameraStatus>('requesting')
const cameraError = ref('')
const recordState = ref<RecordState>('idle')
const countdown = ref<number | null>(null)
const elapsed = ref(0)
const fontSize = ref(34)
const scrollSpeed = ref(3)
const mirror = ref(true)
const reviewUrl = ref<string | null>(null)
const recordedMime = ref('video/webm')
const recordedBlob = ref<Blob | null>(null)
const liveAdvice = ref('看镜头，按自己的节奏开始。')
const liveAdviceCategory = ref('steady')
const liveAdvicePositive = ref(true)
const liveAdviceModel = ref('本地实时分析')

const chatEndRef = ref<HTMLDivElement | null>(null)
const cameraVideoRef = ref<HTMLVideoElement | null>(null)
let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
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

const characterCount = computed(() => draft.value.replace(/\s/g, '').length)
const estimatedSeconds = computed(() => characterCount.value ? Math.max(8, Math.round(characterCount.value / 4.1)) : 0)
const sentences = computed(() => draft.value.split(/(?<=[。！？])/).map((sentence) => sentence.trim()).filter(Boolean))
const timedSentence = computed(() => {
  if (!sentences.value.length) return 0
  return Math.min(sentences.value.length - 1, Math.floor(elapsed.value / Math.max(3, 9 - scrollSpeed.value)))
})
const currentSentence = computed(() => {
  if ((recordState.value === 'recording' || recordState.value === 'paused') && coachTranscript.value) return coachSentenceIndex.value
  return timedSentence.value
})
const previousSentenceText = computed(() => sentences.value[Math.max(0, currentSentence.value - 1)] ?? '')
const currentSentenceText = computed(() => sentences.value[currentSentence.value] ?? '准备好后，从第一句自然开口。')
const nextSentenceText = computed(() => sentences.value[Math.min(sentences.value.length - 1, currentSentence.value + 1)] ?? '')
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

function stopCamera() {
  cameraRequestId += 1
  stream?.getTracks().forEach((track) => {
    track.onended = null
    track.stop()
  })
  stream = null
  if (cameraVideoRef.value) cameraVideoRef.value.srcObject = null
}

function cameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) return '摄像头连接失败，请重新连接。'
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    return '摄像头或麦克风权限未开启。请在系统设置 → 隐私与安全性中允许 MoonCut Studio 使用摄像头/麦克风，然后重新连接。'
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return '没有检测到可用的摄像头或麦克风，请检查设备连接。'
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return '摄像头可能正被其他应用占用。关闭占用它的应用后重新连接。'
  }
  if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
    return '当前摄像头不支持所需的视频参数，请重新连接。'
  }
  if (error.name === 'SecurityError') return '系统阻止了摄像头访问，请检查隐私权限后重试。'
  return `摄像头连接失败（${error.name}），请重新连接。`
}

async function waitForVideoPlayback(video: HTMLVideoElement) {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new DOMException('Camera preview timed out', 'NotReadableError')), 10_000)
      const ready = () => {
        window.clearTimeout(timer)
        video.removeEventListener('error', failed)
        resolve()
      }
      const failed = () => {
        window.clearTimeout(timer)
        video.removeEventListener('loadedmetadata', ready)
        reject(video.error ?? new DOMException('Camera preview failed', 'NotReadableError'))
      }
      video.addEventListener('loadedmetadata', ready, { once: true })
      video.addEventListener('error', failed, { once: true })
    })
  }
  await video.play()
  if (!video.videoWidth || !video.videoHeight) {
    throw new DOMException('Camera returned no video frames', 'NotReadableError')
  }
}

async function openCamera() {
  stopCamera()
  const requestId = ++cameraRequestId
  cameraStatus.value = 'requesting'
  cameraError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.value = 'error'
    cameraError.value = '当前浏览器不支持摄像头录制，请使用最新版 Chrome、Edge 或 Safari。'
    return
  }
  let requestedStream: MediaStream | null = null
  try {
    requestedStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    if (requestId !== cameraRequestId) {
      requestedStream.getTracks().forEach((track) => track.stop())
      return
    }
    const videoTrack = requestedStream.getVideoTracks()[0]
    const audioTrack = requestedStream.getAudioTracks()[0]
    if (!videoTrack || videoTrack.readyState !== 'live') throw new DOMException('No live camera track', 'NotReadableError')
    if (!audioTrack || audioTrack.readyState !== 'live') throw new DOMException('No live microphone track', 'NotReadableError')
    stream = requestedStream
    await nextTick()
    const video = cameraVideoRef.value
    if (!video) throw new DOMException('Camera preview is unavailable', 'NotReadableError')
    video.srcObject = stream
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
  } catch (error) {
    requestedStream?.getTracks().forEach((track) => track.stop())
    if (requestId === cameraRequestId) {
      stream = null
      if (cameraVideoRef.value) cameraVideoRef.value.srcObject = null
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
    if (response.suggestions.length !== 3) throw new Error('模型没有返回完整的三条创作建议')
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      content: response.reply,
    })
    suggestionOptions.value = response.suggestions.map((suggestion, index) => ({
      ...suggestion,
      icon: [Zap, Lightbulb, ArrowRight][index] ?? Sparkles,
    }))
    selectedSuggestions.value = new Set([0])
    lastResponseModel.value = response.model
    lastFailedMessage.value = ''
    if (response.draft) {
      draft.value = response.draft
      mobilePanel.value = 'draft'
    }
    emit('pet-message', response.petMessage)
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
    if (response.draft) draft.value = response.draft
    else throw new Error('模型没有返回完整稿件')
    messages.value.push({ id: Date.now(), role: 'assistant', content: response.reply })
    lastResponseModel.value = response.model
    emit('pet-message', response.petMessage)
    mobilePanel.value = 'draft'
    toast.value = `${response.model} 已整理成完整口播稿`
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
    if (!response.draft) throw new Error('模型没有返回润色稿')
    draft.value = response.draft
    lastResponseModel.value = response.model
    emit('pet-message', response.petMessage)
    const result = style === 'oral' ? '调得更口语' : style === 'short' ? '精简了重复信息' : '加强了感染力'
    toast.value = `${response.model} 已${result}`
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
    liveAdvice.value = response.advice
    liveAdviceCategory.value = response.category
    liveAdvicePositive.value = response.positive
    liveAdviceModel.value = response.model
    emit('pet-message', response.petMessage)
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
  const hasLiveStream = cameraStatus.value === 'live' && stream?.getVideoTracks().some((track) => track.readyState === 'live') && stream?.getAudioTracks().some((track) => track.readyState === 'live')
  if (!hasLiveStream || typeof MediaRecorder === 'undefined') {
    countdown.value = null
    recordState.value = 'idle'
    cameraStatus.value = 'error'
    cameraError.value = typeof MediaRecorder === 'undefined'
      ? '当前浏览器不支持视频录制，请使用最新版 Chrome、Edge 或 Safari。'
      : '摄像头或麦克风尚未就绪，请重新连接后再录制。'
    return
  }
  try {
    const mimeType = selectMimeType()
    recorder = mimeType ? new MediaRecorder(stream!, { mimeType }) : new MediaRecorder(stream!)
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
  void startCoach(stream!, cameraVideoRef.value)
  startCoachAdviceTimer()
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
  await nextTick()
  await openCamera()
}

async function handoffToEdit() {
  if (!reviewUrl.value || !recordedBlob.value) {
    toast.value = '没有可交给剪辑台的真实录制文件'
    return
  }
  const blob = recordedBlob.value
  const filename = `${props.projectName || '口播录制'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${recordingExtension.value}`
  try {
    if (props.projectId) {
      toast.value = '正在保存录制到项目…'
      const buffer = await blob.arrayBuffer()
      const saved = await getMooncut().mediaSaveRecording({
        projectId: props.projectId,
        filename,
        bytes: buffer,
        mimeType: recordedMime.value,
      }) as {
        asset: { id: string; absolutePath: string; filename: string }
        previewUrl: string
      }
      handedOff = true
      emit('saved-to-project', {
        mediaAssetId: saved.asset.id,
        absolutePath: saved.asset.absolutePath,
      })
      emit('send-to-edit', {
        name: saved.asset.filename,
        sizeLabel: '已写入项目 recordings/',
        url: saved.previewUrl,
        file: blob,
        source: 'recording',
        mediaAssetId: saved.asset.id,
        absolutePath: saved.asset.absolutePath,
      })
      toast.value = '录制已保存到项目，可直接去剪辑台'
    } else {
      handedOff = true
      emit('send-to-edit', {
        name: filename,
        sizeLabel: '本地录制 · 已就绪',
        url: reviewUrl.value ?? undefined,
        file: blob,
        source: 'recording',
      })
    }
    reviewUrl.value = null
    mode.value = 'compose'
  } catch (error) {
    toast.value = error instanceof Error ? `保存失败：${error.message}` : '保存录制失败'
  }
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
  stopElapsedTimer()
  stopCoachAdviceTimer()
  stopCoach()
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
          {{ cameraStatus === 'live' ? '镜头已就绪' : cameraStatus === 'requesting' ? '等待摄像头权限' : '镜头未连接' }}
        </template>
      </div>
      <span class="teleprompter-brand">MOONCUT <img v-if="currentTheme === 'memphis'" class="memphis-sticker brand-sticker" :src="assetUrl('memphis-icons/camera-line.png')" alt="" width="16" height="16">✦</span>
    </div>

    <div class="teleprompter-layout">
      <div class="camera-stage" :class="{ 'is-mirrored': mirror, 'is-coaching': recordState === 'recording' || recordState === 'paused' }">
        <video ref="cameraVideoRef" class="camera-video" :class="{ 'is-visible': cameraStatus === 'live' }" autoplay muted playsinline />
        <div v-if="cameraStatus !== 'live'" class="camera-fallback camera-connection-state">
          <template v-if="cameraStatus === 'requesting'">
            <LoaderCircle class="camera-loader" :size="28" />
            <strong>正在连接摄像头和麦克风</strong>
            <p>如果浏览器弹出权限提示，请选择“允许”。授权完成前这里会一直等待。</p>
          </template>
          <template v-else>
            <span class="camera-error-icon"><Video :size="28" /></span>
            <strong>暂时没有真实画面</strong>
            <p>{{ cameraError }}</p>
            <button type="button" @click="openCamera"><RotateCcw :size="15" /> 重新连接摄像头</button>
          </template>
        </div>
        <div class="camera-vignette" />
        <div v-if="recordState === 'recording' || recordState === 'paused'" class="live-script-ribbon" aria-live="polite">
          <div class="live-script-meta"><span><Sparkles :size="13" /> 实时对稿</span><em>{{ coachSpeechStatus }}</em></div>
          <p>{{ previousSentenceText }}</p>
          <strong>{{ currentSentenceText }}</strong>
          <p>{{ nextSentenceText }}</p>
        </div>
        <div class="teleprompter-copy" :style="{ fontSize: `${fontSize}px` }">
          <span
            v-for="(sentence, index) in sentences"
            :key="`${sentence}-${index}`"
            :class="{ 'is-current': index === currentSentence, 'is-past': index < currentSentence }"
          >{{ sentence }}</span>
        </div>
        <div v-if="recordState === 'recording' || recordState === 'paused'" :key="liveAdvice" class="live-coach-advice" :class="[`category-${liveAdviceCategory}`, { 'is-positive': liveAdvicePositive }]" aria-live="polite">
          <span><Bot :size="16" /></span>
          <div><small>{{ liveAdviceModel }}</small><strong>{{ liveAdvice }}</strong></div>
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
          <p>{{ visibleCoachTranscript || '正在等你开口，实时识别结果会显示在这里。' }}</p>
        </div>
        <div v-if="recordState === 'countdown' && countdown !== null" class="countdown-overlay" aria-live="assertive">
          <strong>{{ countdown || '开始' }}</strong>
        </div>
      </div>

      <aside class="prompt-controls">
        <div class="controls-heading">
          <span class="mini-label">{{ recordState === 'recording' || recordState === 'paused' ? '实时陪练' : '提词设置' }}</span><h2>{{ recordState === 'recording' || recordState === 'paused' ? '小月正在听你说。' : '看镜头，慢慢说。' }}</h2><p>{{ recordState === 'recording' || recordState === 'paused' ? `${coachVisionStatus} · ${coachSpeechStatus}` : '稿子会按你的设置推进，录制后可以直接送去剪辑。' }}</p>
        </div>
        <div v-if="recordState === 'recording' || recordState === 'paused'" class="coach-side-summary">
          <span>当前台词</span>
          <strong>{{ currentSentenceText }}</strong>
          <p>{{ liveAdvice }}</p>
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
        <button v-if="recordState === 'idle'" class="record-button" type="button" aria-label="3 秒后开始录制" :disabled="cameraStatus !== 'live'" @click="startRecording">
          <span><Circle :size="18" fill="currentColor" /></span>{{ cameraStatus === 'live' ? '3 秒后开始录制' : cameraStatus === 'requesting' ? '等待镜头权限…' : '请先重新连接镜头' }}
        </button>
        <button v-else-if="recordState === 'countdown'" class="record-button" type="button" disabled><TimerReset :size="19" /> 准备好，看镜头</button>
        <div v-else class="live-controls">
          <button type="button" @click="pauseRecording">
            <Play v-if="recordState === 'paused'" :size="18" /><Pause v-else :size="18" />{{ recordState === 'paused' ? '继续' : '暂停' }}
          </button>
          <button class="finish-button" type="button" @click="finishRecording"><Square :size="16" fill="currentColor" /> 完成录制</button>
        </div>
        <p v-if="cameraStatus === 'error'" class="camera-note">录制只会使用真实摄像头和麦克风，不会进入演示模式。</p>
      </aside>
    </div>
    <ToastMessage :message="toast" />
  </section>

  <section v-else-if="mode === 'review'" class="workspace-page review-page reveal">
    <div class="page-heading compact-heading">
      <div><span class="eyebrow"><Check :size="15" /> 录制完成 <img v-if="currentTheme === 'memphis'" class="memphis-sticker eyebrow-sticker" :src="assetUrl('memphis-icons/record-line.png')" alt="" width="18" height="18"></span><h1>这一遍，很自然。</h1><p>预览一下，满意就直接交给智能剪辑。</p></div>
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
        <button class="text-button" type="button" @click="copyDraft"><Copy :size="15" /> 保存口播稿</button>
      </aside>
    </div>
    <ToastMessage :message="toast" />
  </section>

  <section v-else class="workspace-page record-page record-page--assistant">
    <div class="page-heading reveal record-compose-heading">
      <div>
        <span class="eyebrow"><MessageCircleMore :size="15" /> 口播助手 <img v-if="currentTheme === 'memphis'" class="memphis-sticker eyebrow-sticker" :src="assetUrl('memphis-icons/chat-line.png')" alt="" width="18" height="18"></span>
        <h1>先聊明白，再开口录。</h1>
        <p>说说你想讲什么，助手会陪你变成一篇能直接念的口播稿。</p>
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
            <div>
              <strong>Moon 助手</strong>
              <small><span class="status-dot" :class="{ amber: isThinking }" /> {{ isThinking ? '正在调用真实模型' : lastResponseModel ? `${lastResponseModel} · 真实响应` : '真实模型等待输入' }}</small>
            </div>
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
