<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Gauge,
  Lightbulb,
  LogIn,
  Maximize2,
  MessagesSquare,
  Mic2,
  Minus,
  Scissors,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from '@lucide/vue'
import type { AuthMode, PostAuthIntent, WorkspaceDestination } from '../lib/navigation'
import BrandLogo from './BrandLogo.vue'
import ThemeToggle from './ThemeToggle.vue'

const props = defineProps<{
  signedIn: boolean
  userEmail?: string | null
}>()

const emit = defineEmits<{
  home: []
  navigate: [page: WorkspaceDestination]
  'open-auth': [payload: { mode: AuthMode; destination: PostAuthIntent }]
  'open-community': []
  'open-privacy': []
}>()

/* ------------------------------------------------------------------ *
 * Lively selection: any plan card can be “picked”. Picking a paid plan
 * when signed-in opens the honest “preparing” panel; when signed-out
 * it still routes to auth. The selection also drives the bottom CTA.
 * ------------------------------------------------------------------ */
type PlanId = 'free' | 'creator' | 'pro'
const selectedPlan = ref<PlanId>('creator')

function selectPlan(id: PlanId) {
  selectedPlan.value = id
}

const selectedPlanLabel = computed(() => {
  const plan = plans.find((item) => item.id === selectedPlan.value)
  return plan ? plan.tier : ''
})

function proceedSelected() {
  if (selectedPlan.value === 'free') {
    chooseFree()
  } else {
    choosePaid(selectedPlan.value as 'creator' | 'pro')
  }
}

/* ------------------------------------------------------------------ *
 * Reveal-on-scroll entrance: staggered fade/rise for hero, cards and
 * sections. Falls back to “already lit” when IntersectionObserver is
 * unavailable or motion is reduced.
 * ------------------------------------------------------------------ */
const revealed = ref(new Set<string>())
let revealObserver: IntersectionObserver | null = null

function reveal(target: string) {
  if (!revealed.value.has(target)) {
    revealed.value = new Set([...revealed.value, target])
  }
}

/* ------------------------------------------------------------------ *
 * Flow trail: a travelling light crosses the 创作 flow bar.
 * ------------------------------------------------------------------ */
const flowStep = ref(0)
let flowTimer: number | null = null

function startFlowTrail() {
  stopFlowTrail()
  if (prefersReducedMotion.value) return
  flowTimer = window.setInterval(() => {
    flowStep.value = (flowStep.value + 1) % flow.length
  }, 1800)
}

function stopFlowTrail() {
  if (flowTimer !== null) {
    window.clearInterval(flowTimer)
    flowTimer = null
  }
}

/* ------------------------------------------------------------------ *
 * CTA helpers
 * ------------------------------------------------------------------ */
// Runtime plan descriptors — pure presentation, never written to state.

function chooseFree() {
  if (props.signedIn) {
    emit('navigate', 'record')
  } else {
    emit('open-auth', { mode: 'register', destination: 'record' })
  }
}

function choosePaid(plan: 'creator' | 'pro') {
  if (props.signedIn) {
    openPreparing(plan)
  } else {
    emit('open-auth', { mode: 'register', destination: 'pricing' })
  }
}

function startEditing() {
  if (props.signedIn) {
    emit('navigate', 'edit')
  } else {
    emit('open-auth', { mode: 'login', destination: 'edit' })
  }
}

/* ------------------------------------------------------------------ *
 * Subscription “preparing” dialog — honest, non-charging, self-contained.
 * No localStorage, no authUser mutation, no plan/entitlement writes.
 * The payment-method chips are visual placeholders only: choosing one
 * or submitting never issues a charge or opens an entitlement.
 * ------------------------------------------------------------------ */
type PaymentMethodId = 'wechat' | 'alipay' | 'card'
const paymentMethods: { id: PaymentMethodId; label: string; hint: string }[] = [
  { id: 'wechat', label: '微信支付', hint: '扫码或扣款' },
  { id: 'alipay', label: '支付宝', hint: '余额或花呗' },
  { id: 'card', label: '银行卡', hint: '借记 / 信用卡' },
]
const selectedPayment = ref<PaymentMethodId>('wechat')
const submittingPreparing = ref(false)
const preparingAcknowledged = ref(false)

const preparingPlan = ref<'creator' | 'pro' | null>(null)
const preparingDialogEl = ref<HTMLElement | null>(null)
const preparingCloseRef = ref<HTMLButtonElement | null>(null)
const preparingTriggerRef = ref<HTMLElement | null>(null)

const preparingPlanLabel = computed(() =>
  preparingPlan.value === 'creator'
    ? 'Creator 创作版'
    : preparingPlan.value === 'pro'
      ? 'Pro 专业版'
      : '',
)

function openPreparing(plan: 'creator' | 'pro') {
  preparingPlan.value = plan
  preparingAcknowledged.value = false
  submittingPreparing.value = false
  preparingTriggerRef.value = document.activeElement as HTMLElement | null
  nextTick(() => {
    preparingCloseRef.value?.focus()
  })
  if (typeof history !== 'undefined') {
    const state = history.state as { mooncutView?: string } | null
    if (state?.mooncutView !== 'preparing') {
      history.pushState({ mooncutView: 'preparing' }, '')
    }
  }
}

function closePreparing(returnFocus = true) {
  if (!preparingPlan.value) return
  preparingPlan.value = null
  preparingAcknowledged.value = false
  submittingPreparing.value = false
  if (typeof history !== 'undefined') {
    const state = history.state as { mooncutView?: string } | null
    if (state?.mooncutView === 'preparing') history.back()
  }
  if (returnFocus) preparingTriggerRef.value?.focus()
}

function onPreparingKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closePreparing(true)
  }
}

function onPopStatePreparing() {
  if (preparingPlan.value) {
    preparingPlan.value = null
  }
}

watch(preparingPlan, (next) => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = next ? 'hidden' : ''
  }
})

/* ------------------------------------------------------------------ *
 * FAQ accordion
 * ------------------------------------------------------------------ */
const faqOpen = ref<Record<number, boolean>>({})

function toggleFaq(index: number) {
  faqOpen.value = { ...faqOpen.value, [index]: !faqOpen.value[index] }
}

/* ------------------------------------------------------------------ *
 * Reduced motion preference
 * ------------------------------------------------------------------ */
const prefersReducedMotion = ref(
  typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
)

let motionMedia: MediaQueryList | null = null

function updateMotion() {
  prefersReducedMotion.value =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/* ------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------ */
type PlanFeature = { label: string; icon: typeof Check }

const plans: Array<{
  id: PlanId
  tier: string
  audience: string
  price: string
  priceUnit: string
  priceNote: string
  features: PlanFeature[]
  limits: string[]
  clarity: '720P' | '1080P' | '4K'
  recommended?: string
  ctaLabel: string
  ctaAction: 'free' | 'paid'
}> = [
  {
    id: 'free',
    tier: 'Free · 体验版',
    audience: '先完整走完一条创作链路，再决定是否持续订阅。',
    price: '¥0',
    priceUnit: '免费开始',
    priceNote: '体验完整的 Studio 创作路径',
    features: [
      { label: 'Studio 基础访问：想法、脚本、提词录制、项目预览', icon: MessagesSquare },
      { label: '新用户智能成片试用：3 次', icon: Sparkles },
      { label: '新手创作点：12 点（一次性发放）', icon: Gauge },
      { label: '720P 无水印导出', icon: Maximize2 },
      { label: '单任务处理', icon: Mic2 },
    ],
    limits: [
      '单次智能成片试用支持最多 5 分钟原始素材',
      '试用额度耗尽后仍可继续基础 Studio，智能处理与导出需升级',
      '不会无限 AI，也不会叠加水印、时长、速度等多重惩罚',
    ],
    clarity: '720P',
    ctaLabel: '免费开始创作',
    ctaAction: 'free',
  },
  {
    id: 'creator',
    tier: 'Creator · 创作版',
    audience: '每周稳定发布的个人创作者。',
    price: '¥39',
    priceUnit: '/ 月',
    priceNote: '买的是更稳的创作量，不是被锁住的基础功能',
    features: [
      { label: '60 智能处理分钟 / 月', icon: Gauge },
      { label: '80 创作点 / 月', icon: Sparkles },
      { label: '1080P 无水印导出', icon: Maximize2 },
      { label: '脚本生成与润色', icon: MessagesSquare },
      { label: '停顿、重复与口头语精简', icon: Scissors },
      { label: '自动字幕与字幕定点修复', icon: Check },
      { label: 'AI 配图与视觉包装额度', icon: Sparkles },
      { label: '2 个并行处理任务', icon: Mic2 },
    ],
    limits: [],
    clarity: '1080P',
    recommended: '适合每周稳定发布的你',
    ctaLabel: '选择 Creator',
    ctaAction: 'paid',
  },
  {
    id: 'pro',
    tier: 'Pro · 专业版',
    audience: '高频内容创作者、课程创作者与专业内容团队。',
    price: '¥149',
    priceUnit: '/ 月',
    priceNote: '为更大的处理量、更高成片规格与更快工作流而设',
    features: [
      { label: '300 智能处理分钟 / 月', icon: Gauge },
      { label: '400 创作点 / 月', icon: Sparkles },
      { label: '4K 无水印导出', icon: Maximize2 },
      { label: '完整 AI 创作能力', icon: Sparkles },
      { label: '3 个并行处理任务', icon: Mic2 },
      { label: '优先渲染队列', icon: Gauge },
    ],
    limits: [],
    clarity: '4K',
    recommended: '为高频、高清与连续交付而设',
    ctaLabel: '选择 Pro',
    ctaAction: 'paid',
  },
]

function onCardCta(plan: (typeof plans)[number]) {
  if (plan.ctaAction === 'free') {
    chooseFree()
  } else {
    choosePaid(plan.id as 'creator' | 'pro')
  }
}

type CompareRow = {
  label: string
  free: string | boolean
  creator: string | boolean
  pro: string | boolean
}

const compareRows: CompareRow[] = [
  { label: 'Studio 基础访问', free: true, creator: true, pro: true },
  { label: '新用户体验额度', free: '试用 3 次 / 12 点', creator: '试用已含体验阶段', pro: '试用已含体验阶段' },
  { label: '智能处理分钟 / 月', free: '0', creator: '60 分钟', pro: '300 分钟' },
  { label: '创作点 / 月', free: '12 点一次性', creator: '80 点', pro: '400 点' },
  { label: '最高导出清晰度', free: '720P', creator: '1080P', pro: '4K' },
  { label: '无水印导出', free: true, creator: true, pro: true },
  { label: '并行处理任务', free: '1 个', creator: '2 个', pro: '3 个' },
  { label: '优先渲染队列', free: false, creator: false, pro: true },
]

const comparePlans = [
  { id: 'free' as const, label: 'Free' },
  { id: 'creator' as const, label: 'Creator' },
  { id: 'pro' as const, label: 'Pro' },
]

function compareValue(row: CompareRow, planId: 'free' | 'creator' | 'pro'): string | boolean {
  return row[planId]
}

const whyBlocks = [
  {
    title: '先让每个人真正体验从想法到成片',
    body: 'Free 不切碎创作链路：想法、脚本、录制、剪辑都开放。我们更关心你走完整条路，这样升级才有意义。',
  },
  {
    title: 'Creator 对应每周稳定创作的处理量',
    body: '60 智能处理分钟、80 创作点覆盖大多数“每周 1–3 条口播”的创作者。1080P 导出满足主流平台发布。',
  },
  {
    title: 'Pro 对应高频、高清与连续交付',
    body: '300 分钟、400 创作点与 4K 导出，服务课程创作者与专业内容团队。并行任务与优先队列让你连续交付时更稳。',
  },
]

const meterNotes = [
  '智能处理分钟：按提交处理的原始视频时长计算，按分钟向上取整；重新提交或重新处理会再次消耗。',
  '创作点：脚本生成、脚本润色、字幕定点修复各消耗 1 点；AI 配图每张消耗 4 点。',
  '订阅额度按自然订阅周期刷新，未用完额度不结转。',
  '实际扣费、续订、退款、升级补差规则必须等后端与支付系统完成后再上线，本页不编造。',
]

const faqs = [
  {
    q: 'Free 可以做什么？',
    a: 'Free 可以进入 Studio，完整走完想法、脚本、提词录制与剪辑预览。新用户有 3 次智能成片试用、12 点一次性创作点，并支持 720P 无水印导出、单任务处理。智能处理分钟 0，试用额度用完后仍可使用基础 Studio。',
  },
  {
    q: '什么是智能处理分钟？',
    a: '智能处理分钟按你提交处理的原始视频时长计算，按分钟向上取整。重新提交或重新处理会再次消耗。Free 不含智能处理分钟，Creator 与 Pro 各自按月配额刷新。',
  },
  {
    q: '什么是创作点？',
    a: '创作点用于 AI 创作能力：脚本生成、脚本润色、字幕定点修复各消耗 1 点；AI 配图每张消耗 4 点。订阅额度按自然订阅周期刷新，未用完额度不结转。',
  },
  {
    q: 'Creator 和 Pro 应该怎么选？',
    a: '如果你是每周稳定发布的个人创作者，且主要发布 1080P 内容，Creator 多数够用。如果你是课程创作者、专业内容团队或需要高频、4K、连续交付与并行任务，Pro 更稳。两者都不锁住基础创作。',
  },
  {
    q: '额度是否结转？',
    a: '不结转。订阅额度按自然订阅周期刷新，当期未用完的部分会在下次刷新时被新的额度取代。',
  },
  {
    q: '能否随时取消？',
    a: '真实订阅与取消能力将在支付系统接入后开放；当前页面不会发起扣款，也不会自动开通付费权益。后端任务创建、导出与队列仍按当前可用量执行。',
  },
]

const flow = [
  { label: '想法', icon: Lightbulb },
  { label: '脚本', icon: MessagesSquare },
  { label: '录制', icon: Mic2 },
  { label: '处理', icon: Scissors },
  { label: '导出', icon: Upload },
]

const clarityVisual = { '720P': '720P', '1080P': '1080P', '4K': '4K' } as const

/* ------------------------------------------------------------------ *
 * Payment-method chips inside the “preparing” dialog. These are visual
 * placeholders only — choosing one never issues a charge or opens an
 * entitlement. The confirmation button always reveals the honest
 * “支付能力准备中” status.
 * ------------------------------------------------------------------ */
function choosePayment(id: PaymentMethodId) {
  selectedPayment.value = id
  preparingAcknowledged.value = false
}

function submitPreparing() {
  if (submittingPreparing.value) return
  submittingPreparing.value = true
  preparingAcknowledged.value = false
  // Simulated handoff to the (not-yet-built) checkout — ends honestly.
  window.setTimeout(() => {
    submittingPreparing.value = false
    preparingAcknowledged.value = true
  }, 900)
}

/* ------------------------------------------------------------------ */
onMounted(() => {
  updateMotion()
  if (typeof window !== 'undefined' && window.matchMedia) {
    motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
    motionMedia.addEventListener?.('change', updateMotion)
  }
  window.addEventListener('popstate', onPopStatePreparing)

  // Reveal-on-scroll for [data-reveal] elements.
  if (typeof IntersectionObserver !== 'undefined' && !prefersReducedMotion.value) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (
            entry.isIntersecting &&
            entry.target instanceof HTMLElement &&
            entry.target.dataset.reveal
          ) {
            reveal(entry.target.dataset.reveal)
            revealObserver?.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    )
    document
      .querySelectorAll<HTMLElement>('.pricing-page [data-reveal]')
      .forEach((node) => revealObserver?.observe(node))
  } else {
    document
      .querySelectorAll<HTMLElement>('.pricing-page [data-reveal]')
      .forEach((node) => node.dataset.reveal && reveal(node.dataset.reveal))
  }

  startFlowTrail()
})

onBeforeUnmount(() => {
  motionMedia?.removeEventListener?.('change', updateMotion)
  window.removeEventListener('popstate', onPopStatePreparing)
  revealObserver?.disconnect()
  stopFlowTrail()
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

<template>
  <div class="landing-shell pricing-page" :class="{ 'is-reduced-motion': prefersReducedMotion }">
    <header class="landing-nav pricing-nav" role="banner">
      <div class="landing-nav-inner">
        <div class="landing-brand pricing-brand" aria-label="MoonCut">
          <BrandLogo variant="mark" class="landing-brand-logo" />
          <span class="landing-brand-copy" aria-hidden="true">
            <strong>MoonCut</strong>
            <small>口播创作台</small>
          </span>
        </div>

        <nav class="landing-anchors" aria-label="定价页主导航">
          <button type="button" @click="emit('home')">返回首页</button>
          <button class="is-active" type="button" aria-current="page">定价</button>
          <button type="button" @click="emit('open-community')">社区</button>
          <button type="button" @click="emit('open-privacy')">隐私与政策</button>
        </nav>

        <div class="landing-nav-actions">
          <ThemeToggle />
          <template v-if="signedIn">
            <button class="landing-cta-primary" type="button" @click="emit('navigate', 'record')">
              进入工作台
            </button>
          </template>
          <template v-else>
            <button class="landing-auth-ghost" type="button" @click="emit('open-auth', { mode: 'login', destination: 'pricing' })">
              <LogIn :size="15" aria-hidden="true" /> 登录
            </button>
            <button class="landing-cta-primary" type="button" @click="chooseFree">
              免费开始创作 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </template>
        </div>
      </div>
    </header>

    <main class="landing-content pricing-content">
      <!-- B. Hero -->
      <section class="pricing-hero" aria-labelledby="pricing-hero-title">
        <span class="hero-eyebrow pricing-hero-eyebrow" data-reveal="hero" :class="{ 'is-lit': revealed.has('hero') }">套餐与定价</span>
        <h1 id="pricing-hero-title" class="hero-title reveal-stagger-item" data-reveal="hero-title" :class="{ 'is-lit': revealed.has('hero-title') }">
          把每一条口播，<br>
          做成可持续的创作。
        </h1>
        <p class="hero-desc reveal-stagger-item" data-reveal="hero-desc" :class="{ 'is-lit': revealed.has('hero-desc') }">
          从免费走完整条路径，在需要更高频、更高清时再升级。
          Free 可以进入 Studio 完整体验；付费买的是 AI 处理量、高清导出与工作流效率，而非被锁住的基础功能。
          当前页面仅介绍方案，不发起扣款，也不代表演示版已完成商用化。
        </p>

        <ol class="pricing-flow reveal-stagger-item" aria-label="创作额度流转" data-reveal="hero-flow" :class="{ 'is-lit': revealed.has('hero-flow') }">
          <li
            v-for="(step, index) in flow"
            :key="step.label"
            class="pricing-flow-step"
            :class="{ 'is-active': flowStep === index }"
          >
            <span class="pricing-flow-icon" aria-hidden="true">
              <component :is="step.icon" :size="14" />
            </span>
            <span class="pricing-flow-label">{{ step.label }}</span>
            <ArrowRight
              v-if="index < flow.length - 1"
              class="pricing-flow-arrow"
              :size="14"
              aria-hidden="true"
            />
          </li>
        </ol>
      </section>

      <!-- C. 套餐主卡区 -->
      <section class="pricing-cards reveal-stagger" aria-labelledby="pricing-cards-title" data-reveal="cards" :class="{ 'is-lit': revealed.has('cards') }">
        <h2 id="pricing-cards-title" class="pricing-section-title">三档套餐 · 先体验，再为用量升级</h2>

        <div class="pricing-card-grid">
          <article
            v-for="(plan, index) in plans"
            :key="plan.id"
            class="pricing-card reveal-stagger-item"
            :class="{
              'is-featured': Boolean(plan.recommended),
              'is-selected': selectedPlan === plan.id,
              'is-lit': revealed.has(`card-${index}`),
            }"
            :data-reveal="`card-${index}`"
            tabindex="0"
            role="group"
            :aria-label="`${plan.tier}：${plan.audience}`"
            @click="selectPlan(plan.id)"
            @keydown.enter.prevent="selectPlan(plan.id)"
            @keydown.space.prevent="selectPlan(plan.id)"
          >
            <span class="pricing-check" :class="{ 'is-on': selectedPlan === plan.id }" aria-hidden="true">
              <Check v-if="selectedPlan === plan.id" :size="13" />
            </span>

            <header class="pricing-card-head">
              <h3>{{ plan.tier }}</h3>
              <p class="pricing-card-audience">{{ plan.audience }}</p>
              <span v-if="plan.recommended" class="pricing-recommended" aria-hidden="true">
                <Sparkles :size="12" /> {{ plan.recommended }}
              </span>
            </header>

            <div class="pricing-price">
              <span class="pricing-price-value">{{ plan.price }}</span>
              <span class="pricing-price-unit">{{ plan.priceUnit }}</span>
            </div>
            <p class="pricing-price-note">{{ plan.priceNote }}</p>

            <span class="pricing-clarity-badge" :data-clarity="plan.clarity">
              {{ clarityVisual[plan.clarity] }} 无水印导出
            </span>

            <ul class="pricing-features" :aria-label="`${plan.tier} 可做项`">
              <li v-for="feature in plan.features" :key="feature.label">
                <component :is="feature.icon" :size="14" aria-hidden="true" />
                <span>{{ feature.label }}</span>
              </li>
            </ul>

            <ul v-if="plan.limits.length" class="pricing-limits" :aria-label="`${plan.tier} 能力边界`">
              <li v-for="limit in plan.limits" :key="limit">{{ limit }}</li>
            </ul>

            <button
              class="pricing-cta"
              type="button"
              @click.stop="onCardCta(plan)"
            >
              {{ plan.ctaLabel }}
              <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </article>
        </div>

        <div class="pricing-selection-bar" data-reveal="selection-bar" :class="{ 'is-lit': revealed.has('selection-bar') }">
          <span class="pricing-selection-label">当前选择：<strong>{{ selectedPlanLabel }}</strong></span>
          <button class="pricing-selection-cta" type="button" @click="proceedSelected">
            继续所选套餐 <ArrowRight :size="15" aria-hidden="true" />
          </button>
        </div>
      </section>

      <!-- C2. 统一计量说明 -->
      <section class="pricing-meter reveal-stagger" aria-labelledby="pricing-meter-title" data-reveal="meter" :class="{ 'is-lit': revealed.has('meter') }">
        <h2 id="pricing-meter-title" class="pricing-section-title">额度如何计算？</h2>
        <ul class="pricing-meter-list">
          <li v-for="note in meterNotes" :key="note">{{ note }}</li>
        </ul>
      </section>

      <!-- D. 价值对照表 -->
      <section class="pricing-compare reveal-stagger" aria-labelledby="pricing-compare-title" data-reveal="compare" :class="{ 'is-lit': revealed.has('compare') }">
        <h2 id="pricing-compare-title" class="pricing-section-title">权益对照</h2>
        <div class="pricing-compare-scroll" role="region" aria-label="套餐权益对照表" tabindex="0">
          <table class="pricing-compare-table">
            <thead>
              <tr>
                <th scope="col">能力</th>
                <th v-for="item in comparePlans" :key="item.id" scope="col">{{ item.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in compareRows" :key="row.label">
                <th scope="row">{{ row.label }}</th>
                <td v-for="item in comparePlans" :key="item.id">
                  <template v-if="compareValue(row, item.id) === true">
                    <Check :size="15" aria-hidden="true" />
                    <span class="visually-hidden">支持</span>
                  </template>
                  <template v-else-if="compareValue(row, item.id) === false">
                    <Minus :size="15" aria-hidden="true" />
                    <span class="visually-hidden">不支持</span>
                  </template>
                  <template v-else>{{ compareValue(row, item.id) }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="pricing-compare-note">暂不展示未实现或未确认的云空间、商用素材授权、团队协作席位或专属客服 SLA。</p>
      </section>

      <!-- E. 为什么这样分档 -->
      <section class="pricing-why reveal-stagger" aria-labelledby="pricing-why-title" data-reveal="why" :class="{ 'is-lit': revealed.has('why') }">
        <h2 id="pricing-why-title" class="pricing-section-title">为什么这样分档</h2>
        <div class="pricing-why-grid">
          <article v-for="block in whyBlocks" :key="block.title" class="pricing-why-card">
            <h3>{{ block.title }}</h3>
            <p>{{ block.body }}</p>
          </article>
        </div>
        <p class="pricing-why-core">核心是建立信任：基础创作不该被切碎；高成本的模型和渲染资源才应按用量分层。</p>
      </section>

      <!-- F. FAQ -->
      <section class="pricing-faq reveal-stagger" aria-labelledby="pricing-faq-title" data-reveal="faq" :class="{ 'is-lit': revealed.has('faq') }">
        <h2 id="pricing-faq-title" class="pricing-section-title">常见问题</h2>
        <div class="pricing-faq-list">
          <div v-for="(item, index) in faqs" :key="item.q" class="pricing-faq-item">
            <button
              type="button"
              class="pricing-faq-q"
              :aria-expanded="Boolean(faqOpen[index])"
              :aria-controls="`pricing-faq-a-${index}`"
              @click="toggleFaq(index)"
            >
              <span>{{ item.q }}</span>
              <ChevronDown :size="16" aria-hidden="true" :class="{ 'is-open': faqOpen[index] }" />
            </button>
            <div :id="`pricing-faq-a-${index}`" class="pricing-faq-a" :class="{ 'is-open': faqOpen[index] }">
              <p>{{ item.a }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- G. 底部 CTA + 页脚 -->
      <section class="pricing-final reveal-stagger" aria-labelledby="pricing-final-title" data-reveal="final" :class="{ 'is-lit': revealed.has('final') }">
        <div class="pricing-final-inner">
          <h2 id="pricing-final-title" class="final-title">先完成第一条，再决定你要走多远。</h2>
          <p class="pricing-final-hint">当前选择：<strong>{{ selectedPlanLabel }}</strong>。继续将跳转到所选套餐的下一步，不会自动扣款。</p>
          <div class="final-actions">
            <button class="landing-cta-primary" type="button" @click="proceedSelected">
              继续所选套餐 <ArrowRight :size="18" aria-hidden="true" />
            </button>
            <button class="landing-cta-secondary" type="button" @click="startEditing">
              <Upload :size="16" aria-hidden="true" /> 直接剪视频
            </button>
          </div>
        </div>
      </section>

      <footer class="pricing-footer landing-footer">
        <div class="footer-brand" aria-label="MoonCut">
          <BrandLogo variant="mark" class="footer-logo-mark" />
          <span class="footer-brand-name">MoonCut</span>
        </div>
        <p class="footer-note">定价权益正在为正式订阅能力准备；当前页面不会发起扣款。</p>
        <div class="pricing-footer-nav">
          <button type="button" @click="emit('home')"><ArrowLeft :size="13" aria-hidden="true" /> 返回首页</button>
        </div>
      </footer>
    </main>

    <!-- 订阅能力准备中 面板 -->
    <Transition name="preparing">
      <div
        v-if="preparingPlan"
        ref="preparingDialogEl"
        class="pricing-preparing-overlay"
        @click.self="closePreparing(true)"
        @keydown="onPreparingKeydown"
      >
        <div
          class="pricing-preparing-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preparing-title"
          aria-describedby="preparing-body"
        >
          <header class="pricing-preparing-head">
            <div>
              <h2 id="preparing-title">{{ preparingPlanLabel }} · 订阅能力准备中</h2>
              <p>本页操作不会扣款，也不会自动开通任何付费权益。</p>
            </div>
            <button
              ref="preparingCloseRef"
              type="button"
              class="pricing-preparing-close"
              aria-label="关闭订阅准备中提示"
              @click="closePreparing(true)"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </header>

          <div id="preparing-body" class="pricing-preparing-body">
            <span class="pricing-preparing-icon" aria-hidden="true"><ShieldAlert :size="22" /></span>
            <p>
              订阅能力正在准备中。本页不会发起扣款，也不会自动为你开通
              <strong>{{ preparingPlanLabel }}</strong> 的付费权益。
            </p>
            <p>
              后端在任务创建、导出与渲染队列层仍会按当前可用量执行，
              真实的订阅、续订、退款与额度变更将在支付系统接入后正式上线。
            </p>
          </div>

          <div class="pricing-preparing-pay" role="radiogroup" aria-label="选择支付方式（占位，暂不可用）">
            <span class="pricing-preparing-pay-label">选择支付方式</span>
            <div class="pricing-pay-chips">
              <button
                v-for="method in paymentMethods"
                :key="method.id"
                type="button"
                class="pricing-pay-chip"
                role="radio"
                :aria-checked="selectedPayment === method.id"
                :class="{ 'is-selected': selectedPayment === method.id }"
                @click="choosePayment(method.id)"
              >
                <span class="pricing-pay-chip-mark" aria-hidden="true" :data-method="method.id" />
                <span class="pricing-pay-chip-label">{{ method.label }}</span>
                <small>{{ method.hint }}</small>
              </button>
            </div>
            <p class="pricing-preparing-pay-note">支付方式仅为占位展示，提交不会扣款、不会开通权益。</p>
          </div>

          <Transition name="preparing-note">
            <p v-if="preparingAcknowledged" class="pricing-preparing-ack" role="status">
              <ShieldAlert :size="14" aria-hidden="true" />
              支付能力准备中：未发起扣款，权益未变更。接入后这里会跳转到安全结算页。
            </p>
          </Transition>

          <div class="pricing-preparing-actions">
            <button
              class="landing-cta-primary"
              type="button"
              :disabled="submittingPreparing"
              @click="submitPreparing"
            >
              <span v-if="submittingPreparing" class="pricing-preparing-spinner" aria-hidden="true" />
              {{ submittingPreparing ? '处理中…' : `确认选择 ${preparingPlanLabel}` }}
            </button>
            <button class="landing-cta-secondary" type="button" @click="closePreparing(true)">稍后再说</button>
            <button type="button" class="pricing-preparing-workspace-btn" @click="emit('navigate', 'record')">先回工作台</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>