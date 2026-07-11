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
  ImagePlus,
  Mail,
  MailCheck,
  MessageSquareMore,
  MapPin,
  PackageCheck,
  RotateCcw,
  Scissors,
  Share2,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import { artifactUrl, confirmJobMail, createEditJob, createSubtitleRepair, getEditJob, getMailStatus, listCapabilityInstallations, listSubtitleRepairs, prepareJobMail, publishCommunityPost, uploadAsset } from '../services/api'
import type { CapabilityInstallation, EditJob, PetAnimationState, VideoAsset } from '../types'
import ToastMessage from './ToastMessage.vue'
import VideoSurface from './VideoSurface.vue'

const { currentTheme } = useTheme()

type ClipStage = 'empty' | 'ready' | 'processing' | 'done'

const props = defineProps<{ initialAsset: VideoAsset | null; userEmail: string }>()
const emit = defineEmits<{
  'clear-handoff': []
  'pet-state': [state: PetAnimationState]
  'pet-message': [message: string]
  'open-community': []
}>()

const processingSteps = [
  { label: '读取口播内容', detail: '识别人声与句子边界' },
  { label: '判断素材缺口', detail: '默认不生图，确有需要才补 1–2 张' },
  { label: '整理画面与字幕', detail: '保留自然呼吸感，重点词自动强调' },
  { label: '合成口播成片', detail: '渲染人物、画面与声音' },
  { label: '检查最终画面', detail: '验证素材标识和成片质量' },
]

const subtitleRepairSteps = [
  { label: '理解你的反馈', detail: '定位对应的字幕片段与问题类型' },
  { label: '生成修复清单', detail: '只改动确认有问题的字幕' },
  { label: '重新合成字幕', detail: '继承原始分镜和人物画面' },
  { label: '渲染修订版本', detail: '生成新的成片版本，不覆盖原片' },
  { label: '检查修订成片', detail: '重新验证画面、音频与时长' },
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
const imageGenerationMode = ref<'auto' | 'off'>('auto')
const installedCapabilities = ref<CapabilityInstallation[]>([])
const selectedCapabilityIds = ref<string[]>([])
const fifaEvidenceRequested = ref(false)
const fifaEvidenceMatchId = ref('')
const notificationEnabled = ref(false)
const notificationEmailKey = `mooncut:notification-email:${props.userEmail}`
const communityAuthorKey = `mooncut:community-author:${props.userEmail}`
const notificationEmail = ref(localStorage.getItem(notificationEmailKey) ?? props.userEmail)
const mailAuthorized = ref(false)
const mailSender = ref('')
const mailAutomatic = ref(false)
const jobId = ref('')
const completedJob = ref<EditJob | null>(null)
const pendingMail = ref<{ pendingId: string; recipient: string; expiresAt: string } | null>(null)
const isConfirmingMail = ref(false)
const isSubtitleRepairing = ref(false)
const repairOpen = ref(false)
const repairInstruction = ref('')
const repairReplacement = ref('')
const repairAtInput = ref('')
const previewPlaybackSeconds = ref(0)
const repairVersions = ref<EditJob[]>([])
const isLoadingRepairHistory = ref(false)
const shareOpen = ref(false)
const shareAuthor = ref(localStorage.getItem(communityAuthorKey) ?? props.userEmail.split('@', 1)[0] ?? 'MoonCut 创作者')
const shareTitle = ref('')
const shareCaption = ref('')
const isPublishingCommunity = ref(false)
const publishedPostId = ref('')
let localUrl: string | null = null
let toastTimer: number | null = null
let pollGeneration = 0

const activeJobKey = `mooncut:active-job:${props.userEmail}`
const lastJobKey = `mooncut:last-job:${props.userEmail}`
const pendingMailKey = (id: string) => `mooncut:pending-mail:${props.userEmail}:${id}`

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail.value))
const resultAsset = computed<VideoAsset | null>(() => {
  if (!asset.value) return null
  if (previewMode.value === 'after' && jobId.value) {
    return { ...asset.value, url: artifactUrl(jobId.value), resultUrl: artifactUrl(jobId.value), jobId: jobId.value }
  }
  return asset.value
})
const resultSummary = computed(() => {
  const summary = completedJob.value?.result?.summary
  if (!summary) return '我们保留了自然语气，只清理了真正拖慢内容的部分。'
  const clean = summary
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`|>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const qualityLine = clean.match(/质量审查\s+qualityReview\.ok\s*:?\s*true/i)
  return qualityLine
    ? '成片已完成，音频、画面、字幕节奏与视觉质量检查全部通过。'
    : `${clean.slice(0, 138)}${clean.length > 138 ? '…' : ''}`
})
const resultDuration = computed(() => {
  const durationMs = completedJob.value?.result?.probe?.durationMs
  return durationMs ? `${(durationMs / 1000).toFixed(1)}` : '—'
})
const resultModel = computed(() => completedJob.value?.result?.models?.planner ?? '—')
const resultQuality = computed(() => completedJob.value?.result?.quality?.ok ? '通过' : '待检查')
const generatedVisualCount = computed(() => completedJob.value?.result?.visuals?.assets?.length ?? 0)
const usedCapabilities = computed(() => completedJob.value?.capabilities ?? [])
const enabledTaskCapabilities = computed(() => installedCapabilities.value.filter((capability) => capability.status === 'enabled' && capability.tasks.includes('video-edit')))
const selectedFifaInstallation = computed(() => enabledTaskCapabilities.value.find((capability) => capability.slug === 'fifa-official-highlights' && selectedCapabilityIds.value.includes(capability.id)))
const currentProcessingSteps = computed(() => isSubtitleRepairing.value ? subtitleRepairSteps : processingSteps)
const repairAtMs = computed(() => {
  const raw = repairAtInput.value.trim()
  if (!raw) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined
})
const repairAtLabel = computed(() => repairAtMs.value === undefined ? '未指定时间点' : formatRepairTime(repairAtMs.value))
const activeRepairAnalysis = computed(() => completedJob.value?.subtitleRepair?.analysis)

const activeStep = computed(() => {
  if (progress.value < 20) return 0
  if (progress.value < 45) return 1
  if (progress.value < 68) return 2
  if (progress.value < 94) return 3
  return 4
})

const petState = computed<PetAnimationState>(() => {
  if (toast.value) return 'jumping'
  if (stage.value === 'processing') return 'running'
  if (stage.value === 'done') return 'jumping'
  if (stage.value === 'ready') return 'review'
  return 'waiting'
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

watch(notificationEmail, (value) => localStorage.setItem(notificationEmailKey, value.trim()))
watch(shareAuthor, (value) => localStorage.setItem(communityAuthorKey, value.trim()))

watch(petState, (state) => emit('pet-state', state), { immediate: true })

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toggleTaskCapability(id: string) {
  const removing = selectedCapabilityIds.value.includes(id)
  selectedCapabilityIds.value = removing
    ? selectedCapabilityIds.value.filter((value) => value !== id)
    : [...selectedCapabilityIds.value, id]
  if (removing && installedCapabilities.value.find((capability) => capability.id === id)?.slug === 'fifa-official-highlights') {
    fifaEvidenceRequested.value = false
  }
}

function usedCapabilityLabel(installationId: string, slug: string) {
  return installedCapabilities.value.find((capability) => capability.id === installationId)?.name ?? slug
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
    file,
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
  const previousJobId = jobId.value
  if (localUrl) {
    URL.revokeObjectURL(localUrl)
    localUrl = null
  }
  emit('clear-handoff')
  asset.value = null
  progress.value = 0
  jobId.value = ''
  completedJob.value = null
  pendingMail.value = null
  isSubtitleRepairing.value = false
  repairOpen.value = false
  repairInstruction.value = ''
  repairReplacement.value = ''
  repairAtInput.value = ''
  repairVersions.value = []
  localStorage.removeItem(activeJobKey)
  localStorage.removeItem(lastJobKey)
  if (previousJobId) localStorage.removeItem(pendingMailKey(previousJobId))
  pollGeneration += 1
  videoFailed.value = false
  stage.value = 'empty'
}

async function finishJob(job: EditJob) {
  jobId.value = job.id
  if (!asset.value) {
    asset.value = {
      name: job.originalName || 'MoonCut 成片.mp4',
      sizeLabel: '后台任务 · 已完成',
      url: artifactUrl(job.id),
      resultUrl: artifactUrl(job.id),
      jobId: job.id,
      source: 'upload',
    }
  }
  completedJob.value = job
  isSubtitleRepairing.value = false
  if (!shareTitle.value) shareTitle.value = job.request?.title || job.originalName.replace(/\.[^.]+$/, '') || '我的 MoonCut 口播'
  progress.value = 100
  stage.value = 'done'
  previewMode.value = 'after'
  localStorage.removeItem(activeJobKey)
  localStorage.setItem(lastJobKey, job.id)
  emit('pet-message', job.mail?.status === 'sent'
    ? '成片和邮件都送到啦！我开心地跑起来了！'
    : job.mail
      ? '成片好啦！回来确认一下，我就帮你发邮箱。'
      : job.subtitleRepair
        ? '字幕修订版完成啦，原始成片也还在。'
        : '成片好啦！这次节奏一定更舒服。')
  void refreshSubtitleRepairHistory(job.id)
  const cachedPending = localStorage.getItem(pendingMailKey(job.id))
  if (cachedPending) {
    try {
      const parsed = JSON.parse(cachedPending) as { pendingId: string; recipient: string; expiresAt: string }
      if (Date.parse(parsed.expiresAt) > Date.now()) pendingMail.value = parsed
      else localStorage.removeItem(pendingMailKey(job.id))
    } catch {
      localStorage.removeItem(pendingMailKey(job.id))
    }
  }
  if (!pendingMail.value && (job.mail?.status === 'ready' || job.mail?.status === 'awaiting-confirmation')) {
    try {
      const prepared = await prepareJobMail(job.id)
      pendingMail.value = prepared
      localStorage.setItem(pendingMailKey(job.id), JSON.stringify(prepared))
      completedJob.value = await getEditJob(job.id)
    } catch (error) {
      toast.value = error instanceof Error ? error.message : '邮件准备失败'
    }
  }
}

function formatRepairTime(milliseconds: number) {
  const totalSeconds = Math.max(0, milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, '0')
  return `${minutes}:${seconds}`
}

function usePreviewTimeForRepair() {
  repairAtInput.value = previewPlaybackSeconds.value.toFixed(1)
}

async function refreshSubtitleRepairHistory(id: string) {
  isLoadingRepairHistory.value = true
  try {
    const history = await listSubtitleRepairs(id)
    const active = completedJob.value
    const root = active && active.id === history.rootJobId
      ? active
      : await getEditJob(history.rootJobId)
    repairVersions.value = [root, ...history.items]
  } catch {
    repairVersions.value = completedJob.value ? [completedJob.value] : []
  } finally {
    isLoadingRepairHistory.value = false
  }
}

function selectSubtitleVersion(version: EditJob) {
  if (version.status !== 'completed') return
  jobId.value = version.id
  completedJob.value = version
  previewMode.value = 'after'
  void refreshSubtitleRepairHistory(version.id)
}

async function submitSubtitleRepair() {
  const instruction = repairInstruction.value.trim()
  if (instruction.length < 2 || !jobId.value || !completedJob.value || isSubtitleRepairing.value) {
    toast.value = instruction.length < 2 ? '请描述字幕哪里有问题' : '当前成片还不能提交字幕修复'
    return
  }
  const parentJobId = jobId.value
  const parentJob = completedJob.value
  const generation = ++pollGeneration
  isSubtitleRepairing.value = true
  stage.value = 'processing'
  progress.value = 3
  repairOpen.value = false
  emit('pet-message', '我先定位字幕问题，再只修这一版的字幕。')
  try {
    const created = await createSubtitleRepair(parentJobId, {
      instruction,
      ...(repairAtMs.value === undefined ? {} : { atMs: repairAtMs.value }),
      ...(repairReplacement.value.trim() ? { replacementText: repairReplacement.value.trim() } : {}),
    })
    jobId.value = created.id
    repairInstruction.value = ''
    repairReplacement.value = ''
    await pollJob(created.id, generation)
  } catch (error) {
    isSubtitleRepairing.value = false
    stage.value = 'done'
    jobId.value = parentJobId
    completedJob.value = parentJob
    previewMode.value = 'after'
    toast.value = error instanceof Error ? error.message : '字幕修复任务启动失败'
    emit('pet-message', '这条反馈还不够明确，补充一下时间点或正确字幕再试。')
  }
}

async function pollJob(id: string, generation: number) {
  while (generation === pollGeneration) {
    const job = await getEditJob(id)
    completedJob.value = job
    progress.value = Math.max(progress.value, Math.min(99, Math.round(job.progress * 100)))
    if (job.status === 'completed') {
      await finishJob(job)
      return
    }
    if (job.status === 'failed') throw new Error(job.error || '剪辑任务失败')
    await new Promise((resolve) => window.setTimeout(resolve, 1400))
  }
}

async function beginProcessing() {
  if (!asset.value?.file) {
    toast.value = '当前视频缺少本地文件，请重新选择或录制'
    return
  }
  if (notificationEnabled.value && !emailValid.value) {
    toast.value = '请填写有效的收件邮箱'
    return
  }
  if (fifaEvidenceRequested.value && selectedFifaInstallation.value && !fifaEvidenceMatchId.value.trim()) {
    toast.value = '请填写 FIFA 比赛编号，才能把确认过的赛况截图加入任务'
    return
  }
  const generation = ++pollGeneration
  isSubtitleRepairing.value = false
  progress.value = 2
  stage.value = 'processing'
  pendingMail.value = null
  emit('pet-message', notificationEnabled.value
    ? mailAutomatic.value ? '你先去忙，剪好后我会自动送到邮箱！' : '你可以先去忙，剪好后我会准备邮件。'
    : '我去跑剪辑流程啦，等我一下！')
  try {
    const uploaded = await uploadAsset(asset.value.file, asset.value.name)
    progress.value = 7
    const created = await createEditJob({
      assetId: uploaded.assetId,
      title: asset.value.name.replace(/\.[^.]+$/, ''),
      prompt: `使用${subtitleStyle.value}字幕，节奏强度${intensity.value}，保留自然语气。${selectedCapabilityIds.value.length ? '仅在相关事实需要时使用用户选定的 Pi 能力，并保留其来源与版本。' : ''}`,
      imageGeneration: imageGenerationMode.value,
      notificationEmail: notificationEnabled.value ? notificationEmail.value.trim() : undefined,
      capabilityInstallIds: selectedCapabilityIds.value,
      capabilityRequests: fifaEvidenceRequested.value && selectedFifaInstallation.value
        ? [{
            installationId: selectedFifaInstallation.value.id,
            tool: 'fifa_match_context' as const,
            input: { matchId: fifaEvidenceMatchId.value.trim(), includeChineseContext: true, screenshotView: 'ratings' as const },
            confirmedArtifact: true,
          }]
        : undefined,
    })
    jobId.value = created.id
    localStorage.setItem(activeJobKey, created.id)
    localStorage.removeItem(lastJobKey)
    await pollJob(created.id, generation)
  } catch (error) {
    stage.value = 'ready'
    progress.value = 0
    toast.value = error instanceof Error ? error.message : '任务启动失败，请稍后重试'
    emit('pet-message', '这次任务没跑起来，我们检查一下再试。')
  }
}

async function confirmCompletionEmail() {
  if (!pendingMail.value || !jobId.value || isConfirmingMail.value) return
  isConfirmingMail.value = true
  try {
    await confirmJobMail(jobId.value, pendingMail.value.pendingId)
    localStorage.removeItem(pendingMailKey(jobId.value))
    pendingMail.value = null
    completedJob.value = await getEditJob(jobId.value)
    toast.value = `成片邮件已发送到 ${completedJob.value.mail?.recipient ?? notificationEmail.value}`
    emit('pet-message', '邮件送到啦！我已经开心地跑起来了！')
  } catch (error) {
    const message = error instanceof Error ? error.message : '邮件发送失败'
    if (/Unknown mail confirmation|expired/i.test(message) && jobId.value) {
      localStorage.removeItem(pendingMailKey(jobId.value))
      pendingMail.value = null
      try {
        const prepared = await prepareJobMail(jobId.value)
        pendingMail.value = prepared
        localStorage.setItem(pendingMailKey(jobId.value), JSON.stringify(prepared))
        completedJob.value = await getEditJob(jobId.value)
        toast.value = '邮件确认已刷新，请再确认一次'
      } catch (prepareError) {
        toast.value = prepareError instanceof Error ? prepareError.message : '邮件重新准备失败'
      }
    } else {
      toast.value = message
    }
  } finally {
    isConfirmingMail.value = false
  }
}

async function shareToCommunity() {
  if (!jobId.value || isPublishingCommunity.value) return
  if (!shareTitle.value.trim()) {
    toast.value = '给这条社区作品起一个标题'
    return
  }
  isPublishingCommunity.value = true
  try {
    const result = await publishCommunityPost({
      jobId: jobId.value,
      authorName: shareAuthor.value.trim() || 'MoonCut 创作者',
      title: shareTitle.value.trim(),
      caption: shareCaption.value.trim(),
    })
    publishedPostId.value = result.post.id
    shareOpen.value = false
    window.dispatchEvent(new Event('mooncut:community-published'))
    toast.value = result.created ? '作品已经分享到社区' : '这条作品已经在社区里了'
    emit('pet-message', '发布成功啦！去社区看看大家的口播作品吧！')
  } catch (error) {
    toast.value = error instanceof Error ? error.message : '社区发布失败'
  } finally {
    isPublishingCommunity.value = false
  }
}

function downloadResult() {
  if (!jobId.value) return
  const anchor = document.createElement('a')
  anchor.href = artifactUrl(jobId.value)
  anchor.download = `MoonCut-${asset.value?.name ?? '成片.mp4'}`
  anchor.click()
}

function cycleSubtitleStyle() {
  const styles = ['重点词强调', '极简白字', '综艺描边'] as const
  subtitleStyle.value = styles[(styles.indexOf(subtitleStyle.value) + 1) % styles.length]
}

async function resumeSavedJob() {
  const savedId = localStorage.getItem(activeJobKey) ?? localStorage.getItem(lastJobKey)
  if (!savedId) return
  const generation = ++pollGeneration
  try {
    const job = await getEditJob(savedId)
    jobId.value = savedId
    completedJob.value = job
    asset.value = {
      name: job.originalName || 'MoonCut 任务',
      sizeLabel: job.status === 'completed' ? '后台任务 · 已完成' : '后台任务 · 处理中',
      url: job.status === 'completed' ? artifactUrl(job.id) : undefined,
      resultUrl: job.status === 'completed' ? artifactUrl(job.id) : undefined,
      jobId: job.id,
      source: 'upload',
    }
    if (job.mail?.recipient) {
      notificationEnabled.value = true
      notificationEmail.value = job.mail.recipient
    }
    imageGenerationMode.value = job.request?.imageGeneration ?? 'auto'
    if (job.status === 'completed') {
      await finishJob(job)
    } else if (job.status === 'failed') {
      localStorage.removeItem(activeJobKey)
      stage.value = 'ready'
      toast.value = job.error || '上一次剪辑任务失败'
    } else {
      stage.value = 'processing'
      progress.value = Math.max(2, Math.round(job.progress * 100))
      await pollJob(job.id, generation)
    }
  } catch (error) {
    localStorage.removeItem(activeJobKey)
    toast.value = error instanceof Error ? `恢复任务失败：${error.message}` : '恢复任务失败'
  }
}

onBeforeUnmount(() => {
  if (localUrl) URL.revokeObjectURL(localUrl)
  if (toastTimer) window.clearTimeout(toastTimer)
  pollGeneration += 1
})

onMounted(async () => {
  try {
    const [status, capabilities] = await Promise.all([getMailStatus(), listCapabilityInstallations()])
    mailAuthorized.value = status.authorized
    mailAutomatic.value = status.automatic
    mailSender.value = status.aliases.find((alias) => alias.is_primary)?.email ?? status.aliases[0]?.email ?? ''
    installedCapabilities.value = capabilities.items
  } catch {
    mailAuthorized.value = false
  }
  await resumeSavedJob()
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
          <img
            v-if="currentTheme === 'memphis'"
            class="memphis-sticker upload-sticker"
            src="/memphis-icons/upload-file-line.png"
            alt=""
            width="52"
            height="52"
          />
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
        <div class="setting-row">
          <span><ImagePlus :size="17" /> AI 示例图</span>
          <div class="segmented-control" aria-label="AI 示例图调度">
            <button
              type="button"
              :class="{ 'is-selected': imageGenerationMode === 'auto' }"
              :aria-pressed="imageGenerationMode === 'auto'"
              @click="imageGenerationMode = 'auto'"
            >按需 · 最多2张</button>
            <button
              type="button"
              :class="{ 'is-selected': imageGenerationMode === 'off' }"
              :aria-pressed="imageGenerationMode === 'off'"
              @click="imageGenerationMode = 'off'"
            >关闭</button>
          </div>
        </div>
        <section v-if="enabledTaskCapabilities.length" class="task-capability-picker" aria-label="本次任务使用的 Pi 能力">
          <div><span><PackageCheck :size="16" /> 本次让 Pi 使用</span><small>仅将你主动选定的已安装能力写入任务版本快照。</small></div>
          <button
            v-for="capability in enabledTaskCapabilities"
            :key="capability.id"
            type="button"
            :class="{ 'is-selected': selectedCapabilityIds.includes(capability.id) }"
            :aria-pressed="selectedCapabilityIds.includes(capability.id)"
            @click="toggleTaskCapability(capability.id)"
          >
            <span><Check v-if="selectedCapabilityIds.includes(capability.id)" :size="13" /><template v-else>+</template></span>
            <strong>{{ capability.name }}</strong><small>v{{ capability.version }}</small>
          </button>
          <div v-if="selectedFifaInstallation" class="task-capability-evidence">
            <strong><ImagePlus :size="14" /> FIFA 赛况证据（可选）</strong>
            <input v-model.trim="fifaEvidenceMatchId" maxlength="48" placeholder="比赛编号，例如 M95">
            <label><input v-model="fifaEvidenceRequested" type="checkbox"> <span>将中文赛况截图加入本次视频</span></label>
            <small>勾选并开始任务，即明确同意访问百度体育公开页面，保存一张任务私有截图；不会下载视频、不会使用登录态，也不会自动发布。</small>
          </div>
        </section>
        <div class="email-delivery-card" :class="{ 'is-enabled': notificationEnabled }">
          <button
            class="email-delivery-toggle"
            type="button"
            :aria-pressed="notificationEnabled"
            @click="notificationEnabled = !notificationEnabled"
          >
            <span class="email-delivery-icon"><MailCheck :size="18" /></span>
            <span><strong>{{ mailAutomatic ? '成片完成后自动发到邮箱' : '成片完成后准备邮件' }}</strong><small>{{ mailAuthorized ? `由 ${mailSender || 'Agent Mail'} 安全发送` : '邮件服务尚未连接' }}</small></span>
            <i><b /></i>
          </button>
          <label v-if="notificationEnabled" class="email-field">
            <span>收件邮箱</span>
            <input v-model.trim="notificationEmail" type="email" autocomplete="email" placeholder="name@example.com">
            <small v-if="notificationEmail && !emailValid">请检查邮箱格式</small>
            <small v-else>{{ mailAutomatic ? '任务完成后由预授权事务邮件服务自动发送。' : '任务会在后台继续；完成后按 Agent Mail 安全规则确认发送。' }}</small>
          </label>
        </div>
        <div class="settings-spacer" />
        <div class="privacy-note"><Check :size="15" /> 视频只发送到你配置的 MoonCut Agent</div>
        <button class="primary-button large-button" type="button" :disabled="notificationEnabled && (!emailValid || !mailAuthorized)" @click="beginProcessing">
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
            v-for="(item, index) in currentProcessingSteps"
            :key="item.label"
            :class="{ 'is-done': index < activeStep, 'is-active': index === activeStep }"
          >
            <span><Check v-if="index < activeStep" :size="14" /><template v-else>{{ index + 1 }}</template></span>
            <p><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></p>
          </div>
        </div>
        <p class="safe-leave-note"><Clock3 :size="15" /> {{ notificationEnabled ? mailAutomatic ? `完成后将自动发送到 ${notificationEmail}` : `完成后将为 ${notificationEmail} 准备邮件` : '可以切到录制间，任务会继续运行' }}</p>
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
          <VideoSurface v-if="resultAsset" :asset="resultAsset" :failed="videoFailed" controls @error="videoFailed = true" @time="previewPlaybackSeconds = $event" />
          <span class="video-chip">{{ previewMode === 'after' ? 'MoonCut 成片' : '原片对比' }}</span>
          <template v-if="previewMode === 'after'">
            <div class="caption-preview">把素口播，剪成<strong>能发的成片</strong></div>
            <span class="corner-mark">MOONCUT ✦</span>
          </template>
        </div>
      </div>

      <aside class="result-card">
        <span class="success-kicker">
          <CheckCircle2 :size="17" />
          <img v-if="currentTheme === 'memphis'" class="memphis-sticker success-sticker" src="/memphis-icons/check-circle.png" alt="" width="20" height="20">
          成片已完成
        </span>
        <h2>节奏更紧了，<br>表达还是你的。</h2>
        <p class="result-description">{{ resultSummary }}</p>
        <div class="result-stats">
          <div><strong>{{ resultDuration }}<small v-if="resultDuration !== '—'">秒</small></strong><span>成片时长</span></div>
          <div><strong>{{ resultModel }}</strong><span>规划模型</span></div>
          <div><strong>{{ resultQuality }}</strong><span>质量检查</span></div>
        </div>
        <div class="result-checks">
          <span><Check :size="14" /> 1080P 高清</span><span><Check :size="14" /> 节奏字幕已生成</span><span><Check :size="14" /> 原画质保留</span>
          <span v-if="generatedVisualCount > 0"><ImagePlus :size="14" /> AI 示例图 {{ generatedVisualCount }} 张</span>
          <span v-else><Check :size="14" /> 未滥用生成素材</span>
        </div>
        <section v-if="usedCapabilities.length" class="result-capability-proof" aria-label="本视频使用的 Pi 能力">
          <strong><PackageCheck :size="15" /> 本视频使用的 Pi 能力</strong>
          <span v-for="capability in usedCapabilities" :key="capability.installationId">
            {{ usedCapabilityLabel(capability.installationId, capability.slug) }} · v{{ capability.version }} · {{ capability.manifestHash.slice(0, 10) }}
          </span>
          <small>任务已固定此 release 快照；对应的来源与证据产物可在能力调用记录中追溯。</small>
        </section>
        <section class="subtitle-repair-card" :class="{ 'is-open': repairOpen }" aria-label="人工字幕修复">
          <button v-if="!repairOpen" type="button" class="subtitle-repair-launch" @click="repairOpen = true">
            <span class="subtitle-repair-icon"><MessageSquareMore :size="17" /></span>
            <span><strong>字幕有问题？让 Agent 修一版</strong><small>输入反馈，保留原成片并生成可切换的修订版本</small></span>
            <ArrowRight :size="17" />
          </button>
          <form v-else class="subtitle-repair-form" @submit.prevent="submitSubtitleRepair">
            <div class="subtitle-repair-form-title">
              <strong><Captions :size="15" /> 人工字幕修复</strong>
              <button type="button" aria-label="取消字幕修复" @click="repairOpen = false"><X :size="15" /></button>
            </div>
            <label>
              <span>问题描述</span>
              <textarea v-model.trim="repairInstruction" required minlength="2" maxlength="2000" rows="3" placeholder="例如：12 秒处把「MoonCut」识别成了「梦卡」，请修正。" />
            </label>
            <div class="subtitle-repair-location">
              <label>
                <span><MapPin :size="13" /> 定位时间（秒）</span>
                <input v-model.trim="repairAtInput" inputmode="decimal" placeholder="例如 12.5">
              </label>
              <button type="button" @click="usePreviewTimeForRepair">使用当前播放位置</button>
            </div>
            <small class="repair-location-hint">{{ repairAtLabel }}</small>
            <label>
              <span>正确字幕 <em>可选</em></span>
              <input v-model.trim="repairReplacement" maxlength="160" placeholder="直接填入你想显示的文字">
            </label>
            <p><Sparkles :size="14" /> Agent 只会修改确认受影响的字幕，再渲染一个新版本。</p>
            <button class="primary-button" type="submit" :disabled="repairInstruction.trim().length < 2 || isSubtitleRepairing">
              {{ isSubtitleRepairing ? '修复任务已启动…' : '交给 Agent 修复' }} <ArrowRight :size="15" />
            </button>
          </form>
          <div v-if="activeRepairAnalysis" class="subtitle-repair-analysis">
            <div><CheckCircle2 :size="15" /><strong>本版修复记录</strong><small>{{ activeRepairAnalysis.model }}</small></div>
            <p>{{ activeRepairAnalysis.summary }}</p>
            <ul>
              <li v-for="change in activeRepairAnalysis.changes" :key="`${change.segmentIndex}-${change.after}`">
                <span>{{ formatRepairTime(change.startMs) }}</span><del>{{ change.before }}</del><ArrowRight :size="13" /><ins>{{ change.after }}</ins>
              </li>
            </ul>
          </div>
          <div v-if="repairVersions.length > 1 || isLoadingRepairHistory" class="subtitle-repair-versions">
            <span>字幕版本</span>
            <div>
              <button
                v-for="(version, index) in repairVersions"
                :key="version.id"
                type="button"
                :class="{ 'is-active': version.id === jobId }"
                :disabled="version.status !== 'completed'"
                @click="selectSubtitleVersion(version)"
              >{{ index === 0 ? '初版' : `修订 ${index}` }}</button>
              <small v-if="isLoadingRepairHistory">加载中…</small>
            </div>
          </div>
        </section>
        <div v-if="completedJob?.mail" class="mail-result-card" :class="`status-${completedJob.mail.status}`">
          <span class="mail-result-icon"><Mail :size="17" /></span>
          <div>
            <strong v-if="completedJob.mail.status === 'sent'">成片邮件已发送</strong>
            <strong v-else-if="pendingMail">邮件已准备，等你确认</strong>
            <strong v-else>正在准备完成通知</strong>
            <small>{{ completedJob.mail.recipient }}</small>
          </div>
          <button v-if="pendingMail" type="button" :disabled="isConfirmingMail" @click="confirmCompletionEmail">
            {{ isConfirmingMail ? '发送中…' : '确认发送' }}
          </button>
          <CheckCircle2 v-else-if="completedJob.mail.status === 'sent'" :size="20" />
        </div>
        <div class="community-share-card" :class="{ 'is-open': shareOpen, 'is-published': publishedPostId }">
          <button
            v-if="!shareOpen && !publishedPostId"
            type="button"
            :disabled="resultQuality !== '通过'"
            @click="shareOpen = true"
          >
            <span><Share2 :size="17" /></span>
            <span><strong>分享到 MoonCut 社区</strong><small>由你主动发布，历史成片不会自动公开</small></span>
            <ArrowRight :size="17" />
          </button>
          <button v-else-if="publishedPostId && !shareOpen" type="button" @click="emit('open-community')">
            <span><CheckCircle2 :size="17" /></span>
            <span><strong>作品已在社区</strong><small>去看看其他创作者的口播</small></span>
            <ArrowRight :size="17" />
          </button>
          <div v-else class="community-share-form">
            <div><strong><Share2 :size="15" /> 发布到社区</strong><button type="button" aria-label="取消发布" @click="shareOpen = false"><X :size="15" /></button></div>
            <label><span>署名</span><input v-model.trim="shareAuthor" maxlength="32" placeholder="MoonCut 创作者"></label>
            <label><span>作品标题</span><input v-model.trim="shareTitle" maxlength="80" placeholder="给这条口播起个标题"></label>
            <label><span>一句介绍</span><textarea v-model.trim="shareCaption" maxlength="280" rows="2" placeholder="说说这条口播想分享什么" /></label>
            <button class="primary-button" type="button" :disabled="isPublishingCommunity || !shareTitle.trim()" @click="shareToCommunity">
              {{ isPublishingCommunity ? '发布中…' : '确认发布' }} <Share2 :size="15" />
            </button>
          </div>
        </div>
        <button class="primary-button large-button" type="button" @click="downloadResult">
          <img v-if="currentTheme === 'memphis'" class="memphis-sticker button-sticker" src="/memphis-icons/download-file-line.png" alt="" width="20" height="20">
          <Download v-else :size="18" /> 下载成片
        </button>
        <div class="result-actions">
          <button type="button" @click="beginProcessing"><RotateCcw :size="15" /> 重新剪一版</button>
          <button type="button" @click="reset"><X :size="15" /> 换个视频</button>
        </div>
      </aside>
    </div>

    <ToastMessage :message="toast" />
  </section>
</template>
