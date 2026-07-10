<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  Captions,
  MessagesSquare,
  Mic2,
  Scissors,
  ShieldCheck,
  Sparkles,
  Upload,
} from '@lucide/vue'
import type { WorkspacePage } from '../types'

const emit = defineEmits<{ navigate: [page: Exclude<WorkspacePage, 'landing'>] }>()

type FlowStep = {
  className: string
  label: string
}

const valueItems = [
  { icon: MessagesSquare, label: '一起聊出内容' },
  { icon: Mic2, label: '提词录制' },
  { icon: Scissors, label: '精简停顿与重复' },
  { icon: Captions, label: '字幕与节奏包装' },
  { icon: ShieldCheck, label: '本地演示' },
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

const flowSegments = computed<FlowStep[]>(() => [
  { className: 'flow-idea', label: '想法' },
  { className: 'flow-script', label: '脚本' },
  { className: 'flow-record', label: '提词录制' },
  { className: 'flow-clip', label: '智能剪辑' },
  { className: 'flow-done', label: '成片' },
])

const demoStage = ref(0)
let demoTimer: number | null = null

function startDemo() {
  if (prefersReducedMotion.value) return
  stopDemo()
  demoStage.value = 0
  demoTimer = window.setInterval(() => {
    demoStage.value = (demoStage.value + 1) % 4
  }, 2200)
}

function stopDemo() {
  if (demoTimer !== null) {
    window.clearInterval(demoTimer)
    demoTimer = null
  }
}

const revealSteps = ref(new Set<number>())
let stepObserver: IntersectionObserver | null = null

const prefersReducedMotion = ref(false)

function updateMotionPreference() {
  prefersReducedMotion.value =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

onMounted(() => {
  updateMotionPreference()
  if (typeof window !== 'undefined' && window.matchMedia) {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    media.addEventListener?.('change', updateMotionPreference)
  }

  startDemo()

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
    document.querySelectorAll('.flow-node').forEach((node) => stepObserver?.observe(node))
  } else {
    workflowSteps.forEach((_, index) => revealSteps.value.add(index))
  }
})

onBeforeUnmount(() => {
  stopDemo()
  stepObserver?.disconnect()
})

function goRecord() {
  emit('navigate', 'record')
}

function goEdit() {
  emit('navigate', 'edit')
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
    <!-- 顶部导航 -->
    <header class="landing-nav" role="banner">
      <div class="landing-nav-inner">
        <div class="landing-brand" aria-label="MoonCut">
          <span class="landing-brand-mark" aria-hidden="true">
            <span class="landing-moon" />
            <span class="landing-spark">✦</span>
          </span>
          <strong>MoonCut</strong>
        </div>
        <nav class="landing-anchors" aria-label="Landing 页内导航">
          <a href="#features" @click="handleAnchorClick($event, 'features')">功能</a>
          <a href="#workflow" @click="handleAnchorClick($event, 'workflow')">工作流</a>
          <a href="#demo" @click="handleAnchorClick($event, 'demo')">隐私与本地演示</a>
        </nav>
        <button class="landing-cta-primary" type="button" @click="goRecord">
          开始创作 <ArrowRight :size="16" />
        </button>
      </div>
    </header>

    <main class="landing-content">
      <!-- Hero -->
      <section class="landing-hero" aria-labelledby="hero-title">
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
              开始创作 <ArrowRight :size="18" />
            </button>
            <button class="landing-cta-secondary" type="button" @click="goEdit">
              <Upload :size="16" /> 直接剪视频
            </button>
          </div>
          <p class="hero-note"><Sparkles :size="13" /> 本地演示 · 素材在你的浏览器里跑流程</p>
        </div>

        <!-- 产品流程演示面板 -->
        <div class="hero-panel" aria-hidden="true">
          <div class="panel-head">
            <span class="panel-title">想法 → 脚本 → 提词录制 → 智能剪辑 → 成片</span>
            <span class="panel-status">
              <span class="status-led" :class="`stage-${demoStage}`" />
              {{ ['准备脚本', '提词录制', '智能剪辑', '生成成片'][demoStage] }}
            </span>
          </div>

          <div class="panel-flow">
            <span
              v-for="(segment, index) in flowSegments"
              :key="segment.label"
              class="flow-chip"
              :class="[segment.className, { 'is-active': index <= demoStage }]"
            >
              <i>{{ index + 1 }}</i>{{ segment.label }}
            </span>
          </div>

          <div class="panel-stage" :class="`demo-stage-${demoStage}`">
            <!-- 脚本行 -->
            <div class="demo-script">
              <div class="script-line" :class="{ 'is-on': demoStage >= 0 }">
                <span class="script-role">助手</span>
                <p>先说一个常见误区，观众更有代入感。</p>
              </div>
              <div class="script-line" :class="{ 'is-on': demoStage >= 1 }">
                <span class="script-role">你</span>
                <p>如果口播总没人看，先检查开头这句话。</p>
              </div>
            </div>

            <!-- 波形 -->
            <div class="demo-waveform">
              <span
                v-for="(height, index) in [22, 38, 18, 44, 30, 14, 50, 26, 36, 20, 42, 16, 32, 48, 24]"
                :key="index"
                class="wave-bar"
                :class="{ 'is-playing': demoStage === 1 }"
                :style="{ height: `${height}px` }"
              />
            </div>

            <!-- 时间线 -->
            <div class="demo-timeline">
              <div class="timeline-track">
                <span
                  v-for="(marker, index) in ['停顿', '重复', '重点', '字幕']"
                  :key="marker"
                  class="timeline-marker"
                  :class="[`marker-${index}`, { 'is-done': demoStage >= 2 }]"
                >{{ marker }}</span>
              </div>
              <div class="timeline-base" />
            </div>

            <div class="demo-caption" :class="{ 'is-visible': demoStage === 3 }">
              把素口播，剪成<strong>能发的成片</strong>
            </div>
          </div>
        </div>
      </section>

      <!-- 价值信息条 -->
      <section class="value-bar" aria-label="核心价值">
        <div class="value-inner">
          <span
            v-for="item in valueItems"
            :key="item.label"
            class="value-item"
          >
            <component :is="item.icon" :size="15" />
            {{ item.label }}
          </span>
        </div>
      </section>

      <!-- 核心能力 -->
      <section id="features" class="capability" aria-labelledby="capability-title">
        <header class="section-head">
          <span class="section-eyebrow">核心能力</span>
          <h2 id="capability-title" class="section-title">想清楚、说自然、只剪该剪的</h2>
          <p class="section-desc">不是三个不相干的功能，而是一条顺着口播创作走的连贯路径。</p>
        </header>

        <div class="capability-grid">
          <!-- 主模块 -->
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

            <!-- 微型界面：脚本卡 -->
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

          <!-- 两个错落模块 -->
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

      <!-- 完整工作流 -->
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

      <!-- 产品实景展示 -->
      <section class="showcase" aria-labelledby="showcase-title">
        <header class="section-head">
          <span class="section-eyebrow">产品实景</span>
          <h2 id="showcase-title" class="section-title">两段创作路径的真实样子</h2>
        </header>

        <div class="showcase-grid">
          <!-- A：口播助手 + 提词录制 -->
          <article class="showcase-card showcase-a">
            <header>
              <span class="showcase-kicker"><MessagesSquare :size="14" /> 口播助手 · 提词录制</span>
              <h3>从聊明白，到看着稿念</h3>
            </header>
            <div class="showcase-mock" aria-hidden="true">
              <div class="mock-chat">
                <div class="mock-bubble assistant">
                  <span class="mock-avatar" aria-hidden="true"><Sparkles :size="12" /></span>
                  <p>先把要讲的事缩成一句话。</p>
                </div>
                <div class="mock-bubble user"><p>讲为什么开头 3 秒很关键。</p></div>
              </div>
              <div class="mock-divider" aria-hidden="true" />
              <div class="mock-tele">
                <div class="mock-tele-head"><span class="mock-rec" /><span>RECORDING</span><span>00:09</span></div>
                <div class="mock-tele-copy">
                  <p class="is-current">如果你的口播总没人看，</p>
                  <p>先检查开头这句话。</p>
                </div>
              </div>
            </div>
          </article>

          <!-- B：上传素材 + 字幕时间线 -->
          <article class="showcase-card showcase-b">
            <header>
              <span class="showcase-kicker"><Scissors :size="14" /> 上传素材 · 剪辑时间线</span>
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

      <!-- 隐私与本地演示 -->
      <section id="demo" class="privacy" aria-labelledby="privacy-title">
        <header class="section-head">
          <span class="section-eyebrow">隐私与本地演示</span>
          <h2 id="privacy-title" class="section-title">当前能体验什么、不能体验什么</h2>
        </header>
        <div class="privacy-grid">
          <div class="privacy-card">
            <ShieldCheck :size="20" />
            <p>素材在浏览器<strong>本地演示流程</strong>中处理，脚本草稿存在本地。</p>
          </div>
          <div class="privacy-card">
            <Sparkles :size="20" />
            <p>你可以先完整体验<strong>脚本、录制和剪辑</strong>的路径，再决定怎么用。</p>
          </div>
          <div class="privacy-card">
            <Captions :size="20" />
            <p>这是 Demo：<strong>不夸大</strong>真实模型能力、服务端处理或数据安全承诺。</p>
          </div>
        </div>
      </section>

      <!-- 最终 CTA -->
      <section class="final-cta" aria-labelledby="final-title">
        <h2 id="final-title" class="final-title">下一条口播，从一句还没想完整的话开始。</h2>
        <div class="final-actions">
          <button class="landing-cta-primary" type="button" @click="goRecord">
            开始创作 <ArrowRight :size="18" />
          </button>
          <button class="landing-cta-secondary" type="button" @click="goEdit">
            <Upload :size="16" /> 上传视频
          </button>
        </div>
      </section>

      <footer class="landing-footer">
        <div class="footer-brand">
          <span class="landing-brand-mark small" aria-hidden="true">
            <span class="landing-moon" />
            <span class="landing-spark">✦</span>
          </span>
          <span>MoonCut · 本地演示</span>
        </div>
        <p class="footer-note">从一句话开始，陪你走到一条能发的口播。</p>
      </footer>
    </main>
  </div>
</template>