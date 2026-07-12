<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  Captions,
  CircleHelp,
  LogIn,
  LogOut,
  Mail,
  MessagesSquare,
  Mic2,
  Scissors,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
} from '@lucide/vue'
import type { AuthMode } from '../lib/navigation'
import BrandLogo from './BrandLogo.vue'

defineProps<{
  userEmail?: string | null
}>()

const emit = defineEmits<{
  navigateCreate: []
  navigateEdit: []
  openAuth: [mode: AuthMode]
  openCommunity: []
  openStudio: []
  openPricing: []
  openPrivacy: []
  logout: []
}>()

// Kept on the root element so CDN clients always receive the matching app bundle after a landing release.
const landingRelease = '2026-07-11-workflow-glow'

const outcomeCompare = {
  heading: '把时间，留给表达',
  charts: [
    {
      key: 'delivery',
      title: '从录制就绪到可发布',
      ariaLabel: '从录制就绪到可发布：人工精剪 5 小时；通用 AI 18 分钟；MoonCut 1 分钟。',
      ticks: [{ pct: 25 }, { pct: 50 }, { pct: 75 }, { pct: 100 }],
      columns: [
        { key: 'manual', label: '人工精剪', tone: 'manual' as const, display: '5 小时', heightPct: 100 },
        { key: 'ai', label: '通用 AI', tone: 'ai' as const, display: '18 分钟', heightPct: 57 },
        { key: 'mooncut', label: 'MoonCut', tone: 'mooncut' as const, display: '1 分钟', heightPct: 14, lead: true },
      ],
    },
    {
      key: 'completion',
      title: '成片完成度',
      ariaLabel: '成片完成度：原始口播 60；人工精剪 90；通用 AI 78；MoonCut 92。',
      ticks: [{ pct: 25 }, { pct: 50 }, { pct: 75 }, { pct: 100 }],
      columns: [
        { key: 'raw', label: '原始口播', tone: 'raw' as const, display: '60', heightPct: 60 },
        { key: 'manual', label: '人工精剪', tone: 'manual' as const, display: '90', heightPct: 90 },
        { key: 'ai', label: '通用 AI', tone: 'ai' as const, display: '78', heightPct: 78 },
        { key: 'mooncut', label: 'MoonCut', tone: 'mooncut' as const, display: '92', heightPct: 92, lead: true },
      ],
    },
    {
      key: 'control',
      title: '创作链路可控性',
      ariaLabel: '创作链路可控性：原始口播 1 步；人工精剪 4 步；通用 AI 2 步；MoonCut 5 步。',
      ticks: [{ pct: 20 }, { pct: 40 }, { pct: 60 }, { pct: 80 }, { pct: 100 }],
      columns: [
        { key: 'raw', label: '原始口播', tone: 'raw' as const, display: '1 步', heightPct: 20 },
        { key: 'manual', label: '人工精剪', tone: 'manual' as const, display: '4 步', heightPct: 80 },
        { key: 'ai', label: '通用 AI', tone: 'ai' as const, display: '2 步', heightPct: 40 },
        { key: 'mooncut', label: 'MoonCut', tone: 'mooncut' as const, display: '5 步', heightPct: 100, lead: true },
      ],
    },
    {
      key: 'deliverables',
      title: '可交付创作资产',
      ariaLabel: '可交付创作资产：原始口播 1 项；人工精剪 3 项；通用 AI 2 项；MoonCut 5 项。',
      ticks: [{ pct: 20 }, { pct: 40 }, { pct: 60 }, { pct: 80 }, { pct: 100 }],
      columns: [
        { key: 'raw', label: '原始口播', tone: 'raw' as const, display: '1 项', heightPct: 20 },
        { key: 'manual', label: '人工精剪', tone: 'manual' as const, display: '3 项', heightPct: 60 },
        { key: 'ai', label: '通用 AI', tone: 'ai' as const, display: '2 项', heightPct: 40 },
        { key: 'mooncut', label: 'MoonCut', tone: 'mooncut' as const, display: '5 项', heightPct: 100, lead: true },
      ],
    },
  ],
}

const valueItems = [
  { icon: MessagesSquare, label: '一起聊出内容' },
  { icon: Mic2, label: '提词录制' },
  { icon: Scissors, label: '精简停顿与重复' },
  { icon: Captions, label: '字幕与节奏包装' },
  { icon: ShieldCheck, label: '账户任务与邮件通知' },
]

/** Real finished cuts made with MoonCut — compressed for web playback. */
const finishedWorks = [
  {
    id: 'football',
    kicker: '足球剪辑成片',
    title: '阿根廷 vs 埃及 · 比赛解读',
    detail: '仓库最新足球向成片：赛事分析口播，字幕与证据镜头已打包。',
    src: '/showcase/football-argentina-egypt.mp4',
    poster: '/showcase/football-argentina-egypt-poster.jpg',
    meta: '约 1:37 · 16:9',
  },
  {
    id: 'koubo-raw',
    kicker: '口播成片',
    title: '真实口播导出',
    detail: '用 MoonCut 路径产出的口播成片，可直接在页面里观看完整节奏与成片效果。',
    src: '/showcase/koubo-raw-sample.mp4',
    poster: '/showcase/koubo-raw-sample-poster.jpg',
    meta: '约 1:23 · 16:9',
  },
] as const

const workVideoRefs = ref<Record<string, HTMLVideoElement | null>>({})

function setWorkVideoRef(id: string, el: unknown) {
  workVideoRefs.value[id] = el instanceof HTMLVideoElement ? el : null
}

/** Only one showcase clip plays at a time. */
function onWorkPlay(id: string) {
  for (const [key, video] of Object.entries(workVideoRefs.value)) {
    if (key !== id && video && !video.paused) video.pause()
  }
}

const workflowSteps = [
  { num: '01', label: '说出想法', hint: '和助手聊清楚要讲什么', status: '已准备' },
  { num: '02', label: '整理成稿', hint: '生成可念、可改的口播稿', status: '脚本生成' },
  { num: '03', label: '提词录制', hint: '看着稿，对着镜头录下来', status: '录制就绪' },
  { num: '04', label: '自动精简', hint: '去掉停顿、重复和空档', status: '节奏处理中' },
  { num: '05', label: '检查并导出', hint: '加上字幕，成片完成', status: '准备发布' },
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
    el.loop = true
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

function handleAnchorClick(event: MouseEvent, id: string) {
  const target = document.getElementById(id)
  if (target) {
    event.preventDefault()
    target.scrollIntoView({ behavior: prefersReducedMotion.value ? 'auto' : 'smooth', block: 'start' })
  }
}
</script>

<template>
  <div class="landing-shell" :data-release="landingRelease">
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
          <a href="#works" @click="handleAnchorClick($event, 'works')">成片</a>
          <a href="#workflow" @click="handleAnchorClick($event, 'workflow')">工作流</a>
          <button type="button" @click="emit('openStudio')">了解 MoonCut Studio</button>
          <button type="button" @click="emit('openPricing')">定价</button>
          <button type="button" @click="emit('openCommunity')">社区</button>
          <button type="button" @click="emit('openPrivacy')">隐私与政策</button>
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
      <!--
        Cinematic 16:9 hero board. Video is full-bleed atmosphere only —
        product copy lives in the protected left zone; never as text-in-video.
      -->
      <section
        class="landing-hero"
        aria-labelledby="hero-title"
        :class="{
          'is-video-ready': videoReady && shouldRunHeroVideo,
        }"
      >
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
            poster="/landing/hero-city-orbit-poster.png"
            @canplay="onVideoCanPlay"
            @error="onVideoError"
          >
            <source src="/landing/hero-city-orbit.mp4" type="video/mp4">
          </video>
          <div class="hero-contrast" />
          <div class="hero-vignette" />
        </div>

        <div class="hero-stage">
          <div class="hero-copy-zone">
            <div class="hero-copy">
              <span class="hero-eyebrow">AI 口播创作工作台</span>
              <h1 id="hero-title" class="hero-title">
                从一个想法，<br>
                到一条能发的口播。
              </h1>
              <p class="hero-desc">
                一起聊出脚本、对着提词器录下来，
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
              <p class="hero-journey" aria-label="创作路径">
                <span>脚本</span><i aria-hidden="true" />
                <span>提词录制</span><i aria-hidden="true" />
                <span>剪辑时间线</span><i aria-hidden="true" />
                <span>导出</span>
              </p>
            </div>
          </div>
          <div class="hero-focal" aria-hidden="true" />
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
            <h2 id="outcome-heading" class="outcome-compare-heading">
              {{ outcomeCompare.heading }}
            </h2>
          </header>

          <div class="outcome-charts">
            <section
              v-for="chart in outcomeCompare.charts"
              :key="chart.key"
              class="result-chart"
              :aria-labelledby="`${chart.key}-chart-title`"
            >
              <div class="result-chart-head">
                <h3 :id="`${chart.key}-chart-title`" class="result-chart-title">{{ chart.title }}</h3>
              </div>

              <div
                class="bench-plot"
                role="img"
                :aria-label="chart.ariaLabel"
              >
                <div class="bench-body">
                  <div class="bench-area">
                    <div class="bench-grid" aria-hidden="true">
                      <i
                        v-for="tick in chart.ticks"
                        :key="`${chart.key}-grid-${tick.pct}`"
                        class="bench-grid-line"
                        :style="{ '--tick-pct': tick.pct }"
                      />
                    </div>
                    <ul class="bench-cols" role="list">
                      <li
                        v-for="col in chart.columns"
                        :key="`${chart.key}-${col.key}`"
                        class="bench-col"
                        :class="[`tone-${col.tone}`, { 'is-lead': col.lead }]"
                        :style="{ '--col-h': `${col.heightPct}%` }"
                      >
                        <span class="bench-col-value">{{ col.display }}</span>
                        <span
                          class="bench-col-bar"
                          role="img"
                          :aria-label="`${col.label} ${chart.title} ${col.display}`"
                        />
                      </li>
                    </ul>
                    <div class="bench-baseline" aria-hidden="true" />
                  </div>
                </div>
                <ul class="bench-x" aria-hidden="true">
                  <li
                    v-for="col in chart.columns"
                    :key="`${chart.key}-x-${col.key}`"
                    class="bench-x-label"
                    :class="[`tone-${col.tone}`, { 'is-lead': col.lead }]"
                  >{{ col.label }}</li>
                </ul>
              </div>
            </section>
          </div>
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

      <section id="works" class="works" aria-labelledby="works-title">
        <header class="section-head section-head--left">
          <span class="section-eyebrow">真实成片</span>
          <h2 id="works-title" class="section-title">用 MoonCut 做出的口播，长这样</h2>
          <p class="section-desc">两段已经剪好的成品，可直接在页面里观看——不是示意 mock，是真实导出。</p>
        </header>

        <div class="works-grid">
          <article
            v-for="work in finishedWorks"
            :key="work.id"
            class="work-card"
          >
            <div class="work-player">
              <video
                :ref="(el) => setWorkVideoRef(work.id, el)"
                class="work-video"
                :src="work.src"
                :poster="work.poster"
                controls
                playsinline
                preload="metadata"
                controlslist="nodownload"
                @play="onWorkPlay(work.id)"
              >
                你的浏览器暂不支持视频播放。
              </video>
            </div>
            <div class="work-meta">
              <span class="work-kicker">{{ work.kicker }}</span>
              <h3>{{ work.title }}</h3>
              <p>{{ work.detail }}</p>
              <small>{{ work.meta }}</small>
            </div>
          </article>
        </div>
      </section>

      <section id="workflow" class="workflow" aria-labelledby="workflow-title">
        <div class="workflow-topline">
          <header class="section-head section-head--left">
            <span class="section-eyebrow">完整工作流</span>
            <h2 id="workflow-title" class="section-title">一条连续的口播创作路</h2>
            <p class="section-desc">不是五个按钮，是一条顺着走的路。每一步完成后，下一步自然亮起。</p>
          </header>
          <div class="workflow-live" aria-label="工作流实时渲染演示">
            <span class="workflow-live-dot" aria-hidden="true" />
            <span>实时创作路径</span>
            <small>LIVE</small>
          </div>
        </div>

        <ol class="workflow-track">
          <li
            v-for="(step, index) in workflowSteps"
            :key="step.num"
            class="flow-node"
            :data-flow-index="index"
            :class="{ 'is-lit': revealSteps.has(index) }"
          >
            <span class="flow-orb" aria-hidden="true"><i /></span>
            <span class="flow-node-num">{{ step.num }}</span>
            <div class="flow-node-body">
              <strong>{{ step.label }}</strong>
              <span>{{ step.hint }}</span>
            </div>
            <span class="flow-node-status"><i aria-hidden="true" />{{ step.status }}</span>
            <i v-if="index < workflowSteps.length - 1" class="flow-link" aria-hidden="true">
              <b /><b /><b />
            </i>
          </li>
        </ol>
      </section>

      <section class="final-cta" aria-labelledby="final-title">
        <div class="final-cta-inner">
          <div class="final-copy">
            <span class="section-eyebrow">准备好开始了吗</span>
            <h2 id="final-title" class="final-title">下一条口播，从一句还没想完整的话开始。</h2>
            <p>把思路交给对话，把镜头留给表达。其余的，我们陪你走完。</p>
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
          </div>
          <aside class="support-card" aria-label="MoonCut 支持">
            <div class="support-card-icon"><CircleHelp :size="20" aria-hidden="true" /></div>
            <div>
              <span>需要一点帮助？</span>
              <strong>支持与反馈</strong>
              <p>遇到录制、导出或账户问题，直接联系我们。</p>
              <a href="mailto:support@mooncut.me"><Mail :size="15" aria-hidden="true" />support@mooncut.me</a>
            </div>
          </aside>
        </div>
      </section>

      <footer class="landing-footer">
        <div class="footer-brand" aria-label="MoonCut">
          <BrandLogo variant="mark" class="footer-logo-mark" />
          <span class="footer-brand-name">MoonCut</span>
        </div>
        <p class="footer-note">从一句话开始，陪你走到一条能发的口播。</p>
        <p class="landing-footer-links">
          <button type="button" @click="emit('openStudio')">了解 Studio</button>
          <button type="button" @click="emit('openPrivacy')">隐私与政策</button>
          <a href="mailto:support@mooncut.me">支持中心</a>
        </p>
      </footer>
    </main>
  </div>
</template>
