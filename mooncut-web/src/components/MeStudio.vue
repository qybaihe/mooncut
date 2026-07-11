<script setup lang="ts">
import {
  Activity,
  Check,
  CircleAlert,
  LogOut,
  Mail,
  Moon,
  PackageCheck,
  Palette,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  UsersRound,
} from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import { getMailStatus, getServiceModels } from '../services/api'
import type { AuthUser, Theme } from '../types'

const props = defineProps<{ user: AuthUser }>()
const emit = defineEmits<{
  logout: []
  'open-community': []
  'open-privacy': []
  'open-pricing': []
  'open-queue': []
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

onMounted(() => {
  void loadServiceStatus()
  emit('pet-message', '这里可以改主题、通知邮箱和社区昵称。')
})
</script>

<template>
  <section class="workspace-page me-page">
    <div class="me-heading reveal">
      <div>
        <span class="eyebrow"><UserRound :size="15" /> 我的</span>
        <h1>账户与<br><em>创作偏好</em></h1>
        <p>管理登录信息、主题外观、默认通知邮箱和社区展示名。能力包请到「社区」浏览与下载。</p>
      </div>
      <div v-if="savedHint" class="me-saved-hint" role="status">
        <Check :size="14" /> {{ savedHint }}
      </div>
    </div>

    <div class="me-layout">
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
        <button class="secondary-button me-inline-action" type="button" @click="emit('open-queue')">
          <Activity :size="15" /> 查看渲染队列
        </button>
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
