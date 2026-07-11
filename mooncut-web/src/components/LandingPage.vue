<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  Captions,
  LogIn,
  LogOut,
  MessagesSquare,
  Mic2,
  Scissors,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
} from '@lucide/vue'
import type { AuthMode, WorkspaceDestination } from '../lib/navigation'
import BrandLogo from './BrandLogo.vue'

defineProps<{
  userEmail?: string | null
}>()

const emit = defineEmits<{
  navigate: [page: WorkspaceDestination]
  navigateCreate: []
  navigateEdit: []
  openAuth: [mode: AuthMode]
  logout: []
}>()

/**
 * Outcome comparison (below Hero): vertical benchmark-style column charts.
 * Delivery uses a compressed / log-like time scale (not linear 0–5h) so minute-level bars stay legible.
 * Completion is an illustrative linear 0–100 composite (structure · natural delivery · rhythm · subtitle readiness).
 * All figures are local product-design estimates, not public benchmarks or competitor measurements.
 *
 * Delivery heightPct = log-compressed minutes (floor ≈0.4 min → 5 h = 300 min):
 *   h = (log10(m) - log10(0.4)) / (log10(300) - log10(0.4)) * 100
 */
const outcomeCompare = {
  scopeLabel: '单条约 3 分钟口播 · 本地演示估算，不是公开基准测试',
  heading: '把 5 小时，留给表达',
  deliveryTitle: '从录制就绪到可发布',
  deliveryCaption:
    '柱顶数值为本地演示估算的实际时间；纵轴为压缩/对数示意刻度（1 分钟 / 10 分钟 / 1 小时 / 5 小时），仅为分钟级可读性，非线性等比例时间轴。',
  completionTitle: '口播成片完成度（0–100）',
  completionCaption:
    '完成度为结构、表达自然、节奏与字幕就绪程度的产品设计示意综合分，不是通用客观质量分。本地演示估算。',
  footnote:
    '通用 AI 剪辑工具为本地演示估算中的泛指对照，不点名真实竞品；全部数值为产品设计示意，非公开基准测试或独立实测。',
  /** Y-axis ticks for compressed time scale (bottom % of plot). */
  deliveryTicks: [
    { label: '5 小时', pct: 100 },
    { label: '1 小时', pct: 76 },
    { label: '10 分钟', pct: 49 },
    { label: '1 分钟', pct: 14 },
  ],
  deliveryColumns: [
    {
      key: 'manual',
      label: '人工精剪',
      tone: 'manual' as const,
      display: '5 小时',
      heightPct: 100,
    },
    {
      key: 'ai',
      label: '通用 AI 剪辑工具（估算）',
      tone: 'ai' as const,
      display: '18 分钟',
      heightPct: 57,
    },
    {
      key: 'mooncut',
      label: 'MoonCut 口播工作流',
      tone: 'mooncut' as const,
      display: '1 分钟',
      heightPct: 14,
      lead: true,
    },
  ],
  completionTicks: [
    { label: '100', pct: 100 },
    { label: '75', pct: 75 },
    { label: '50', pct: 50 },
    { label: '25', pct: 25 },
    { label: '0', pct: 0 },
  ],
  completionColumns: [
    {
      key: 'raw',
      label: '原始口播',
      tone: 'raw' as const,
      display: '60',
      heightPct: 60,
    },
    {
      key: 'manual',
      label: '人工精剪',
      tone: 'manual' as const,
      display: '90',
      heightPct: 90,
    },
    {
      key: 'ai',
      label: '通用 AI（估算）',
      tone: 'ai' as const,
      display: '78',
      heightPct: 78,
    },
    {
      key: 'mooncut',
      label: 'MoonCut',
      tone: 'mooncut' as const,
      display: '92',
      heightPct: 92,
      lead: true,
    },
  ],
  legend: [
    { tone: 'raw' as const, label: '原始口播' },
    { tone: 'manual' as const, label: '人工精剪' },
    { tone: 'ai' as const, label: '通用 AI（估算）' },
    { tone: 'mooncut' as const, label: 'MoonCut' },
  ],
}

const valueItems = [
  { icon: MessagesSquare, label: '一起聊出内容' },
  { icon: Mic2, label: '提词录制' },
  { icon: Scissors, label: '精简停顿与重复' },
  { icon: Captions, label: '字幕与节奏包装' },
  { icon: ShieldCheck, label: '账户任务与邮件通知' },
]

const capabilityPrimary = {
  index: '01',
  title: '聊想法，长成一篇能说的话',
  detail: '从主题、观点和语气出发，整理成自然口语脚本。助手帮你把零散的思路组织成可以直接念的稿子。',
  tags: ['主题', '观点', '语气'],
  kind: 'script' as const,
}

const capabilitySide = [
  {
    index: '02',
    title: '看着稿，也像在和人说话',
    detail: '提词器、镜像、倒计时和摄像头录制连成一条路。一个镜头，一稿到底。',
    kind: 'teleprompter' as const,
  },
  {
    index: '03',
    title: '只剪影响节奏的部分',
    detail: '识别停顿、重复与口头语，保留表达，完成字幕和节奏包装。',
    kind: 'timeline' as const,
  },
]

const workflowSteps = [
  { num: '01', label: '说出想法', hint: '和助手聊清楚要讲什么' },
  { num: '02', label: '整理成稿', hint: '生成可念、可改的口播稿' },
  { num: '03', label: '提词录制', hint: '看着稿，对着镜头录下来' },
  { num: '04', label: '自动精简', hint: '去掉停顿、重复和空档' },
  { num: '05', label: '检查并导出', hint: '加上字幕，成片完成' },
]

const prefersReducedMotion = ref(
  typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
)
const isNarrowViewport = ref(
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 520px)').matches === true,
)
const heroVideoRef = ref<HTMLVideoElement | null>(null)
const videoReady = ref(false)
const videoFailed = ref(false)
const revealSteps = ref(new Set<number>())

let stepObserver: IntersectionObserver | null = null
let videoObserver: IntersectionObserver | null = null
let motionMedia: MediaQueryList | null = null
let widthMedia: MediaQueryList | null = null

/** Atmosphere video only when motion is allowed and viewport is not ultra-narrow. */
const shouldRunHeroVideo = computed(
  () => !prefersReducedMotion.value && !isNarrowViewport.value && !videoFailed.value,
)

function updateMotionPreference() {
  prefersReducedMotion.value =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function updateViewport() {
  isNarrowViewport.value =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(max-width: 520px)').matches === true
}

async function tryPlayHeroVideo() {
  const el = heroVideoRef.value
  if (!el || !shouldRunHeroVideo.value) return
  try {
    el.muted = true
    el.defaultMuted = true
    await el.play()
  } catch {
    // Autoplay blocked or decode failure — poster remains visible.
    videoFailed.value = true
  }
}

function pauseHeroVideo() {
  const el = heroVideoRef.value
  if (el && !el.paused) el.pause()
}

function onMotionChange() {
  updateMotionPreference()
  if (prefersReducedMotion.value) pauseHeroVideo()
  else void tryPlayHeroVideo()
}

function onWidthChange() {
  updateViewport()
  if (isNarrowViewport.value) pauseHeroVideo()
  else void tryPlayHeroVideo()
}

onMounted(() => {
  updateMotionPreference()
  updateViewport()

  if (typeof window !== 'undefined' && window.matchMedia) {
    motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
    motionMedia.addEventListener?.('change', onMotionChange)

    widthMedia = window.matchMedia('(max-width: 520px)')
    widthMedia.addEventListener?.('change', onWidthChange)
  }

  if (typeof IntersectionObserver !== 'undefined' && !prefersReducedMotion.value) {
    stepObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.target instanceof HTMLElement) {
            const index = Number(entry.target.dataset.flowIndex)
            if (!Number.isNaN(index)) revealSteps.value.add(index)
          }
        })
      },
      { threshold: 0.35 },
    )
    document.querySelectorAll('.landing-shell .flow-node').forEach((node) => stepObserver?.observe(node))

    videoObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.isIntersecting) void tryPlayHeroVideo()
        else pauseHeroVideo()
      },
      { threshold: 0.12 },
    )
    const hero = document.querySelector('.landing-hero')
    if (hero) videoObserver.observe(hero)
  } else {
    workflowSteps.forEach((_, index) => revealSteps.value.add(index))
  }

  void tryPlayHeroVideo()
})

onBeforeUnmount(() => {
  pauseHeroVideo()
  stepObserver?.disconnect()
  videoObserver?.disconnect()
  motionMedia?.removeEventListener?.('change', onMotionChange)
  widthMedia?.removeEventListener?.('change', onWidthChange)
})

function onVideoCanPlay() {
  videoReady.value = true
  void tryPlayHeroVideo()
}

function onVideoError() {
  videoFailed.value = true
}

function goRecord() {
  emit('navigateCreate')
}

function goEdit() {
  emit('navigateEdit')
}

function goWorkspace(page: WorkspaceDestination) {
  emit('navigate', page)
}

function handleAnchorClick(event: MouseEvent, id: string) {
  const target = document.getElementById(id)
  if (target) {
    event.preventDefault()
    target.scrollIntoView({ behavior: prefersReducedMotion.value ? 'auto' : 'smooth', block: 'start' })
  }
}
</script>

<template>
  <div class="landing-shell">
    <header class="landing-nav" role="banner">
      <div class="landing-nav-inner">
        <div class="landing-brand" aria-label="MoonCut">
          <BrandLogo variant="mark" class="landing-brand-logo" />
          <span class="landing-brand-copy" aria-hidden="true">
            <strong>MoonCut</strong>
            <small>口播创作台</small>
          </span>
        </div>

        <nav class="landing-anchors" aria-label="Landing 页内导航">
          <a href="#features" @click="handleAnchorClick($event, 'features')">功能</a>
          <a href="#workflow" @click="handleAnchorClick($event, 'workflow')">工作流</a>
          <a href="#demo" @click="handleAnchorClick($event, 'demo')">隐私与边界</a>
          <button
            v-if="userEmail"
            type="button"
            @click="goWorkspace('queue')"
          >
            <span class="landing-live-dot" aria-hidden="true" /> 运行队列
          </button>
        </nav>

        <div class="landing-nav-actions">
          <template v-if="userEmail">
            <button
              class="landing-account-inline"
              type="button"
              :title="`${userEmail} · 退出登录`"
              aria-label="退出登录"
              @click="emit('logout')"
            >
              <span>{{ userEmail.slice(0, 1).toUpperCase() }}</span>
              <em>{{ userEmail }}</em>
              <LogOut :size="14" aria-hidden="true" />
            </button>
            <button class="landing-cta-primary" type="button" @click="goRecord">
              开始创作 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </template>
          <template v-else>
            <button class="landing-auth-ghost" type="button" @click="emit('openAuth', 'login')">
              <LogIn :size="15" aria-hidden="true" /> 登录
            </button>
            <button class="landing-cta-primary" type="button" @click="goRecord">
              开始创作 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </template>
        </div>
      </div>
    </header>

    <main class="landing-content">
      <section class="landing-hero" aria-labelledby="hero-title">
        <!-- Atmospheric ignition only: supports product story, never replaces it. -->
        <div class="hero-atmosphere" aria-hidden="true">
          <div
            class="hero-poster"
            :class="{ 'is-dimmed': videoReady && shouldRunHeroVideo }"
          />
          <video
            v-if="shouldRunHeroVideo"
            ref="heroVideoRef"
            class="hero-video"
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
          <div class="hero-contrast" />
          <div class="hero-film-grain" />
          <div class="hero-frame-marks">
            <span class="hero-corner tl" />
            <span class="hero-corner tr" />
            <span class="hero-corner bl" />
            <span class="hero-corner br" />
          </div>
        </div>

        <div class="hero-stage">
          <div class="hero-copy">
            <span class="hero-eyebrow">AI 口播创作工作台</span>
            <h1 id="hero-title" class="hero-title">
              从一个想法，<br>
              到一条能发的口播。
            </h1>
            <p class="hero-desc">
              一起聊出脚本、对着提词器录下来，<br>
              再把停顿、重复和字幕交给 MoonCut。
            </p>
            <div class="hero-actions">
              <button class="landing-cta-primary hero-cta" type="button" @click="goRecord">
                开始创作 <ArrowRight :size="18" aria-hidden="true" />
              </button>
              <button class="landing-cta-secondary" type="button" @click="goEdit">
                <Upload :size="16" aria-hidden="true" /> 直接剪视频
              </button>
            </div>
            <p class="hero-note">
              <Sparkles :size="13" aria-hidden="true" />
              {{ userEmail ? '已登录 · 可直接进入工作区' : '未登录可先了解产品 · 创作时再登录' }}
            </p>
            <p class="hero-journey" aria-hidden="true">
              <span>脚本</span><i />
              <span>提词录制</span><i />
              <span>剪辑时间线</span><i />
              <span>导出</span>
            </p>
          </div>
        </div>
      </section>

      <!--
        Independent outcome section (not Hero scoreboard): scroll-reached comparison.
        Vertical benchmark columns — delivery = compressed/log time scale; completion = linear 0–100.
      -->
      <section
        id="outcome"
        class="landing-outcome"
        aria-labelledby="outcome-heading"
      >
        <div class="outcome-compare">
          <header class="outcome-compare-head">
            <span class="outcome-compare-badge">{{ outcomeCompare.scopeLabel }}</span>
            <h2 id="outcome-heading" class="outcome-compare-heading">
              {{ outcomeCompare.heading }}
            </h2>
          </header>

          <div class="outcome-charts">
            <section
              class="result-chart"
              aria-labelledby="delivery-chart-title"
            >
              <div class="result-chart-head">
                <h3 id="delivery-chart-title" class="result-chart-title">
                  {{ outcomeCompare.deliveryTitle }}
                </h3>
                <p class="result-chart-caption">{{ outcomeCompare.deliveryCaption }}</p>
              </div>

              <div
                class="bench-plot"
                role="img"
                :aria-label="`从录制就绪到可发布：${outcomeCompare.deliveryColumns.map((c) => `${c.label} ${c.display}`).join('；')}。纵轴为压缩时间刻度。`"
              >
                <div class="bench-body">
                  <div class="bench-y" aria-hidden="true">
                    <span
                      v-for="tick in outcomeCompare.deliveryTicks"
                      :key="`d-tick-${tick.label}`"
                      class="bench-y-tick"
                      :style="{ '--tick-pct': tick.pct }"
                    >{{ tick.label }}</span>
                  </div>
                  <div class="bench-area">
                    <div class="bench-grid" aria-hidden="true">
                      <i
                        v-for="tick in outcomeCompare.deliveryTicks"
                        :key="`d-grid-${tick.label}`"
                        class="bench-grid-line"
                        :style="{ '--tick-pct': tick.pct }"
                      />
                    </div>
                    <ul class="bench-cols" role="list">
                      <li
                        v-for="col in outcomeCompare.deliveryColumns"
                        :key="`delivery-${col.key}`"
                        class="bench-col"
                        :class="[`tone-${col.tone}`, { 'is-lead': col.lead }]"
                        :style="{ '--col-h': `${col.heightPct}%` }"
                      >
                        <span class="bench-col-value">{{ col.display }}</span>
                        <span
                          class="bench-col-bar"
                          role="img"
                          :aria-label="`${col.label} 从录制就绪到可发布 ${col.display}`"
                        />
                      </li>
                    </ul>
                    <div class="bench-baseline" aria-hidden="true" />
                  </div>
                </div>
                <ul class="bench-x" aria-hidden="true">
                  <li
                    v-for="col in outcomeCompare.deliveryColumns"
                    :key="`d-x-${col.key}`"
                    class="bench-x-label"
                    :class="[`tone-${col.tone}`, { 'is-lead': col.lead }]"
                  >{{ col.label }}</li>
                </ul>
              </div>
            </section>

            <section
              class="result-chart"
              aria-labelledby="completion-chart-title"
            >
              <div class="result-chart-head">
                <h3 id="completion-chart-title" class="result-chart-title">
                  {{ outcomeCompare.completionTitle }}
                </h3>
                <p class="result-chart-caption">{{ outcomeCompare.completionCaption }}</p>
              </div>

              <div
                class="bench-plot"
                role="img"
                :aria-label="`口播成片完成度：${outcomeCompare.completionColumns.map((c) => `${c.label} ${c.display}`).join('；')}。纵轴 0 至 100。`"
              >
                <div class="bench-body">
                  <div class="bench-y" aria-hidden="true">
                    <span
                      v-for="tick in outcomeCompare.completionTicks"
                      :key="`c-tick-${tick.label}`"
                      class="bench-y-tick"
                      :style="{ '--tick-pct': tick.pct }"
                    >{{ tick.label }}</span>
                  </div>
                  <div class="bench-area">
                    <div class="bench-grid" aria-hidden="true">
                      <i
                        v-for="tick in outcomeCompare.completionTicks"
                        :key="`c-grid-${tick.label}`"
                        class="bench-grid-line"
                        :style="{ '--tick-pct': tick.pct }"
                      />
                    </div>
                    <ul class="bench-cols" role="list">
                      <li
                        v-for="col in outcomeCompare.completionColumns"
                        :key="`completion-${col.key}`"
                        class="bench-col"
                        :class="[`tone-${col.tone}`, { 'is-lead': col.lead }]"
                        :style="{ '--col-h': `${col.heightPct}%` }"
                      >
                        <span class="bench-col-value">{{ col.display }}</span>
                        <span
                          class="bench-col-bar"
                          role="img"
                          :aria-label="`${col.label} 口播成片完成度 ${col.display}`"
                        />
                      </li>
                    </ul>
                    <div class="bench-baseline" aria-hidden="true" />
                  </div>
                </div>
                <ul class="bench-x" aria-hidden="true">
                  <li
                    v-for="col in outcomeCompare.completionColumns"
                    :key="`c-x-${col.key}`"
                    class="bench-x-label"
                    :class="[`tone-${col.tone}`, { 'is-lead': col.lead }]"
                  >{{ col.label }}</li>
                </ul>
              </div>
            </section>
          </div>

          <ul class="bench-legend" aria-label="图例">
            <li
              v-for="item in outcomeCompare.legend"
              :key="`legend-${item.tone}`"
              class="bench-legend-item"
              :class="`tone-${item.tone}`"
            >
              <i class="bench-legend-swatch" aria-hidden="true" />
              <span>{{ item.label }}</span>
            </li>
          </ul>

          <footer class="outcome-compare-foot">
            <p class="outcome-compare-footnote">{{ outcomeCompare.footnote }}</p>
          </footer>
        </div>
      </section>

      <section class="value-bar" aria-label="核心价值">
        <div class="value-inner">
          <span
            v-for="item in valueItems"
            :key="item.label"
            class="value-item"
          >
            <component :is="item.icon" :size="15" aria-hidden="true" />
            {{ item.label }}
          </span>
        </div>
      </section>

      <section id="features" class="capability" aria-labelledby="capability-title">
        <header class="section-head">
          <span class="section-eyebrow">核心能力</span>
          <h2 id="capability-title" class="section-title">想清楚、说自然、只剪该剪的</h2>
          <p class="section-desc">不是三个不相干的功能，而是一条顺着口播创作走的连贯路径。</p>
        </header>

        <div class="capability-grid">
          <article class="capability-main">
            <div class="capability-main-head">
              <span class="capability-index">{{ capabilityPrimary.index }}</span>
              <div>
                <h3>{{ capabilityPrimary.title }}</h3>
                <p>{{ capabilityPrimary.detail }}</p>
              </div>
            </div>
            <div class="capability-tags">
              <span v-for="tag in capabilityPrimary.tags" :key="tag">{{ tag }}</span>
            </div>

            <div class="mini-script" aria-hidden="true">
              <div class="mini-script-head">
                <span><MessagesSquare :size="14" /> 助手构思</span>
                <span class="mini-tag">口播稿</span>
              </div>
              <div class="mini-chat">
                <div class="mini-bubble assistant">
                  <small>助手</small>
                  <p>这条口播，最想让观众记住什么？</p>
                </div>
                <div class="mini-bubble user">
                  <small>你</small>
                  <p>先说一个常见误区，再给一个能做的事。</p>
                </div>
              </div>
              <div class="mini-draft">
                <span class="mini-draft-label">成稿</span>
                <p>很多人开头讲得太慢。先把观众最想知道的一句话放最前——先说结果，再解释原因。</p>
              </div>
            </div>
          </article>

          <article
            v-for="capability in capabilitySide"
            :key="capability.index"
            class="capability-side"
          >
            <div class="capability-side-head">
              <span class="capability-index">{{ capability.index }}</span>
              <div>
                <h3>{{ capability.title }}</h3>
                <p>{{ capability.detail }}</p>
              </div>
            </div>

            <div v-if="capability.kind === 'teleprompter'" class="mini-teleprompter" aria-hidden="true">
              <div class="mini-tele-head">
                <span class="mini-rec"><i /> 录制中</span>
                <span>00:12</span>
              </div>
              <div class="mini-tele-copy">
                <p class="is-current">先说一个常见误区，</p>
                <p>观众才有代入感。</p>
                <p>先说结果，再解释原因。</p>
              </div>
              <div class="mini-tele-controls">
                <span><Mic2 :size="13" /> 镜头</span>
                <span><Captions :size="13" /> 提词</span>
              </div>
            </div>

            <div v-else class="mini-timeline" aria-hidden="true">
              <div class="mini-tl-track">
                <span class="mini-tl-seg seg-keep" />
                <span class="mini-tl-seg seg-cut" />
                <span class="mini-tl-seg seg-keep" />
                <span class="mini-tl-seg seg-sub" />
              </div>
              <div class="mini-tl-legend">
                <span><i class="keep" /> 保留</span>
                <span><i class="cut" /> 精简</span>
                <span><i class="sub" /> 字幕</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section id="workflow" class="workflow" aria-labelledby="workflow-title">
        <header class="section-head">
          <span class="section-eyebrow">完整工作流</span>
          <h2 id="workflow-title" class="section-title">一条连续的口播创作路</h2>
          <p class="section-desc">不是五个按钮，是一条顺着走的路。</p>
        </header>

        <ol class="workflow-track">
          <li
            v-for="(step, index) in workflowSteps"
            :key="step.num"
            class="flow-node"
            :data-flow-index="index"
            :class="{ 'is-lit': revealSteps.has(index) }"
          >
            <span class="flow-node-num">{{ step.num }}</span>
            <div class="flow-node-body">
              <strong>{{ step.label }}</strong>
              <span>{{ step.hint }}</span>
            </div>
            <i v-if="index < workflowSteps.length - 1" class="flow-link" aria-hidden="true" />
          </li>
        </ol>
      </section>

      <section class="showcase" aria-labelledby="showcase-title">
        <header class="section-head">
          <span class="section-eyebrow">产品实景</span>
          <h2 id="showcase-title" class="section-title">两段创作路径的真实样子</h2>
        </header>

        <div class="showcase-grid">
          <article class="showcase-card showcase-a">
            <header>
              <span class="showcase-kicker"><MessagesSquare :size="14" aria-hidden="true" /> 口播助手 · 提词录制</span>
              <h3>从聊明白，到看着稿念</h3>
            </header>
            <div class="showcase-mock" aria-hidden="true">
              <div class="mock-chat">
                <div class="mock-bubble assistant">
                  <span class="mock-avatar"><Sparkles :size="12" /></span>
                  <p>先把要讲的事缩成一句话。</p>
                </div>
                <div class="mock-bubble user"><p>讲为什么开头 3 秒很关键。</p></div>
              </div>
              <div class="mock-divider" />
              <div class="mock-tele">
                <div class="mock-tele-head"><span class="mock-rec" /><span>RECORDING</span><span>00:09</span></div>
                <div class="mock-tele-copy">
                  <p class="is-current">如果你的口播总没人看，</p>
                  <p>先检查开头这句话。</p>
                </div>
              </div>
            </div>
          </article>

          <article class="showcase-card showcase-b">
            <header>
              <span class="showcase-kicker"><Scissors :size="14" aria-hidden="true" /> 上传素材 · 剪辑时间线</span>
              <h3>只动节奏，不动表达</h3>
            </header>
            <div class="showcase-mock" aria-hidden="true">
              <div class="mock-upload">
                <span class="mock-upload-icon"><Upload :size="18" /></span>
                <div>
                  <strong>koubo_demo.webm</strong>
                  <small>本地素材 · 已就绪</small>
                </div>
              </div>
              <div class="mock-timeline">
                <span class="mock-seg seg-keep" />
                <span class="mock-seg seg-cut" />
                <span class="mock-seg seg-keep" />
                <span class="mock-seg seg-cut" />
                <span class="mock-seg seg-keep" />
              </div>
              <div class="mock-caption-row">
                <span class="mock-caption">先说一个常见误区</span>
                <span class="mock-caption is-active">再给一个能做的事</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section id="demo" class="privacy" aria-labelledby="privacy-title">
        <header class="section-head">
          <span class="section-eyebrow">隐私与服务边界</span>
          <h2 id="privacy-title" class="section-title">哪些留在浏览器，哪些交给 Agent</h2>
        </header>
        <div class="privacy-grid">
          <div class="privacy-card">
            <ShieldCheck :size="20" aria-hidden="true" />
            <p>脚本草稿保存在<strong>当前浏览器</strong>，模型密钥始终留在服务端。</p>
          </div>
          <div class="privacy-card">
            <Sparkles :size="20" aria-hidden="true" />
            <p>你可以先完整体验<strong>脚本、录制和剪辑</strong>的路径，再决定怎么用。</p>
          </div>
          <div class="privacy-card">
            <Captions :size="20" aria-hidden="true" />
            <p>上传视频进入你配置的<strong>MoonCut Agent</strong>，任务状态与产物由服务端持久化。</p>
          </div>
        </div>
      </section>

      <section class="final-cta" aria-labelledby="final-title">
        <h2 id="final-title" class="final-title">下一条口播，从一句还没想完整的话开始。</h2>
        <div class="final-actions">
          <button class="landing-cta-primary" type="button" @click="goRecord">
            开始创作 <ArrowRight :size="18" aria-hidden="true" />
          </button>
          <button class="landing-cta-secondary" type="button" @click="goEdit">
            <Upload :size="16" aria-hidden="true" /> 上传视频
          </button>
        </div>
        <p v-if="!userEmail" class="final-auth-hint">
          已有账户？
          <button type="button" @click="emit('openAuth', 'login')">登录</button>
          · 新用户可
          <button type="button" @click="emit('openAuth', 'register')">
            <UserPlus :size="13" aria-hidden="true" /> 创建账户
          </button>
        </p>
      </section>

      <footer class="landing-footer">
        <div class="footer-brand">
          <BrandLogo variant="lockup" labeled class="footer-logo-lockup" />
        </div>
        <p class="footer-note">从一句话开始，陪你走到一条能发的口播。</p>
      </footer>
    </main>
  </div>
</template>
