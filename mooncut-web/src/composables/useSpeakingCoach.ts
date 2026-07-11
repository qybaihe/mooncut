import { computed, ref, type Ref } from 'vue'

// MediaPipe is heavy and only used inside the recording room. Load it lazily so
// visitors browsing the landing/pricing/community pages never pay for it.
type FaceLandmarkerModule = typeof import('@mediapipe/tasks-vision')
type FaceLandmarker = Awaited<
  ReturnType<FaceLandmarkerModule['FaceLandmarker']['createFromOptions']>
>

type AdviceCategory = 'pace' | 'volume' | 'pause' | 'script' | 'camera' | 'steady'

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string; message?: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const speakable = (value: string) =>
  Array.from(value)
    .filter((character) => /[\u3400-\u9fffA-Za-z0-9]/.test(character))
    .join('')
const smoothingAlpha = (deltaMs: number, timeConstantMs: number) =>
  1 - Math.exp(-Math.max(0, deltaMs) / timeConstantMs)
const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const bigrams = (value: string) => {
  const result = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2))
  return result
}
const resultIsStable = (results: SpeechRecognitionResultList) =>
  results.length > 0 && results[results.length - 1]?.isFinal === true

const assetUrl = (path: string) => {
  if (typeof window === 'undefined') return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${normalized}`
}

/** Map spoken character count → sentence index by cumulative script length. */
export function resolveIndexFromCharacterCount(characters: number, sentenceList: string[]) {
  if (!sentenceList.length) return 0
  if (characters <= 0) return 0
  let cumulative = 0
  for (let index = 0; index < sentenceList.length; index += 1) {
    const len = Math.max(1, speakable(sentenceList[index]).length)
    // Advance once the speaker has roughly finished this line (~80%).
    // Too low a threshold makes partial ASR jump early and freeze the feel of "stuck".
    if (characters < cumulative + len * 0.8) return index
    cumulative += len
  }
  return sentenceList.length - 1
}

export function resolveSpokenSentenceIndex(transcript: string, sentenceList: string[], currentIndex = 0) {
  if (!sentenceList.length) return 0
  const spoken = speakable(transcript)
  if (!spoken) return currentIndex
  // Primary: progress by spoken length through the script.
  const byLength = resolveIndexFromCharacterCount(spoken.length, sentenceList)
  // Secondary: fuzzy match last chunk to a nearby sentence (handles ASR reorder).
  const tailPairs = bigrams(spoken.slice(-28))
  let bestIndex = currentIndex
  let bestScore = 0
  const from = Math.max(0, currentIndex - 1)
  const to = Math.min(sentenceList.length - 1, currentIndex + 2)
  for (let index = from; index <= to; index += 1) {
    const pairs = bigrams(speakable(sentenceList[index]))
    const score = Array.from(tailPairs).filter((pair) => pairs.has(pair)).length
    if (score > bestScore || (score === bestScore && score > 0 && index > bestIndex)) {
      bestIndex = index
      bestScore = score
    }
  }
  const fuzzy = bestScore >= 2 ? bestIndex : byLength
  // Never jump backwards; take the furthest credible progress.
  return clamp(Math.max(currentIndex, byLength, fuzzy), 0, sentenceList.length - 1)
}

/** Shared warm cache so enter-teleprompter can preload before recording. */
let sharedVisionFileset: Awaited<
  ReturnType<FaceLandmarkerModule['FilesetResolver']['forVisionTasks']>
> | null = null
let sharedFaceLandmarker: FaceLandmarker | null = null
let visionWarmPromise: Promise<FaceLandmarker | null> | null = null
let visionWarmError = ''

export async function warmFaceLandmarker(): Promise<{ ok: boolean; detail: string }> {
  if (sharedFaceLandmarker) return { ok: true, detail: 'cached' }
  if (visionWarmPromise) {
    const marker = await visionWarmPromise
    return marker
      ? { ok: true, detail: 'ready' }
      : { ok: false, detail: visionWarmError || 'load failed' }
  }

  visionWarmPromise = (async () => {
    try {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const wasmBase = assetUrl('/mediapipe')
      const modelPath = assetUrl('/models/face_landmarker.task')

      // Fail fast if CF/static deploy is missing assets (shows as HTML SPA fallback).
      const [wasmProbe, modelProbe] = await Promise.all([
        fetch(`${wasmBase}/vision_wasm_internal.wasm`, { method: 'HEAD', cache: 'force-cache' }).catch(
          () => null,
        ),
        fetch(modelPath, { method: 'HEAD', cache: 'force-cache' }).catch(() => null),
      ])
      if (modelProbe && !modelProbe.ok) {
        visionWarmError = `模型文件 HTTP ${modelProbe.status}`
        return null
      }
      if (wasmProbe && !wasmProbe.ok) {
        visionWarmError = `WASM 文件 HTTP ${wasmProbe.status}`
        return null
      }

      sharedVisionFileset = await FilesetResolver.forVisionTasks(wasmBase)
      const base = {
        runningMode: 'VIDEO' as const,
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      }
      try {
        sharedFaceLandmarker = await FaceLandmarker.createFromOptions(sharedVisionFileset, {
          ...base,
          baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
        })
      } catch (gpuError) {
        // Safari / older GPUs often reject WebGL delegate — CPU is fine for 10fps gaze.
        console.warn('[mooncut] FaceLandmarker GPU failed, falling back to CPU', gpuError)
        sharedFaceLandmarker = await FaceLandmarker.createFromOptions(sharedVisionFileset, {
          ...base,
          baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
        })
      }
      visionWarmError = ''
      return sharedFaceLandmarker
    } catch (error) {
      visionWarmError = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)
      console.warn('[mooncut] FaceLandmarker warm-up failed', error)
      sharedFaceLandmarker = null
      visionWarmPromise = null // allow a later retry (e.g. after network recovery)
      return null
    }
  })()

  const marker = await visionWarmPromise
  return marker
    ? { ok: true, detail: 'ready' }
    : { ok: false, detail: visionWarmError || 'load failed' }
}

export function useSpeakingCoach(script: Ref<string>) {
  const pace = ref(0)
  const volume = ref(0)
  const wordCount = ref(0)
  const pauseCount = ref(0)
  const eyeContact = ref(0)
  const transcriptFinal = ref('')
  const transcriptInterim = ref('')
  const speechStatus = ref('等待本地 ASR')
  const visionStatus = ref('等待视觉分析')
  const localAdvice = ref('看镜头，按自己的节奏开始。')
  const adviceCategory = ref<AdviceCategory>('steady')
  const advicePositive = ref(true)
  const stableSentenceIndex = ref(0)

  let active = false
  let recognition: BrowserSpeechRecognition | null = null
  let recognitionRestartTimer: number | null = null
  /** deepgram = cloud primary; asr = browser Web Speech; acoustic = energy-only */
  let recognitionMode: 'deepgram' | 'asr' | 'acoustic' = 'acoustic'
  let asrStarted = false
  let asrResultCount = 0
  let audioContext: AudioContext | null = null
  let audioFrame = 0
  let visionFrame = 0
  let faceLandmarker: FaceLandmarker | null = null
  let ownsLandmarker = false
  let lastAudioFrame = 0
  let lastUiUpdate = 0
  let speechActiveMs = 0
  let uninterruptedSpeechMs = 0
  let silenceStartedAt = 0
  let wasSpeaking = false
  let hasSpoken = false
  let noiseFloor = 0.008
  let envelopeRms = 0
  let displayVolume = 0
  let smoothedPace = 0
  let syllablePeaks = 0
  let peakArmed = true
  let lastPeakAt = 0
  let lowVolumeSince = 0
  let lastVisionRun = 0
  let gazeWindow: boolean[] = []
  let noFaceSince = 0
  let offCameraSince = 0
  let lastAdviceAt = 0
  let lastRecognizedCharacters = 0
  let recognizedTimeline: Array<{ at: number; characters: number }> = []
  let paceSamples: number[] = []
  let lastDeliveryAdviceAt = 0
  let lastSentenceBumpAt = 0
  let deepgramActive = false
  let deepgramBusy = false
  let deepgramCtx: AudioContext | null = null
  let deepgramProcessor: ScriptProcessorNode | null = null
  let deepgramSource: MediaStreamAudioSourceNode | null = null
  let deepgramSamples: Float32Array[] = []
  let deepgramSampleCount = 0
  let deepgramInputRate = 48000
  const DEEPGRAM_TARGET_RATE = 16_000
  const DEEPGRAM_CHUNK_SECONDS = 1.6
  const cooldowns: Record<string, number> = {}

  const DELIVERY_TIPS: Array<{ id: string; text: string; category: AdviceCategory }> = [
    { id: 'hook-conflict', text: '下一句可以先抛冲突：很多人以为…其实…', category: 'script' },
    { id: 'hook-secret', text: '像跟朋友讲秘密一样，把语气压低再抬起来。', category: 'script' },
    { id: 'energy-up', text: '这句把情绪拉高一点，让观众停住滑手。', category: 'volume' },
    { id: 'punch-pause', text: '重点词后面停半拍，冲突感会更强。', category: 'pause' },
    { id: 'why-care', text: '补一句「这关你什么事」，观众才愿意听下去。', category: 'script' },
    { id: 'scene-first', text: '先甩一个画面再讲观点，比直接说理更抓人。', category: 'script' },
    { id: 'slow-land', text: '收尾放慢，把那句金句钉在观众脑子里。', category: 'pace' },
    { id: 'smile-voice', text: '嘴角带一点笑，声音会更有温度。', category: 'steady' },
  ]

  const transcript = computed(() => `${transcriptFinal.value}${transcriptInterim.value}`.trim())
  const sentences = computed(() =>
    script.value
      .split(/(?<=[。！？!?])/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
  const activeSentenceIndex = computed(() =>
    clamp(stableSentenceIndex.value, 0, Math.max(0, sentences.value.length - 1)),
  )

  function emitLocalAdvice(
    id: string,
    category: AdviceCategory,
    text: string,
    positive = false,
    priority = 50,
  ) {
    const now = Date.now()
    if ((cooldowns[id] ?? 0) > now || now - lastAdviceAt < 7000) return
    if (!positive && advicePositive.value === false && priority < 70) return
    cooldowns[id] = now + 22_000
    lastAdviceAt = now
    localAdvice.value = text
    adviceCategory.value = category
    advicePositive.value = positive
  }

  function reset() {
    pace.value = 0
    volume.value = 0
    wordCount.value = 0
    pauseCount.value = 0
    eyeContact.value = 0
    transcriptFinal.value = ''
    transcriptInterim.value = ''
    speechStatus.value = '正在启动本地 ASR…'
    visionStatus.value = '正在加载注视模型…'
    localAdvice.value = '看镜头，按自己的节奏开始。'
    adviceCategory.value = 'steady'
    advicePositive.value = true
    stableSentenceIndex.value = 0
    lastAudioFrame = performance.now()
    lastUiUpdate = 0
    speechActiveMs = 0
    uninterruptedSpeechMs = 0
    silenceStartedAt = 0
    wasSpeaking = false
    hasSpoken = false
    noiseFloor = 0.008
    envelopeRms = 0
    displayVolume = 0
    smoothedPace = 0
    syllablePeaks = 0
    peakArmed = true
    lastPeakAt = 0
    lowVolumeSince = 0
    lastVisionRun = 0
    gazeWindow = []
    noFaceSince = 0
    offCameraSince = 0
    lastAdviceAt = 0
    lastRecognizedCharacters = 0
    recognizedTimeline = []
    paceSamples = []
    lastDeliveryAdviceAt = 0
    lastSentenceBumpAt = 0
    deepgramActive = false
    deepgramBusy = false
    deepgramSamples = []
    deepgramSampleCount = 0
    asrStarted = false
    asrResultCount = 0
    recognitionMode = 'acoustic'
    Object.keys(cooldowns).forEach((key) => delete cooldowns[key])
  }

  function downsampleTo16k(input: Float32Array, fromRate: number): Float32Array {
    if (fromRate === DEEPGRAM_TARGET_RATE) return input
    const ratio = fromRate / DEEPGRAM_TARGET_RATE
    const outLen = Math.max(1, Math.floor(input.length / ratio))
    const out = new Float32Array(outLen)
    for (let i = 0; i < outLen; i += 1) {
      out[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0
    }
    return out
  }

  function floatToLinear16(input: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(input.length * 2)
    const view = new DataView(buffer)
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0))
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
    return buffer
  }

  function mergeChunkText(existing: string, chunk: string) {
    const next = chunk.trim()
    if (!next) return existing
    if (!existing) return next
    if (existing.endsWith(next)) return existing
    // Overlap-aware append: if chunk starts with the tail of existing, only add the new part.
    const tail = existing.slice(-Math.min(existing.length, next.length + 8))
    for (let overlap = Math.min(tail.length, next.length); overlap >= 2; overlap -= 1) {
      if (tail.slice(-overlap) === next.slice(0, overlap)) {
        return `${existing}${next.slice(overlap)}`
      }
    }
    const needSpace = !/[\s，。！？、]$/u.test(existing) && !/^[，。！？、]/.test(next)
    return needSpace ? `${existing} ${next}` : `${existing}${next}`
  }

  function ingestCloudTranscript(text: string, confidence: number | null) {
    if (!active || !text.trim()) return
    recognitionMode = 'deepgram'
    asrResultCount += 1
    transcriptFinal.value = mergeChunkText(transcriptFinal.value, text)
    transcriptInterim.value = ''
    const characters = speakable(transcriptFinal.value).length
    if (characters > lastRecognizedCharacters) {
      lastRecognizedCharacters = characters
      const now = performance.now()
      recognizedTimeline.push({ at: now, characters })
      while (recognizedTimeline.length > 2 && recognizedTimeline[1].at < now - 12_000) {
        recognizedTimeline.shift()
      }
    }
    const asrIndex = resolveSpokenSentenceIndex(
      transcriptFinal.value,
      sentences.value,
      stableSentenceIndex.value,
    )
    if (asrIndex > stableSentenceIndex.value) {
      stableSentenceIndex.value = asrIndex
      lastSentenceBumpAt = performance.now()
    }
    bumpSentenceFromProgress(characters)
    const conf =
      typeof confidence === 'number' && confidence > 0 ? ` · ${(confidence * 100).toFixed(0)}%` : ''
    speechStatus.value = `Deepgram 跟读${conf}`
  }

  async function flushDeepgramChunk() {
    if (!active || !deepgramActive || deepgramBusy || deepgramSampleCount < DEEPGRAM_TARGET_RATE * 0.6) {
      return
    }
    // Concatenate Float32 chunks then downsample + encode.
    const merged = new Float32Array(deepgramSampleCount)
    let offset = 0
    for (const part of deepgramSamples) {
      merged.set(part, offset)
      offset += part.length
    }
    deepgramSamples = []
    deepgramSampleCount = 0

    const pcm = downsampleTo16k(merged, deepgramInputRate)
    // Skip near-silence to save quota
    let energy = 0
    for (let i = 0; i < pcm.length; i += 64) energy += Math.abs(pcm[i] ?? 0)
    if (energy / Math.max(1, pcm.length / 64) < 0.008) return

    deepgramBusy = true
    try {
      const { transcribeAudioChunk } = await import('../services/api')
      const result = await transcribeAudioChunk(floatToLinear16(pcm), {
        contentType: 'application/octet-stream',
        encoding: 'linear16',
        sampleRate: DEEPGRAM_TARGET_RATE,
        language: 'zh-CN',
        model: 'nova-2',
      })
      if (result.transcript) ingestCloudTranscript(result.transcript, result.confidence)
      else if (asrResultCount === 0) speechStatus.value = 'Deepgram 聆听中…'
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/ASR_NOT_CONFIGURED|未配置/.test(msg)) {
        deepgramActive = false
        speechStatus.value = speechStatus.value.startsWith('Deepgram')
          ? 'Deepgram 未配置 · 回退本地'
          : speechStatus.value
      } else if (asrResultCount === 0) {
        speechStatus.value = `Deepgram 短暂失败 · ${msg.slice(0, 28)}`
      }
    } finally {
      deepgramBusy = false
    }
  }

  async function startDeepgramCapture(mediaStream: MediaStream) {
    try {
      const { getAsrStatus } = await import('../services/api')
      const status = await getAsrStatus()
      if (!status.configured) {
        speechStatus.value = '云端 ASR 未配置 · 使用本地识别'
        return
      }
    } catch {
      // Still try transcribe — status might 401 offline; record path needs login anyway.
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    try {
      deepgramCtx = new AudioCtx()
      deepgramInputRate = deepgramCtx.sampleRate || 48000
      if (deepgramCtx.state === 'suspended') await deepgramCtx.resume().catch(() => undefined)
      deepgramSource = deepgramCtx.createMediaStreamSource(mediaStream)
      // ScriptProcessor is deprecated but widely supported for PCM taps without Worklet bundling.
      const bufferSize = 4096
      deepgramProcessor = deepgramCtx.createScriptProcessor(bufferSize, 1, 1)
      const chunkTarget = Math.floor(deepgramInputRate * DEEPGRAM_CHUNK_SECONDS)

      deepgramProcessor.onaudioprocess = (event) => {
        if (!active || !deepgramActive) return
        const input = event.inputBuffer.getChannelData(0)
        const copy = new Float32Array(input.length)
        copy.set(input)
        deepgramSamples.push(copy)
        deepgramSampleCount += copy.length
        if (deepgramSampleCount >= chunkTarget && !deepgramBusy) {
          void flushDeepgramChunk()
        }
      }

      deepgramSource.connect(deepgramProcessor)
      deepgramProcessor.connect(deepgramCtx.destination)
      // Mute the tap so we don't hear loopback (gain 0).
      const mute = deepgramCtx.createGain()
      mute.gain.value = 0
      deepgramProcessor.disconnect()
      deepgramSource.connect(deepgramProcessor)
      deepgramProcessor.connect(mute)
      mute.connect(deepgramCtx.destination)

      deepgramActive = true
      recognitionMode = 'deepgram'
      speechStatus.value = 'Deepgram 已连接 · 准实时跟读'
      // Stop browser Web Speech so it cannot steal the status label.
      if (recognition) {
        try {
          recognition.onresult = null
          recognition.onerror = null
          recognition.onend = null
          recognition.onstart = null
          recognition.stop()
        } catch {
          try {
            recognition.abort()
          } catch {
            // ignore
          }
        }
        recognition = null
      }
    } catch (error) {
      console.warn('[mooncut] Deepgram capture failed', error)
      deepgramActive = false
    }
  }

  function stopDeepgramCapture() {
    deepgramActive = false
    try {
      deepgramProcessor?.disconnect()
    } catch {
      // ignore
    }
    try {
      deepgramSource?.disconnect()
    } catch {
      // ignore
    }
    deepgramProcessor = null
    deepgramSource = null
    deepgramSamples = []
    deepgramSampleCount = 0
    if (deepgramCtx) {
      void deepgramCtx.close().catch(() => undefined)
      deepgramCtx = null
    }
  }

  function bumpSentenceFromProgress(spokenChars: number) {
    if (!active || !sentences.value.length) return
    const next = resolveIndexFromCharacterCount(spokenChars, sentences.value)
    if (next > stableSentenceIndex.value) {
      stableSentenceIndex.value = next
      lastSentenceBumpAt = performance.now()
      // Delivery / 语气 tips when the teleprompter advances.
      const now = Date.now()
      if (now - lastDeliveryAdviceAt > 11_000) {
        const tip = DELIVERY_TIPS[next % DELIVERY_TIPS.length]
        emitLocalAdvice(`delivery-${tip.id}-${next}`, tip.category, tip.text, false, 55)
        lastDeliveryAdviceAt = now
      }
    }
  }

  function setAcousticFallback(reason: string) {
    recognitionMode = 'acoustic'
    speechStatus.value = `声学估算 · ${reason}`
  }

  function scheduleRecognitionRestart(delayMs = 280) {
    if (!active) return
    if (recognitionRestartTimer) window.clearTimeout(recognitionRestartTimer)
    recognitionRestartTimer = window.setTimeout(() => {
      recognitionRestartTimer = null
      if (!active || !recognition || recognitionMode !== 'asr') return
      try {
        recognition.start()
      } catch {
        // InvalidStateError when already started — ignore.
      }
    }, delayMs)
  }

  function startRecognition() {
    // When Deepgram is the primary engine, skip browser Web Speech so it cannot
    // overwrite status to「本地 ASR · 已对齐」and confuse the teleprompter.
    if (deepgramActive) return

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      if (!deepgramActive) setAcousticFallback('浏览器不支持 Web Speech')
      return
    }

    // Chrome's Web Speech often needs network (cloud). Fail soft to acoustic.
    try {
      recognition = new Recognition()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        if (!active || deepgramActive) return
        asrStarted = true
        recognitionMode = 'asr'
        speechStatus.value =
          asrResultCount > 0 ? '本地 ASR · 识别中' : '本地 ASR 已启动 · 请开始说话'
      }

      recognition.onresult = (event) => {
        if (!active || deepgramActive) return
        let interim = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const text = result[0]?.transcript ?? ''
          if (result.isFinal) transcriptFinal.value += text
          else interim += text
        }
        transcriptInterim.value = interim
        asrResultCount += 1
        recognitionMode = 'asr'
        const characters = speakable(`${transcriptFinal.value}${interim}`).length
        if (characters > lastRecognizedCharacters) {
          lastRecognizedCharacters = characters
          const now = performance.now()
          recognizedTimeline.push({ at: now, characters })
          while (recognizedTimeline.length > 2 && recognizedTimeline[1].at < now - 12_000) {
            recognizedTimeline.shift()
          }
        }
        const asrIndex = resolveSpokenSentenceIndex(
          `${transcriptFinal.value}${interim}`,
          sentences.value,
          stableSentenceIndex.value,
        )
        if (asrIndex > stableSentenceIndex.value) {
          stableSentenceIndex.value = asrIndex
          lastSentenceBumpAt = performance.now()
        }
        bumpSentenceFromProgress(characters)
        speechStatus.value = resultIsStable(event.results)
          ? '本地 ASR · 已对齐稿件'
          : '本地 ASR · 跟随中'
      }

      recognition.onerror = (event) => {
        if (!active || deepgramActive) return
        const code = event?.error || 'unknown'
        if (code === 'no-speech' || code === 'aborted') {
          speechStatus.value =
            code === 'no-speech' ? '本地 ASR · 没听到声音，继续说' : '本地 ASR · 重连中'
          return
        }
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setAcousticFallback('麦克风/语音权限被拒绝')
          return
        }
        if (code === 'network') {
          setAcousticFallback('语音服务网络不可用')
          return
        }
        if (code === 'audio-capture') {
          setAcousticFallback('无法捕获麦克风')
          return
        }
        if (asrResultCount === 0) setAcousticFallback(`ASR ${code}`)
        else speechStatus.value = `本地 ASR · 短暂中断（${code}）`
      }

      recognition.onend = () => {
        if (!active || deepgramActive) return
        if (recognitionMode === 'asr') scheduleRecognitionRestart(asrStarted ? 220 : 500)
      }

      window.setTimeout(() => {
        if (!active || !recognition || deepgramActive) return
        try {
          recognition.start()
          speechStatus.value = '本地 ASR 启动中…'
        } catch (error) {
          setAcousticFallback(error instanceof Error ? error.message.slice(0, 40) : '启动失败')
        }
      }, 180)
    } catch (error) {
      setAcousticFallback(error instanceof Error ? error.message.slice(0, 40) : '初始化失败')
    }
  }

  async function startAudio(mediaStream: MediaStream) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      setAcousticFallback('无 AudioContext')
      return
    }
    audioContext = new AudioCtx()
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume()
      } catch {
        // User gesture may be required; keep trying on first analyse tick.
      }
    }
    const source = audioContext.createMediaStreamSource(mediaStream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)

    const analyse = () => {
      if (!active) return
      if (audioContext?.state === 'suspended') {
        void audioContext.resume().catch(() => undefined)
      }
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      const rms = Math.sqrt(sum / samples.length)
      const now = performance.now()
      const delta = clamp(now - lastAudioFrame, 0, 100)
      lastAudioFrame = now
      const threshold = wasSpeaking ? Math.max(0.01, noiseFloor * 1.75) : Math.max(0.014, noiseFloor * 2.55)
      const speaking = rms > threshold
      const previousSilence = silenceStartedAt
      const envelopeAlpha = smoothingAlpha(delta, rms > envelopeRms ? 85 : 360)
      envelopeRms += (rms - envelopeRms) * envelopeAlpha

      if (!speaking) noiseFloor += (rms - noiseFloor) * smoothingAlpha(delta, 4200)
      if (speaking) {
        speechActiveMs += delta
        uninterruptedSpeechMs += delta
        hasSpoken = true
        silenceStartedAt = 0
        if (envelopeRms > threshold * 1.55 && peakArmed && now - lastPeakAt > 170) {
          syllablePeaks += 1
          peakArmed = false
          lastPeakAt = now
        }
        if (envelopeRms < threshold * 1.22) peakArmed = true
      } else {
        if (!silenceStartedAt) silenceStartedAt = now
        if (now - silenceStartedAt > 420) uninterruptedSpeechMs = 0
      }

      if (speaking && !wasSpeaking && hasSpoken && previousSilence && now - previousSilence > 420) {
        pauseCount.value += 1
      }
      wasSpeaking = speaking
      const signalDb = 20 * Math.log10(Math.max(0.00001, envelopeRms - noiseFloor * 0.88))
      const volumeTarget = clamp(((signalDb + 52) / 40) * 100, 0, 100)
      displayVolume += (volumeTarget - displayVolume) * smoothingAlpha(delta, volumeTarget > displayVolume ? 120 : 420)
      const volumePercent = Math.round(displayVolume)
      if (speaking && volumePercent < 16) {
        if (!lowVolumeSince) lowVolumeSince = now
        if (now - lowVolumeSince > 4500) {
          emitLocalAdvice('volume-low', 'volume', '声音再有力量一点，我能听得更清楚。')
        }
      } else lowVolumeSince = 0

      const speechMinutes = speechActiveMs / 60_000
      const firstRecognition = recognizedTimeline[0]
      const lastRecognition = recognizedTimeline.at(-1)
      const recognitionWindowMinutes =
        firstRecognition && lastRecognition ? (lastRecognition.at - firstRecognition.at) / 60_000 : 0
      const transcriptPace =
        firstRecognition && lastRecognition && recognitionWindowMinutes > 0.04
          ? (lastRecognition.characters - firstRecognition.characters) / recognitionWindowMinutes
          : 0
      // Acoustic syllable rate is always available; prefer ASR pace when we have text.
      const acousticPace = speechMinutes > 0.04 ? syllablePeaks / speechMinutes : 0
      const rawPace = clamp(transcriptPace > 0 ? transcriptPace : acousticPace, 0, 420)
      if (rawPace > 0) {
        paceSamples.push(rawPace)
        if (paceSamples.length > 7) paceSamples.shift()
      }
      const paceTarget = median(paceSamples)
      smoothedPace += (paceTarget - smoothedPace) * smoothingAlpha(delta, 850)
      const currentPace = Math.round(smoothedPace)
      if (currentPace > 295 && speechActiveMs > 6000) {
        emitLocalAdvice('pace-fast', 'pace', '下一句放慢一点，让重点落下来。', false, 80)
      }
      if (currentPace > 0 && currentPace < 135 && speechActiveMs > 9000) {
        emitLocalAdvice('pace-slow', 'pace', '节奏可以再连贯一点，别怕说快。', false, 65)
      }
      if (uninterruptedSpeechMs > 18_000) {
        emitLocalAdvice('pause-needed', 'pause', '说完这句，给观众半秒停顿。', false, 60)
        uninterruptedSpeechMs = 0
      }

      // Acoustic teleprompter: ~1.15 汉字 per syllable peak when ASR is thin.
      const acousticChars = Math.round(syllablePeaks * 1.15)
      const progressChars = Math.max(lastRecognizedCharacters, acousticChars)
      // After a pause following speech, assume the current line finished → nudge forward.
      if (
        !speaking &&
        hasSpoken &&
        silenceStartedAt &&
        now - silenceStartedAt > 650 &&
        now - lastSentenceBumpAt > 900 &&
        stableSentenceIndex.value < Math.max(0, sentences.value.length - 1)
      ) {
        const lineLen = Math.max(1, speakable(sentences.value[stableSentenceIndex.value] || '').length)
        // Only auto-nudge if we've roughly covered this line by energy or time.
        const covered =
          progressChars >=
          sentences.value
            .slice(0, stableSentenceIndex.value)
            .reduce((sum, s) => sum + Math.max(1, speakable(s).length), 0) +
            lineLen * 0.4
        if (covered || speechActiveMs > (stableSentenceIndex.value + 1) * 3500) {
          bumpSentenceFromProgress(
            sentences.value
              .slice(0, stableSentenceIndex.value + 1)
              .reduce((sum, s) => sum + Math.max(1, speakable(s).length), 0) + 1,
          )
        }
      } else {
        bumpSentenceFromProgress(progressChars)
      }

      if (now - lastUiUpdate > 90) {
        volume.value = volumePercent
        pace.value = currentPace
        // Prefer real ASR characters; otherwise show acoustic peaks so HUD is never stuck at 0.
        wordCount.value = lastRecognizedCharacters > 0 ? lastRecognizedCharacters : acousticChars
        lastUiUpdate = now
        if (recognitionMode === 'acoustic' && hasSpoken && speechActiveMs > 1200) {
          speechStatus.value = '声学跟读中 · 提词器按说话进度推进'
        }
      }
      audioFrame = requestAnimationFrame(analyse)
    }
    audioFrame = requestAnimationFrame(analyse)
  }

  async function startVision(video: HTMLVideoElement | null) {
    if (!video) {
      visionStatus.value = '镜头分析不可用 · 无预览画面'
      return
    }
    visionStatus.value = '正在加载注视模型…'
    try {
      const warm = await warmFaceLandmarker()
      if (!active) return
      if (!warm.ok || !sharedFaceLandmarker) {
        visionStatus.value = `注视模型加载失败${warm.detail ? ` · ${warm.detail}` : ''}`
        return
      }
      // Reuse shared instance — do not close it on stop() so warm cache stays hot.
      faceLandmarker = sharedFaceLandmarker
      ownsLandmarker = false
      visionStatus.value = '注视模型已就绪'

      const analyse = () => {
        if (!active || !faceLandmarker) return
        const now = performance.now()
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastVisionRun > 100) {
          lastVisionRun = now
          try {
            const detection = faceLandmarker.detectForVideo(video, now)
            const landmarks = detection.faceLandmarks?.[0]
            if (!landmarks?.length) {
              if (!noFaceSince) noFaceSince = now
              if (now - noFaceSince > 1800) {
                emitLocalAdvice('face-missing', 'camera', '回到画面中央，我在这里等你。', false, 100)
              }
              visionStatus.value = '未检测到人脸 · 请正对镜头'
            } else {
              noFaceSince = 0
              visionStatus.value = '注视分析中'
              const xs = landmarks.map((point) => point.x)
              const ys = landmarks.map((point) => point.y)
              const minX = Math.min(...xs)
              const maxX = Math.max(...xs)
              const minY = Math.min(...ys)
              const maxY = Math.max(...ys)
              const faceWidth = Math.max(0.001, maxX - minX)
              const centerX = (minX + maxX) / 2
              const centerY = (minY + maxY) / 2
              const nose = landmarks[1]
              const leftCheek = landmarks[234]
              const rightCheek = landmarks[454]
              if (!nose || !leftCheek || !rightCheek) {
                visionFrame = requestAnimationFrame(analyse)
                return
              }
              const cheekMid = (leftCheek.x + rightCheek.x) / 2
              const facingCamera = Math.abs((nose.x - cheekMid) / faceWidth) < 0.07
              const centered = centerX > 0.28 && centerX < 0.72 && centerY > 0.22 && centerY < 0.72
              const closeEnough = faceWidth > 0.14
              const aligned = centered && closeEnough && facingCamera
              gazeWindow.push(aligned)
              if (gazeWindow.length > 45) gazeWindow.shift()
              eyeContact.value = Math.round((gazeWindow.filter(Boolean).length / gazeWindow.length) * 100)
              if (!centered || !closeEnough || !facingCamera) {
                if (!offCameraSince) offCameraSince = now
                if (now - offCameraSince > 2600) {
                  const text = !centered
                    ? '回到画面中央，构图会更稳。'
                    : !closeEnough
                      ? '稍微靠近镜头一点。'
                      : '目光落在镜头附近，和观众连接。'
                  emitLocalAdvice('camera-align', 'camera', text, false, 72)
                }
              } else {
                offCameraSince = 0
              }
            }
          } catch (error) {
            visionStatus.value = `注视分析异常 · ${error instanceof Error ? error.message.slice(0, 40) : 'unknown'}`
          }
        }
        visionFrame = requestAnimationFrame(analyse)
      }
      visionFrame = requestAnimationFrame(analyse)
    } catch (error) {
      visionStatus.value = `镜头分析不可用 · ${error instanceof Error ? error.message.slice(0, 60) : '加载失败'}`
      console.warn('[mooncut] startVision failed', error)
    }
  }

  async function start(mediaStream: MediaStream, video: HTMLVideoElement | null) {
    stop()
    reset()
    active = true
    // Deepgram first (primary for teleprompter). Local Web Speech only if cloud ASR is off.
    await Promise.allSettled([startAudio(mediaStream), startDeepgramCapture(mediaStream)])
    if (active && !deepgramActive) startRecognition()
    if (active) void startVision(video)
  }

  function stop() {
    active = false
    stopDeepgramCapture()
    if (recognitionRestartTimer) window.clearTimeout(recognitionRestartTimer)
    recognitionRestartTimer = null
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.onstart = null
      try {
        recognition.stop()
      } catch {
        try {
          recognition.abort()
        } catch {
          // ignore
        }
      }
    }
    recognition = null
    if (audioFrame) cancelAnimationFrame(audioFrame)
    if (visionFrame) cancelAnimationFrame(visionFrame)
    audioFrame = 0
    visionFrame = 0
    void audioContext?.close()
    audioContext = null
    // Shared landmarker stays warm across sessions; only close if we owned a private one.
    if (ownsLandmarker) {
      try {
        faceLandmarker?.close()
      } catch {
        // ignore
      }
    }
    faceLandmarker = null
    ownsLandmarker = false
  }

  return {
    pace,
    volume,
    wordCount,
    pauseCount,
    eyeContact,
    transcript,
    transcriptFinal,
    transcriptInterim,
    speechStatus,
    visionStatus,
    localAdvice,
    adviceCategory,
    advicePositive,
    activeSentenceIndex,
    sentences,
    start,
    stop,
    reset,
  }
}
