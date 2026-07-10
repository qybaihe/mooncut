<script setup lang="ts">
import {
  ArrowRight,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileVideo2,
  Gauge,
  RotateCcw,
  Scissors,
  Sparkles,
  Upload,
  WandSparkles,
  X,
  Zap,
} from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { VideoAsset } from '../types'
import ToastMessage from './ToastMessage.vue'
import VideoSurface from './VideoSurface.vue'

type ClipStage = 'empty' | 'ready' | 'processing' | 'done'

const props = defineProps<{ initialAsset: VideoAsset | null }>()
const emit = defineEmits<{ 'clear-handoff': [] }>()

const processingSteps = [
  { label: '读取口播内容', detail: '识别人声与句子边界' },
  { label: '整理停顿与重复', detail: '保留自然呼吸感' },
  { label: '设计字幕节奏', detail: '重点词自动强调' },
  { label: '合成口播成片', detail: '即将可以预览' },
]

const capabilityTags = [
  { icon: Scissors, label: '自动删停顿' },
  { icon: Sparkles, label: '清理重复表达' },
  { icon: Captions, label: '生成节奏字幕' },
]

const stage = ref<ClipStage>(props.initialAsset ? 'ready' : 'empty')
const asset = ref<VideoAsset | null>(props.initialAsset)
const isDragging = ref(false)
const progress = ref(0)
const previewMode = ref<'before' | 'after'>('after')
const videoFailed = ref(false)
const toast = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const subtitleStyle = ref<'重点词强调' | '极简白字' | '综艺描边'>('重点词强调')
const intensity = ref<'轻' | '自然' | '紧凑'>('自然')
let localUrl: string | null = null
let progressTimer: number | null = null
let completeTimer: number | null = null
let toastTimer: number | null = null

const activeStep = computed(() => {
  if (progress.value < 27) return 0
  if (progress.value < 55) return 1
  if (progress.value < 82) return 2
  return 3
})

watch(
  () => props.initialAsset,
  (next) => {
    if (!next) return
    if (localUrl) {
      URL.revokeObjectURL(localUrl)
      localUrl = null
    }
    asset.value = next
    stage.value = 'ready'
    videoFailed.value = false
  },
)

watch(toast, (message) => {
  if (toastTimer) window.clearTimeout(toastTimer)
  if (message) toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
})

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name)
}

function useFile(file?: File) {
  if (!file) return
  if (!isVideoFile(file)) {
    toast.value = '请选择 MP4、MOV 或 WebM 视频'
    return
  }

  if (localUrl) URL.revokeObjectURL(localUrl)
  localUrl = URL.createObjectURL(file)
  emit('clear-handoff')
  asset.value = {
    name: file.name,
    sizeLabel: formatSize(file.size),
    url: localUrl,
    source: 'upload',
  }
  videoFailed.value = false
  stage.value = 'ready'
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement
  useFile(target.files?.[0])
  target.value = ''
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  useFile(event.dataTransfer?.files?.[0])
}

function reset() {
  if (localUrl) {
    URL.revokeObjectURL(localUrl)
    localUrl = null
  }
  emit('clear-handoff')
  asset.value = null
  progress.value = 0
  videoFailed.value = false
  stage.value = 'empty'
}

function beginProcessing() {
  if (progressTimer) window.clearInterval(progressTimer)
  if (completeTimer) window.clearTimeout(completeTimer)
  progress.value = 2
  stage.value = 'processing'
  progressTimer = window.setInterval(() => {
    progress.value = Math.min(100, progress.value + (progress.value < 70 ? 2 : 1))
    if (progress.value >= 100 && progressTimer) {
      window.clearInterval(progressTimer)
      progressTimer = null
      completeTimer = window.setTimeout(() => {
        stage.value = 'done'
        previewMode.value = 'after'
      }, 450)
    }
  }, 110)
}

function cycleSubtitleStyle() {
  const styles = ['重点词强调', '极简白字', '综艺描边'] as const
  subtitleStyle.value = styles[(styles.indexOf(subtitleStyle.value) + 1) % styles.length]
}

onBeforeUnmount(() => {
  if (localUrl) URL.revokeObjectURL(localUrl)
  if (progressTimer) window.clearInterval(progressTimer)
  if (completeTimer) window.clearTimeout(completeTimer)
  if (toastTimer) window.clearTimeout(toastTimer)
})
</script>

<template>
  <section class="workspace-page clip-page">
    <div class="page-heading reveal">
      <div>
        <span class="eyebrow"><WandSparkles :size="15" /> 智能口播剪辑</span>
        <h1>把素口播，剪成能发的成片。</h1>
        <p>上传原视频，停顿、废话和字幕节奏交给 MoonCut。</p>
      </div>
      <div v-if="stage !== 'empty'" class="page-stepper" aria-label="剪辑进度">
        <span class="is-done"><Check :size="13" /> 上传</span><i />
        <span :class="{ 'is-current': stage === 'processing', 'is-done': stage === 'done' }">
          <Check v-if="stage === 'done'" :size="13" /><template v-else>2</template> 智能剪辑
        </span><i />
        <span :class="{ 'is-current': stage === 'done' }">3 成片</span>
      </div>
    </div>

    <div v-if="stage === 'empty'" class="upload-layout reveal reveal-delay">
      <div
        class="upload-zone"
        :class="{ 'is-dragging': isDragging }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent
        @dragleave="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <input
          ref="inputRef"
          class="visually-hidden"
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.m4v"
          @change="handleInput"
        >
        <div class="upload-visual" aria-hidden="true">
          <span class="upload-frame frame-back" />
          <span class="upload-frame frame-front"><Upload :size="24" :stroke-width="2.2" /></span>
          <span class="upload-spark spark-one">✦</span>
          <span class="upload-spark spark-two">✦</span>
        </div>
        <h2>{{ isDragging ? '松手，开始创作' : '拖入一条素口播' }}</h2>
        <p>或者点击选择本地视频</p>
        <button class="primary-button upload-button" type="button" @click="inputRef?.click()">
          <Upload :size="18" /> 选择视频
        </button>
        <small>支持 MP4、MOV、WebM · 建议 30 分钟以内</small>
        <div class="capability-row">
          <span v-for="tag in capabilityTags" :key="tag.label">
            <component :is="tag.icon" :size="15" /> {{ tag.label }}
          </span>
        </div>
      </div>

      <aside class="promise-card">
        <div class="promise-topline"><span class="mini-label">自然口播模式</span><span class="new-badge">推荐</span></div>
        <h2>少一点剪辑感，<br>多一点表达力。</h2>
        <p>不把每一处呼吸都剪掉，只处理真正影响观看节奏的部分。</p>
        <div class="workflow-list">
          <div><span>01</span><p><strong>听懂</strong>识别完整表达</p></div>
          <div><span>02</span><p><strong>精简</strong>去掉无效停顿</p></div>
          <div><span>03</span><p><strong>包装</strong>加上节奏字幕</p></div>
        </div>
        <div class="promise-note"><Zap :size="16" fill="currentColor" /><span>一条 3 分钟口播，演示版约 8 秒完成</span></div>
      </aside>
    </div>

    <div v-else-if="stage === 'ready' && asset" class="clip-workbench reveal">
      <div class="video-card">
        <div class="card-toolbar">
          <span><span class="status-dot coral" /> 原始视频</span>
          <button type="button" @click="reset"><RotateCcw :size="15" /> 更换</button>
        </div>
        <div class="video-stage portrait-stage">
          <VideoSurface :asset="asset" :failed="videoFailed" controls @error="videoFailed = true" />
          <span class="video-chip">原片 · 未处理</span>
        </div>
        <div class="file-meta">
          <span class="file-icon"><FileVideo2 :size="19" /></span>
          <div><strong>{{ asset.name }}</strong><small>{{ asset.sizeLabel }} · 已准备好</small></div>
          <CheckCircle2 :size="20" class="success-icon" />
        </div>
      </div>

      <aside class="settings-card">
        <span class="mini-label">本次剪辑</span>
        <h2>保持你的表达，<br>只让节奏更好。</h2>
        <div class="preset-card">
          <div class="preset-icon"><Sparkles :size="20" /></div>
          <div><strong>自然口播</strong><p>轻度精简 · 动态字幕 · 保留语气</p></div>
          <CheckCircle2 :size="20" class="preset-check" />
        </div>
        <div class="setting-row">
          <span><Captions :size="17" /> 字幕样式</span>
          <button type="button" @click="cycleSubtitleStyle">{{ subtitleStyle }} <ChevronDown :size="15" /></button>
        </div>
        <div class="setting-row">
          <span><Gauge :size="17" /> 节奏强度</span>
          <div class="segmented-control" aria-label="节奏强度">
            <button
              v-for="option in (['轻', '自然', '紧凑'] as const)"
              :key="option"
              type="button"
              :class="{ 'is-selected': intensity === option }"
              :aria-pressed="intensity === option"
              @click="intensity = option"
            >{{ option }}</button>
          </div>
        </div>
        <div class="settings-spacer" />
        <div class="privacy-note"><Check :size="15" /> 当前为本地演示，不会上传视频</div>
        <button class="primary-button large-button" type="button" @click="beginProcessing">
          开始智能剪辑 <ArrowRight :size="18" />
        </button>
      </aside>
    </div>

    <div v-else-if="stage === 'processing' && asset" class="processing-layout reveal">
      <div class="processing-preview">
        <div class="video-stage portrait-stage processing-stage">
          <VideoSurface :asset="asset" :failed="videoFailed" @error="videoFailed = true" />
          <div class="scan-line" />
          <div class="processing-bubble">
            <span class="spinner-orbit"><Sparkles :size="18" /></span>
            <div><strong>{{ processingSteps[activeStep].label }}</strong><small>{{ processingSteps[activeStep].detail }}</small></div>
          </div>
        </div>
      </div>
      <aside class="processing-card">
        <span class="mini-label">AI 正在工作</span>
        <div class="progress-number" aria-live="polite"><strong>{{ progress }}</strong><span>%</span></div>
        <h2>正在剪掉那些<br>不影响意思、但影响节奏的部分。</h2>
        <div class="progress-track" role="progressbar" aria-label="剪辑进度" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${progress}%` }" /></div>
        <div class="processing-steps">
          <div
            v-for="(item, index) in processingSteps"
            :key="item.label"
            :class="{ 'is-done': index < activeStep, 'is-active': index === activeStep }"
          >
            <span><Check v-if="index < activeStep" :size="14" /><template v-else>{{ index + 1 }}</template></span>
            <p><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></p>
          </div>
        </div>
        <p class="safe-leave-note"><Clock3 :size="15" /> 可以切到录制间，任务会继续运行</p>
      </aside>
    </div>

    <div v-else-if="stage === 'done' && asset" class="result-layout reveal">
      <div class="result-preview-card">
        <div class="card-toolbar">
          <span><span class="status-dot" /> 成片预览</span>
          <div class="compare-toggle">
            <button type="button" :class="{ 'is-active': previewMode === 'before' }" :aria-pressed="previewMode === 'before'" @click="previewMode = 'before'">原片</button>
            <button type="button" :class="{ 'is-active': previewMode === 'after' }" :aria-pressed="previewMode === 'after'" @click="previewMode = 'after'">成片</button>
          </div>
        </div>
        <div class="video-stage portrait-stage result-stage" :class="{ 'is-processed': previewMode === 'after' }">
          <VideoSurface :asset="asset" :failed="videoFailed" controls @error="videoFailed = true" />
          <span class="video-chip">{{ previewMode === 'after' ? 'MoonCut 成片' : '原片对比' }}</span>
          <template v-if="previewMode === 'after'">
            <div class="caption-preview">把素口播，剪成<strong>能发的成片</strong></div>
            <span class="corner-mark">MOONCUT ✦</span>
          </template>
        </div>
      </div>

      <aside class="result-card">
        <span class="success-kicker"><CheckCircle2 :size="17" /> 成片已完成</span>
        <h2>节奏更紧了，<br>表达还是你的。</h2>
        <p class="result-description">我们保留了自然语气，只清理了真正拖慢内容的部分。</p>
        <div class="result-stats">
          <div><strong>12</strong><span>处停顿</span></div>
          <div><strong>38<small>秒</small></strong><span>精简时长</span></div>
          <div><strong>24</strong><span>个重点词</span></div>
        </div>
        <div class="result-checks">
          <span><Check :size="14" /> 1080P 高清</span><span><Check :size="14" /> 节奏字幕已生成</span><span><Check :size="14" /> 原画质保留</span>
        </div>
        <button class="primary-button large-button" type="button" @click="toast = '演示版：成片下载流程已触发'"><Download :size="18" /> 下载成片</button>
        <div class="result-actions">
          <button type="button" @click="beginProcessing"><RotateCcw :size="15" /> 重新剪一版</button>
          <button type="button" @click="reset"><X :size="15" /> 换个视频</button>
        </div>
      </aside>
    </div>

    <ToastMessage :message="toast" />
  </section>
</template>
