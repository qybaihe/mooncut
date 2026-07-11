import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { computed, ref, type Ref } from 'vue'

type AdviceCategory = 'pace' | 'volume' | 'pause' | 'script' | 'camera' | 'steady'

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
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
const speakable = (value: string) => Array.from(value).filter((character) => /[\u3400-\u9fffA-Za-z0-9]/.test(character)).join('')
const smoothingAlpha = (deltaMs: number, timeConstantMs: number) => 1 - Math.exp(-Math.max(0, deltaMs) / timeConstantMs)
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

export function resolveSpokenSentenceIndex(transcript: string, sentenceList: string[], currentIndex = 0) {
  if (!sentenceList.length) return 0
  const spoken = speakable(transcript)
  if (!spoken) return 0
  let cumulative = 0
  let lengthIndex = sentenceList.length - 1
  for (let index = 0; index < sentenceList.length; index += 1) {
    cumulative += Math.max(1, speakable(sentenceList[index]).length)
    if (spoken.length < cumulative) {
      lengthIndex = index
      break
    }
  }
  const tailPairs = bigrams(spoken.slice(-28))
  let bestIndex = currentIndex
  let bestScore = 0
  for (let index = Math.max(0, currentIndex - 1); index < sentenceList.length; index += 1) {
    const pairs = bigrams(speakable(sentenceList[index]))
    const score = Array.from(tailPairs).filter((pair) => pairs.has(pair)).length
    if (score > bestScore || (score === bestScore && score > 0 && index > bestIndex)) {
      bestIndex = index
      bestScore = score
    }
  }
  const target = bestScore >= 2 ? bestIndex : Math.min(currentIndex + 1, lengthIndex)
  return clamp(Math.max(currentIndex, target), 0, sentenceList.length - 1)
}

export function useSpeakingCoach(script: Ref<string>) {
  const pace = ref(0)
  const volume = ref(0)
  const wordCount = ref(0)
  const pauseCount = ref(0)
  const eyeContact = ref(0)
  const transcriptFinal = ref('')
  const transcriptInterim = ref('')
  const speechStatus = ref('等待实时 ASR')
  const visionStatus = ref('等待视觉分析')
  const localAdvice = ref('看镜头，按自己的节奏开始。')
  const adviceCategory = ref<AdviceCategory>('steady')
  const advicePositive = ref(true)
  const stableSentenceIndex = ref(0)

  let active = false
  let recognition: BrowserSpeechRecognition | null = null
  let recognitionRestartTimer: number | null = null
  let audioContext: AudioContext | null = null
  let audioFrame = 0
  let visionFrame = 0
  let faceLandmarker: FaceLandmarker | null = null
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
  const cooldowns: Record<string, number> = {}

  const transcript = computed(() => `${transcriptFinal.value}${transcriptInterim.value}`.trim())
  const sentences = computed(() => script.value.split(/(?<=[。！？!?])/).map((item) => item.trim()).filter(Boolean))
  const activeSentenceIndex = computed(() => clamp(stableSentenceIndex.value, 0, Math.max(0, sentences.value.length - 1)))

  function emitLocalAdvice(id: string, category: AdviceCategory, text: string, positive = false, priority = 50) {
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
    speechStatus.value = '等待实时 ASR'
    visionStatus.value = '正在加载视觉分析'
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
    Object.keys(cooldowns).forEach((key) => delete cooldowns[key])
  }

  function startRecognition() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      speechStatus.value = '浏览器不支持 ASR · 声学估算'
      return
    }
    try {
      recognition = new Recognition()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onresult = (event) => {
        let interim = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const text = result[0]?.transcript ?? ''
          if (result.isFinal) transcriptFinal.value += text
          else interim += text
        }
        transcriptInterim.value = interim
        const characters = speakable(`${transcriptFinal.value}${interim}`).length
        if (characters > lastRecognizedCharacters) {
          lastRecognizedCharacters = characters
          const now = performance.now()
          recognizedTimeline.push({ at: now, characters })
          while (recognizedTimeline.length > 2 && recognizedTimeline[1].at < now - 12_000) recognizedTimeline.shift()
        }
        stableSentenceIndex.value = resolveSpokenSentenceIndex(
          `${transcriptFinal.value}${interim}`,
          sentences.value,
          stableSentenceIndex.value,
        )
        speechStatus.value = resultIsStable(event.results) ? '实时 ASR · 已对齐' : '实时 ASR · 跟随中'
      }
      recognition.onerror = () => { speechStatus.value = 'ASR 暂不可用 · 声学估算' }
      recognition.onend = () => {
        if (!active || !recognition) return
        if (recognitionRestartTimer) window.clearTimeout(recognitionRestartTimer)
        recognitionRestartTimer = window.setTimeout(() => {
          if (!active || !recognition) return
          try { recognition.start() } catch { speechStatus.value = 'ASR 暂不可用 · 声学估算' }
        }, 260)
      }
      recognition.start()
    } catch {
      speechStatus.value = 'ASR 暂不可用 · 声学估算'
    }
  }

  async function startAudio(stream: MediaStream) {
    audioContext = new AudioContext()
    await audioContext.resume()
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.82
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)

    const analyse = () => {
      if (!active) return
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      const rms = Math.sqrt(sum / samples.length)
      const now = performance.now()
      const delta = clamp(now - lastAudioFrame, 0, 100)
      lastAudioFrame = now
      const threshold = wasSpeaking ? Math.max(0.010, noiseFloor * 1.75) : Math.max(0.014, noiseFloor * 2.55)
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

      if (speaking && !wasSpeaking && hasSpoken && previousSilence && now - previousSilence > 420) pauseCount.value += 1
      wasSpeaking = speaking
      const signalDb = 20 * Math.log10(Math.max(0.00001, envelopeRms - noiseFloor * 0.88))
      const volumeTarget = clamp(((signalDb + 52) / 40) * 100, 0, 100)
      displayVolume += (volumeTarget - displayVolume) * smoothingAlpha(delta, volumeTarget > displayVolume ? 120 : 420)
      const volumePercent = Math.round(displayVolume)
      if (speaking && volumePercent < 16) {
        if (!lowVolumeSince) lowVolumeSince = now
        if (now - lowVolumeSince > 4500) emitLocalAdvice('volume-low', 'volume', '声音再有力量一点，我能听得更清楚。')
      } else lowVolumeSince = 0

      const speechMinutes = speechActiveMs / 60_000
      const firstRecognition = recognizedTimeline[0]
      const lastRecognition = recognizedTimeline.at(-1)
      const recognitionWindowMinutes = firstRecognition && lastRecognition ? (lastRecognition.at - firstRecognition.at) / 60_000 : 0
      const transcriptPace = firstRecognition && lastRecognition && recognitionWindowMinutes > 0.04
        ? (lastRecognition.characters - firstRecognition.characters) / recognitionWindowMinutes
        : 0
      const acousticPace = speechMinutes > 0.04 ? syllablePeaks / speechMinutes : 0
      const rawPace = clamp(transcriptPace || acousticPace, 0, 420)
      if (rawPace > 0) {
        paceSamples.push(rawPace)
        if (paceSamples.length > 7) paceSamples.shift()
      }
      const paceTarget = median(paceSamples)
      smoothedPace += (paceTarget - smoothedPace) * smoothingAlpha(delta, 850)
      const currentPace = Math.round(smoothedPace)
      if (currentPace > 295 && speechActiveMs > 6000) emitLocalAdvice('pace-fast', 'pace', '下一句放慢一点，让重点落下来。', false, 80)
      if (currentPace > 0 && currentPace < 135 && speechActiveMs > 9000) emitLocalAdvice('pace-slow', 'pace', '节奏可以再连贯一点，别怕说快。', false, 65)
      if (uninterruptedSpeechMs > 18_000) {
        emitLocalAdvice('pause-needed', 'pause', '说完这句，给观众半秒停顿。', false, 60)
        uninterruptedSpeechMs = 0
      }
      if (now - lastUiUpdate > 90) {
        volume.value = volumePercent
        pace.value = currentPace
        wordCount.value = lastRecognizedCharacters || syllablePeaks
        lastUiUpdate = now
      }
      audioFrame = requestAnimationFrame(analyse)
    }
    audioFrame = requestAnimationFrame(analyse)
  }

  async function startVision(video: HTMLVideoElement | null) {
    if (!video) return
    try {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe')
      const options = {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' as const },
        runningMode: 'VIDEO' as const,
        numFaces: 1,
      }
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, options)
      } catch {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
      }
      visionStatus.value = '镜头分析已就绪'
      const analyse = () => {
        if (!active || !faceLandmarker) return
        const now = performance.now()
        if (video.readyState >= 2 && now - lastVisionRun > 110) {
          lastVisionRun = now
          const landmarks = faceLandmarker.detectForVideo(video, now).faceLandmarks[0]
          if (!landmarks) {
            if (!noFaceSince) noFaceSince = now
            if (now - noFaceSince > 1800) emitLocalAdvice('face-missing', 'camera', '回到画面中央，我在这里等你。', false, 100)
            visionStatus.value = '未检测到人脸'
          } else {
            noFaceSince = 0
            visionStatus.value = '镜头分析已就绪'
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
            const cheekMid = (landmarks[234].x + landmarks[454].x) / 2
            const facingCamera = Math.abs((nose.x - cheekMid) / faceWidth) < 0.055
            const centered = centerX > 0.31 && centerX < 0.69 && centerY > 0.28 && centerY < 0.67
            const closeEnough = faceWidth > 0.18
            const aligned = centered && closeEnough && facingCamera
            gazeWindow.push(aligned)
            if (gazeWindow.length > 45) gazeWindow.shift()
            eyeContact.value = Math.round((gazeWindow.filter(Boolean).length / gazeWindow.length) * 100)
            if (!centered || !closeEnough || !facingCamera) {
              if (!offCameraSince) offCameraSince = now
              if (now - offCameraSince > 2600) {
                const text = !centered ? '回到画面中央，构图会更稳。' : !closeEnough ? '稍微靠近镜头一点。' : '目光落在镜头附近，和观众连接。'
                emitLocalAdvice('camera-align', 'camera', text, false, 72)
              }
            } else offCameraSince = 0
          }
        }
        visionFrame = requestAnimationFrame(analyse)
      }
      visionFrame = requestAnimationFrame(analyse)
    } catch {
      visionStatus.value = '镜头分析不可用'
    }
  }

  async function start(stream: MediaStream, video: HTMLVideoElement | null) {
    stop()
    reset()
    active = true
    startRecognition()
    await Promise.allSettled([startAudio(stream), startVision(video)])
  }

  function stop() {
    active = false
    recognition?.abort()
    recognition = null
    if (recognitionRestartTimer) window.clearTimeout(recognitionRestartTimer)
    recognitionRestartTimer = null
    if (audioFrame) cancelAnimationFrame(audioFrame)
    if (visionFrame) cancelAnimationFrame(visionFrame)
    audioFrame = 0
    visionFrame = 0
    void audioContext?.close()
    audioContext = null
    faceLandmarker?.close()
    faceLandmarker = null
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
