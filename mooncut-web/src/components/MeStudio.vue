<script setup lang="ts">
import {
  Activity,
  ArrowUpRight,
  Check,
  CircleAlert,
  CreditCard,
  Film,
  Gauge,
  LoaderCircle,
  LogOut,
  Mail,
  Moon,
  PackageCheck,
  Palette,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  UsersRound,
} from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import { createBillingCheckout, getBillingSummary, getMailStatus, getServiceModels } from '../services/api'
import type { AuthUser, BillingPlanId, BillingSummary, Theme } from '../types'

const props = defineProps<{
  user: AuthUser
  /** Selected on the pricing page; only server-side checkout can change entitlement. */
  upgradePlan?: Exclude<BillingPlanId, 'free'> | null
}>()
const emit = defineEmits<{
  logout: []
  'open-community': []
  'open-privacy': []
  'open-pricing': []
  'pet-message': [message: string]
}>()

const { currentTheme, setTheme } = useTheme()

const notificationEmailKey = computed(
  () => `mooncut:notification-email:${props.user.email}`,
)
const communityAuthorKey = computed(
  () => `mooncut:community-author:${props.user.email}`,
)

const notificationEmail = ref(
  localStorage.getItem(`mooncut:notification-email:${props.user.email}`) ?? props.user.email,
)
const communityAuthor = ref(
  localStorage.getItem(`mooncut:community-author:${props.user.email}`) ??
    props.user.email.split('@', 1)[0] ??
    'MoonCut 创作者',
)

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail.value.trim()))
const authorValid = computed(() => communityAuthor.value.trim().length >= 1)

const agentOnline = ref(false)
const agentModels = ref<string[]>([])
const mailAuthorized = ref(false)
const mailAutomatic = ref(false)
const mailSender = ref('')
const mailTransport = ref('')
const statusLoading = ref(true)
const statusError = ref('')
const savedHint = ref('')
const billing = ref<BillingSummary | null>(null)
const billingLoading = ref(true)
const billingError = ref('')
const checkoutNotice = ref('')
const checkoutLoadingPlan = ref<Exclude<BillingPlanId, 'free'> | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | null = null

const themeOptions: Array<{ value: Theme; label: string; hint: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色', hint: '克制浅色', icon: Sun },
  { value: 'dark', label: '深色', hint: '专注深色', icon: Moon },
  { value: 'memphis', label: 'Memphis', hint: '暖纸撞色', icon: Palette },
]

const userInitial = computed(() => props.user.email.slice(0, 1).toUpperCase() || 'M')
const memberSince = computed(() => {
  const date = new Date(props.user.createdAt)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
})
const currentPlan = computed(() => billing.value?.account.plan ?? 'free')
const recommendedPlan = computed(() => billing.value?.upgradePrompt?.recommendedPlan ?? (currentPlan.value === 'creator' ? 'pro' : 'creator'))
const checkoutPlan = computed<Exclude<BillingPlanId, 'free'>>(() => {
  if (props.upgradePlan === 'pro' && currentPlan.value !== 'pro') return 'pro'
  if (props.upgradePlan === 'creator' && currentPlan.value === 'free') return 'creator'
  return recommendedPlan.value
})

function limitLabel(used: number, limit: number | null, unit: string) {
  return limit === null ? `${used} ${unit}` : `${used} / ${limit} ${unit}`
}

function meterWidth(used: number, limit: number | null) {
  if (limit === null) return Math.min(100, used ? 22 : 0)
  return Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
}

function checkoutStatus(status: string) {
  return ({
    pending_setup: '等待支付通道配置',
    ready_for_payment: '等待支付',
    paid: '已支付',
    expired: '已过期',
    cancelled: '已取消',
  } as Record<string, string>)[status] ?? status
}

function formatDate(value: string | null) {
  if (!value) return '体验额度永久有效至用完'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
}

function flashSaved(message: string) {
  savedHint.value = message
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    savedHint.value = ''
  }, 2200)
}

watch(notificationEmail, (value) => {
  const trimmed = value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return
  localStorage.setItem(notificationEmailKey.value, trimmed)
  flashSaved('默认通知邮箱已保存')
})

watch(communityAuthor, (value) => {
  const trimmed = value.trim()
  if (!trimmed) return
  localStorage.setItem(communityAuthorKey.value, trimmed)
  flashSaved('社区昵称已保存')
})

async function loadServiceStatus() {
  statusLoading.value = true
  statusError.value = ''
  try {
    const [models, mail] = await Promise.all([
      getServiceModels()
        .then((result) => ({ ok: true as const, result }))
        .catch((reason) => ({ ok: false as const, reason })),
      getMailStatus()
        .then((result) => ({ ok: true as const, result }))
        .catch((reason) => ({ ok: false as const, reason })),
    ])

    if (models.ok) {
      agentOnline.value = true
      agentModels.value = models.result.available ?? []
    } else {
      agentOnline.value = false
      agentModels.value = []
    }

    if (mail.ok) {
      mailAuthorized.value = mail.result.authorized
      mailAutomatic.value = mail.result.automatic
      mailTransport.value = mail.result.transport
      mailSender.value =
        mail.result.aliases.find((alias) => alias.is_primary)?.email ??
        mail.result.aliases[0]?.email ??
        ''
    } else {
      mailAuthorized.value = false
      mailAutomatic.value = false
      mailSender.value = ''
      mailTransport.value = ''
    }

    if (!models.ok && !mail.ok) {
      statusError.value = '暂时读不到 Agent / 邮件状态（本机隧道可能未连接）'
    }
  } catch (reason) {
    statusError.value = reason instanceof Error ? reason.message : '状态刷新失败'
  } finally {
    statusLoading.value = false
  }
}

async function loadBilling() {
  billingLoading.value = true
  billingError.value = ''
  try {
    billing.value = await getBillingSummary()
  } catch (reason) {
    billingError.value = reason instanceof Error ? reason.message : '暂时无法读取套餐与额度'
  } finally {
    billingLoading.value = false
  }
}

async function startCheckout(plan: Exclude<BillingPlanId, 'free'>) {
  if (checkoutLoadingPlan.value) return
  checkoutLoadingPlan.value = plan
  checkoutNotice.value = ''
  try {
    const result = await createBillingCheckout(plan)
    checkoutNotice.value = result.message
    await loadBilling()
    if (result.checkout.checkoutUrl) window.location.assign(result.checkout.checkoutUrl)
  } catch (reason) {
    checkoutNotice.value = reason instanceof Error ? reason.message : '升级请求暂时无法创建'
  } finally {
    checkoutLoadingPlan.value = null
  }
}

onMounted(() => {
  void loadServiceStatus()
  void loadBilling()
  emit('pet-message', '这里可以看套餐、额度、生成记录和创作偏好。')
})
</script>

<template>
  <section class="workspace-page me-page">
    <div class="me-heading reveal">
      <div>
        <span class="eyebrow"><UserRound :size="15" /> 我的</span>
        <h1>账户与<br><em>创作偏好</em></h1>
        <p>查看套餐、已生成成片、AI 额度与升级状态，再管理个人创作偏好。</p>
      </div>
      <button
        v-if="billing?.upgradePrompt"
        class="me-upgrade-heading-action"
        type="button"
        :disabled="Boolean(checkoutLoadingPlan)"
        @click="startCheckout(checkoutPlan)"
      >
        <LoaderCircle v-if="checkoutLoadingPlan" :size="15" class="is-spinning" />
        <Sparkles v-else :size="15" /> 升级 {{ checkoutPlan === 'pro' ? 'Pro' : 'Creator' }}
      </button>
      <div v-else-if="savedHint" class="me-saved-hint" role="status">
        <Check :size="14" /> {{ savedHint }}
      </div>
    </div>

    <div class="me-layout">
      <section class="billing-overview reveal" aria-label="套餐与创作额度">
        <div v-if="billingLoading" class="billing-loading" role="status"><LoaderCircle :size="20" class="is-spinning" /> 正在读取账户额度…</div>
        <div v-else-if="billingError" class="billing-error" role="alert"><CircleAlert :size="16" /> {{ billingError }}<button type="button" @click="loadBilling">重试</button></div>
        <template v-else-if="billing">
          <article class="billing-plan-card" :class="`is-${billing.account.plan}`">
            <div class="billing-plan-topline"><span><CreditCard :size="15" /> 当前套餐</span><small>{{ billing.account.subscriptionStatus === 'active' ? '订阅有效' : '体验中' }}</small></div>
            <h2>{{ billing.account.planLabel }}</h2>
            <p v-if="billing.account.plan === 'free'">已解锁完整基础 Studio；智能成片按体验次数计算。</p>
            <p v-else>本周期至 {{ formatDate(billing.account.periodEndsAt) }}，可继续使用当前套餐权益。</p>
            <div class="billing-plan-specs"><span>{{ billing.account.exportQuality }} 导出</span><span>{{ billing.account.maxParallelJobs }} 个并行任务</span></div>
            <button
              v-if="billing.account.plan !== 'pro'"
              class="primary-button billing-upgrade-button"
              type="button"
              :disabled="Boolean(checkoutLoadingPlan)"
              @click="startCheckout(checkoutPlan)"
            >
              <LoaderCircle v-if="checkoutLoadingPlan" :size="15" class="is-spinning" />
              <Sparkles v-else :size="15" /> {{ checkoutPlan === 'pro' ? '解锁 Pro' : '解锁 Creator' }}
            </button>
            <button v-else class="secondary-button billing-upgrade-button" type="button" @click="emit('open-pricing')"><ReceiptText :size="15" /> 查看 Pro 权益</button>
          </article>

          <article class="billing-usage-card">
            <header><div><span><Gauge :size="16" /> 本周期创作用量</span><small>{{ billing.account.plan === 'free' ? '体验额度按账户累计' : `下次刷新：${formatDate(billing.account.periodEndsAt)}` }}</small></div><button type="button" aria-label="刷新账户额度" @click="loadBilling"><LoaderCircle v-if="billingLoading" :size="15" class="is-spinning" /><ArrowUpRight v-else :size="15" /></button></header>
            <div class="billing-meters">
              <div class="billing-meter"><div><span><Film :size="15" /> 智能成片</span><strong>{{ limitLabel(billing.usage.videoGenerations.used, billing.usage.videoGenerations.limit, '条') }}</strong></div><i><b :style="{ width: `${meterWidth(billing.usage.videoGenerations.used, billing.usage.videoGenerations.limit)}%` }" /></i><small>{{ billing.usage.videoGenerations.inProgress ? `${billing.usage.videoGenerations.inProgress} 条正在处理并已预留额度` : '每次成功创建剪辑任务时预留额度' }}</small></div>
              <div class="billing-meter"><div><span><Gauge :size="15" /> 智能处理</span><strong>{{ billing.usage.smartMinutes.limit === null ? '体验权益' : limitLabel(billing.usage.smartMinutes.used, billing.usage.smartMinutes.limit, '分钟') }}</strong></div><i><b :style="{ width: `${meterWidth(billing.usage.smartMinutes.used, billing.usage.smartMinutes.limit)}%` }" /></i><small>{{ billing.usage.smartMinutes.limit === null ? 'Free 单条素材最多 5 分钟' : '以完成成片的实际时长按分钟结算' }}</small></div>
              <div class="billing-meter"><div><span><Sparkles :size="15" /> 创作点</span><strong>{{ limitLabel(billing.usage.creativePoints.used, billing.usage.creativePoints.limit, '点') }}</strong></div><i><b :style="{ width: `${meterWidth(billing.usage.creativePoints.used, billing.usage.creativePoints.limit)}%` }" /></i><small>{{ billing.usage.creativePoints.inProgress ? `${billing.usage.creativePoints.inProgress} 点正为 AI 视觉任务预留` : '脚本生成、字幕修复和 AI 视觉生成会记入创作点。' }}</small></div>
            </div>
          </article>

          <article v-if="billing.upgradePrompt" class="billing-alert" :class="`is-${billing.upgradePrompt.level}`">
            <span><CircleAlert :size="18" /></span><div><strong>{{ billing.upgradePrompt.title }}</strong><p>{{ billing.upgradePrompt.detail }}</p></div><button type="button" :disabled="Boolean(checkoutLoadingPlan)" @click="startCheckout(billing.upgradePrompt.recommendedPlan)">查看升级方案 <ArrowUpRight :size="14" /></button>
          </article>

          <article class="billing-history-card">
            <header><span><ReceiptText :size="16" /> 账单与升级记录</span><small>{{ billing.limits.checkoutConfigured ? '支付通道已配置' : '支付通道待配置' }}</small></header>
            <div v-if="checkoutNotice" class="billing-checkout-notice" role="status">{{ checkoutNotice }}</div>
            <ul v-if="billing.checkoutRequests.length">
              <li v-for="request in billing.checkoutRequests" :key="request.id"><div><strong>{{ request.requested_plan === 'pro' ? 'Pro · 专业版' : 'Creator · 创作版' }}</strong><small>{{ formatDate(request.created_at) }} · {{ checkoutStatus(request.status) }}</small></div><a v-if="request.checkout_url && request.status === 'ready_for_payment'" :href="request.checkout_url">继续支付 <ArrowUpRight :size="13" /></a></li>
            </ul>
            <p v-else>还没有升级请求。需要更多智能处理量或 4K 导出时，随时可以在这里发起升级。</p>
          </article>
        </template>
      </section>

      <article class="me-card me-profile-card reveal">
        <div class="me-profile-top">
          <span class="me-avatar" aria-hidden="true">{{ userInitial }}</span>
          <div>
            <strong>{{ user.email }}</strong>
            <small>加入于 {{ memberSince }}</small>
          </div>
        </div>
        <dl class="me-profile-meta">
          <div>
            <dt>账户 ID</dt>
            <dd class="mono">{{ user.id.slice(0, 12) }}…</dd>
          </div>
          <div>
            <dt>登录邮箱</dt>
            <dd>{{ user.email }}</dd>
          </div>
        </dl>
        <button class="me-logout-button" type="button" @click="emit('logout')">
          <LogOut :size="16" /> 退出登录
        </button>
      </article>

      <article class="me-card reveal">
        <header class="me-card-header">
          <span><Palette :size="16" /> 外观主题</span>
          <small>立即生效，保存在本机浏览器</small>
        </header>
        <div class="me-theme-grid" role="radiogroup" aria-label="选择主题">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            role="radio"
            class="me-theme-option"
            :class="{ 'is-active': currentTheme === option.value }"
            :aria-checked="currentTheme === option.value"
            @click="setTheme(option.value)"
          >
            <component :is="option.icon" :size="18" />
            <strong>{{ option.label }}</strong>
            <span>{{ option.hint }}</span>
            <Check v-if="currentTheme === option.value" :size="14" class="me-theme-check" />
          </button>
        </div>
      </article>

      <article class="me-card reveal">
        <header class="me-card-header">
          <span><Mail :size="16" /> 成片通知邮箱</span>
          <small>剪辑台默认沿用此邮箱</small>
        </header>
        <label class="me-field">
          <span>默认收件地址</span>
          <input
            v-model.trim="notificationEmail"
            type="email"
            autocomplete="email"
            placeholder="name@example.com"
          >
          <small v-if="notificationEmail && !emailValid" class="is-error">请检查邮箱格式</small>
          <small v-else>仅保存在本机，创建剪辑任务时会预填到「完成后发邮件」。</small>
        </label>
      </article>

      <article class="me-card reveal">
        <header class="me-card-header">
          <span><UsersRound :size="16" /> 社区展示</span>
          <small>分享成片时的作者名</small>
        </header>
        <label class="me-field">
          <span>社区昵称</span>
          <input
            v-model.trim="communityAuthor"
            type="text"
            maxlength="40"
            placeholder="例如：竖屏口播小白"
            autocomplete="nickname"
          >
          <small v-if="!authorValid" class="is-error">昵称不能为空</small>
          <small v-else>发布到社区案例时使用；能力包目录请到社区页查看。</small>
        </label>
        <button class="secondary-button me-inline-action" type="button" @click="emit('open-community')">
          <PackageCheck :size="15" /> 打开社区（能力包目录）
        </button>
      </article>

      <article class="me-card reveal">
        <header class="me-card-header">
          <span><Activity :size="16" /> 本机服务</span>
          <button class="community-refresh" type="button" :disabled="statusLoading" @click="loadServiceStatus">
            刷新状态
          </button>
        </header>
        <div v-if="statusError" class="me-status-banner is-warn" role="status">
          <CircleAlert :size="15" /> {{ statusError }}
        </div>
        <ul class="me-status-list">
          <li>
            <span class="status-dot" :class="{ amber: !agentOnline }" />
            <div>
              <strong>边缘 API / Agent 路由</strong>
              <small v-if="agentOnline">已连接{{ agentModels.length ? ` · ${agentModels.join(' / ')}` : '' }}</small>
              <small v-else>未连上（可先刷新；剪辑仍依赖本机隧道）</small>
            </div>
          </li>
          <li>
            <span class="status-dot" :class="{ amber: !mailAuthorized }" />
            <div>
              <strong>成片邮件</strong>
              <small v-if="mailAuthorized">
                {{ mailAutomatic ? '自动发送' : '需确认后发送' }}
                <template v-if="mailSender"> · {{ mailSender }}</template>
                <template v-if="mailTransport"> · {{ mailTransport }}</template>
              </small>
              <small v-else>邮件服务未授权或本机 Agent 未连接</small>
            </div>
          </li>
        </ul>
      </article>

      <article class="me-card me-links-card reveal">
        <header class="me-card-header">
          <span><ShieldCheck :size="16" /> 更多</span>
        </header>
        <div class="me-link-row">
          <button type="button" @click="emit('open-privacy')">
            <ShieldCheck :size="15" /> 隐私说明
          </button>
          <button type="button" @click="emit('open-pricing')">
            <Sparkles :size="15" /> 定价与额度
          </button>
          <button type="button" @click="emit('open-community')">
            <UsersRound :size="15" /> 社区与能力包
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
