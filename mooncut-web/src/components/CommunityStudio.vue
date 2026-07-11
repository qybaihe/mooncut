<script setup lang="ts">
import { ArrowRight, Camera, Check, CircleAlert, Clock3, ExternalLink, LoaderCircle, PackageCheck, Play, Power, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, UsersRound, X } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { installCapability, invokeCapability, listCapabilities, listCapabilityInstallations, listCommunityPosts, preflightCapability, reconfirmCapability, setCapabilityInstallationStatus, uninstallCapability } from '../services/api'
import type { CapabilityCatalogItem, CapabilityInstallation, CapabilityInvocation, CommunityPost } from '../types'

type CapabilityTab = 'discover' | 'installed' | 'showcase'

const emit = defineEmits<{
  create: []
  'pet-message': [message: string]
}>()

const tab = ref<CapabilityTab>('discover')
const capabilities = ref<CapabilityCatalogItem[]>([])
const installations = ref<CapabilityInstallation[]>([])
const capabilityLoading = ref(true)
const capabilityError = ref('')
const search = ref('')
const actionId = ref('')
const preflights = reactive<Record<string, { ok: boolean; message: string }>>({})
const fifaQuery = reactive<Record<string, string>>({})
const fifaResults = reactive<Record<string, CapabilityInvocation | undefined>>({})
const screenshotOpen = ref('')
const screenshotMatchId = reactive<Record<string, string>>({})
const screenshotView = reactive<Record<string, 'ratings' | 'match' | 'chat'>>({})
const screenshotResult = reactive<Record<string, CapabilityInvocation | undefined>>({})

const posts = ref<CommunityPost[]>([])
const nextCursor = ref<string | undefined>()
const postsLoading = ref(true)
const postsLoadingMore = ref(false)
const postsError = ref('')
const selectedPost = ref<CommunityPost | null>(null)

const installedByPackage = computed(() => new Map(installations.value.map((installation) => [installation.packageId, installation])))
const installedFifa = computed(() => installations.value.filter((installation) => installation.slug === 'fifa-official-highlights'))

function durationLabel(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function dateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

function capabilityState(item: CapabilityCatalogItem) {
  return installedByPackage.value.get(item.id) ?? (item.installed
    ? {
        id: item.installed.id,
        packageId: item.id,
        releaseId: item.installed.releaseId,
        slug: item.slug,
        version: item.installed.version,
        manifestHash: item.currentRelease.manifestHash,
        status: item.installed.status,
        installedAt: '',
        updatedAt: '',
        permissions: item.currentRelease.permissions,
        tasks: item.currentRelease.tasks,
        name: item.name,
        tagline: item.tagline,
        category: item.category,
      }
    : undefined)
}

async function loadCapabilities() {
  capabilityLoading.value = true
  capabilityError.value = ''
  try {
    const [catalog, installed] = await Promise.all([listCapabilities(search.value), listCapabilityInstallations()])
    capabilities.value = catalog.items
    installations.value = installed.items
  } catch (reason) {
    capabilityError.value = reason instanceof Error ? reason.message : '能力市场暂时没有连上'
  } finally {
    capabilityLoading.value = false
  }
}

async function install(item: CapabilityCatalogItem) {
  actionId.value = item.id
  try {
    const result = await installCapability(item.slug)
    if (result.installation.status === 'needs_reconsent') {
      emit('pet-message', '这个能力更新了权限，确认后才能继续启用。')
    } else {
      emit('pet-message', `${item.name} 已装进你的 Pi，可以在下一次创作里使用了。`)
    }
    await loadCapabilities()
  } catch (reason) {
    capabilityError.value = reason instanceof Error ? reason.message : '安装能力失败'
  } finally {
    actionId.value = ''
  }
}

async function toggle(installation: CapabilityInstallation) {
  actionId.value = installation.id
  try {
    const status = installation.status === 'enabled' ? 'disabled' : 'enabled'
    await setCapabilityInstallationStatus(installation.id, status)
    await loadCapabilities()
  } catch (reason) {
    capabilityError.value = reason instanceof Error ? reason.message : '更新能力状态失败'
  } finally {
    actionId.value = ''
  }
}

async function remove(installation: CapabilityInstallation) {
  actionId.value = installation.id
  try {
    await uninstallCapability(installation.id)
    emit('pet-message', `${installation.name} 已从你的 Pi 中卸载。`)
    await loadCapabilities()
  } catch (reason) {
    capabilityError.value = reason instanceof Error ? reason.message : '卸载能力失败'
  } finally {
    actionId.value = ''
  }
}

async function preflight(installation: CapabilityInstallation) {
  actionId.value = `preflight-${installation.id}`
  try {
    preflights[installation.id] = await preflightCapability(installation.id)
  } catch (reason) {
    preflights[installation.id] = { ok: false, message: reason instanceof Error ? reason.message : '预检失败' }
  } finally {
    actionId.value = ''
  }
}

async function reconfirm(installation: CapabilityInstallation) {
  actionId.value = `reconfirm-${installation.id}`
  try {
    await reconfirmCapability(installation.id)
    emit('pet-message', `${installation.name} 的新权限已确认，现在可以继续使用。`)
    await loadCapabilities()
  } catch (reason) {
    capabilityError.value = reason instanceof Error ? reason.message : '确认新权限失败'
  } finally {
    actionId.value = ''
  }
}

async function runFifaSearch(installation: CapabilityInstallation) {
  const query = fifaQuery[installation.id]?.trim()
  if (!query) return
  actionId.value = `query-${installation.id}`
  try {
    fifaResults[installation.id] = await invokeCapability(installation.id, { tool: 'fifa_find_highlights', input: { query } })
    emit('pet-message', '我拿到了官方查询结果；它们会保留来源与版本记录。')
  } catch (reason) {
    capabilityError.value = reason instanceof Error ? reason.message : 'FIFA 查询失败'
  } finally {
    actionId.value = ''
  }
}

async function confirmScreenshot(installation: CapabilityInstallation) {
  const matchId = screenshotMatchId[installation.id]?.trim()
  if (!matchId) return
  actionId.value = `screenshot-${installation.id}`
  try {
    screenshotResult[installation.id] = await invokeCapability(installation.id, {
      tool: 'fifa_match_context',
      input: { matchId, includeChineseContext: true, screenshotView: screenshotView[installation.id] ?? 'ratings' },
      confirmedArtifact: true,
    })
    screenshotOpen.value = ''
    emit('pet-message', '截图已作为私有证据产物保存，不会自动发布或下载视频。')
  } catch (reason) {
    capabilityError.value = reason instanceof Error ? reason.message : '生成截图失败'
  } finally {
    actionId.value = ''
  }
}

function resultUrls(invocation?: CapabilityInvocation) {
  const urls = new Set(invocation?.artifacts.map((artifact) => artifact.sourceUrl).filter((url): url is string => Boolean(url)) ?? [])
  const payload = invocation?.output.payload
  if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).results)) {
    for (const result of (payload as { results: unknown[] }).results) {
      if (!result || typeof result !== 'object') continue
      const item = result as Record<string, unknown>
      const video = item.video
      if (video && typeof video === 'object' && typeof (video as Record<string, unknown>).url === 'string') urls.add((video as Record<string, string>).url)
      if (typeof item.fallbackUrl === 'string') urls.add(item.fallbackUrl)
    }
  }
  return [...urls].filter((url) => url.startsWith('https://'))
}

async function loadPosts(reset = true) {
  if (reset) {
    postsLoading.value = true
    postsError.value = ''
  } else {
    postsLoadingMore.value = true
  }
  try {
    const page = await listCommunityPosts(reset ? undefined : nextCursor.value)
    posts.value = reset ? page.items : [...posts.value, ...page.items]
    nextCursor.value = page.nextCursor
  } catch (reason) {
    postsError.value = reason instanceof Error ? reason.message : '案例暂时没有连上'
  } finally {
    postsLoading.value = false
    postsLoadingMore.value = false
  }
}

function selectTab(next: CapabilityTab) {
  tab.value = next
  if (next === 'showcase' && !posts.value.length && !postsLoading.value) void loadPosts(true)
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    selectedPost.value = null
    screenshotOpen.value = ''
  }
}

function handlePublished() {
  void loadPosts(true)
}

onMounted(() => {
  void loadCapabilities()
  void loadPosts(true)
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('mooncut:community-published', handlePublished)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape)
  window.removeEventListener('mooncut:community-published', handlePublished)
})
</script>

<template>
  <section class="workspace-page community-page capability-page">
    <div class="community-heading reveal">
      <div>
        <span class="eyebrow"><PackageCheck :size="15" /> MoonCut 能力</span>
        <h1>让你的 Pi，<br>多会一点真本事。</h1>
        <p>安装经过审核的能力，把官方资料、行业工具和可信证据真正接进每一次创作。</p>
      </div>
      <button class="community-refresh" type="button" :disabled="capabilityLoading" @click="loadCapabilities()">
        <RefreshCw :size="16" :class="{ 'is-spinning': capabilityLoading }" /> 刷新能力
      </button>
    </div>

    <div class="capability-tabs reveal reveal-delay" role="tablist" aria-label="能力页面">
      <button :class="{ 'is-active': tab === 'discover' }" type="button" role="tab" :aria-selected="tab === 'discover'" @click="selectTab('discover')"><Sparkles :size="16" /> 发现能力</button>
      <button :class="{ 'is-active': tab === 'installed' }" type="button" role="tab" :aria-selected="tab === 'installed'" @click="selectTab('installed')"><PackageCheck :size="16" /> 已安装 <small v-if="installations.length">{{ installations.length }}</small></button>
      <button :class="{ 'is-active': tab === 'showcase' }" type="button" role="tab" :aria-selected="tab === 'showcase'" @click="selectTab('showcase')"><UsersRound :size="16" /> 创作案例</button>
    </div>

    <template v-if="tab === 'discover'">
      <div class="capability-trust-strip reveal">
        <span><ShieldCheck :size="16" /> 只显示已审核、可追溯的能力 release</span><i /><span>安装按你的账号隔离，不会给共享 Agent 追加 shell 权限</span>
      </div>
      <label class="capability-search reveal" aria-label="搜索能力">
        <Search :size="18" /><input v-model="search" type="search" placeholder="搜索官方资料、素材、字幕或行业工具" @keyup.enter="loadCapabilities()"><button type="button" @click="loadCapabilities()">搜索</button>
      </label>
      <div v-if="capabilityLoading" class="community-loading" role="status"><LoaderCircle :size="24" class="is-spinning" /><strong>正在打开能力市场…</strong></div>
      <div v-else-if="capabilityError" class="community-empty" role="alert"><span><CircleAlert :size="25" /></span><h2>能力市场暂时没有连上</h2><p>{{ capabilityError }}</p><button class="secondary-button" type="button" @click="loadCapabilities()">再试一次</button></div>
      <div v-else-if="!capabilities.length" class="community-empty"><span><Search :size="25" /></span><h2>没有找到匹配能力</h2><p>换一个更宽泛的关键词，或清空搜索后重试。</p></div>
      <div v-else class="capability-grid reveal">
        <article v-for="item in capabilities" :key="item.id" class="capability-card">
          <div class="capability-card-top"><span class="capability-icon"><Sparkles :size="20" /></span><div><small class="capability-trust"><ShieldCheck :size="13" /> {{ item.trustLevel === 'official' ? 'MoonCut 官方' : '已验证维护者' }}</small><h2>{{ item.name }}</h2></div><span v-if="capabilityState(item)?.status === 'enabled'" class="capability-installed"><Check :size="13" /> 已安装</span></div>
          <p>{{ item.tagline }}</p>
          <div class="capability-meta"><span>{{ item.category }}</span><span>v{{ item.currentRelease.version }}</span><span>{{ item.currentRelease.tasks.includes('video-edit') ? '可用于剪辑' : '研究能力' }}</span></div>
          <ul class="capability-tools"><li v-for="tool in item.tools" :key="tool.name"><strong>{{ tool.name }}</strong><span>{{ tool.confirmation === 'when_artifact_is_created' ? '生成产物前确认' : '可直接查询' }}</span></li></ul>
          <div class="capability-permissions"><span v-for="permission in item.currentRelease.permissions" :key="permission.name"><ShieldCheck :size="13" /> {{ permission.reason }}</span></div>
          <div class="capability-card-actions">
            <button v-if="!capabilityState(item) || capabilityState(item)?.status === 'uninstalled'" class="primary-button" type="button" :disabled="actionId === item.id" @click="install(item)"><LoaderCircle v-if="actionId === item.id" :size="16" class="is-spinning" /><template v-else>安装到 Pi <ArrowRight :size="16" /></template></button>
            <button v-else class="secondary-button" type="button" @click="selectTab('installed')">查看安装状态 <ArrowRight :size="15" /></button>
          </div>
        </article>
      </div>
    </template>

    <template v-else-if="tab === 'installed'">
      <div v-if="capabilityLoading" class="community-loading"><LoaderCircle :size="24" class="is-spinning" /><strong>正在读取你的 Pi…</strong></div>
      <div v-else-if="capabilityError" class="community-empty"><span><CircleAlert :size="25" /></span><h2>无法读取安装状态</h2><p>{{ capabilityError }}</p><button class="secondary-button" type="button" @click="loadCapabilities()">再试一次</button></div>
      <div v-else-if="!installations.length" class="community-empty"><span><PackageCheck :size="28" /></span><h2>你的 Pi 还没有额外能力</h2><p>先安装一个经过审核的能力；它会以受限工具的方式出现在后续任务中。</p><button class="primary-button" type="button" @click="selectTab('discover')">去发现能力 <ArrowRight :size="17" /></button></div>
      <div v-else class="installed-list reveal">
        <article v-for="installation in installations" :key="installation.id" class="installed-capability-card" :class="`status-${installation.status}`">
          <div class="installed-capability-header"><div><span class="capability-trust"><ShieldCheck :size="13" /> 已审核 release · v{{ installation.version }}</span><h2>{{ installation.name }}</h2><p>{{ installation.tagline }}</p></div><span class="installation-status"><Check v-if="installation.status === 'enabled'" :size="14" /><CircleAlert v-else :size="14" /> {{ installation.status === 'enabled' ? '已启用' : installation.status === 'disabled' ? '已暂停' : '需要确认' }}</span></div>
          <div class="installed-capability-details"><span v-for="permission in installation.permissions" :key="permission.name"><ShieldCheck :size="13" /> {{ permission.reason }}</span></div>
          <div v-if="preflights[installation.id]" class="preflight-result" :class="{ 'is-ok': preflights[installation.id].ok }"><Check v-if="preflights[installation.id].ok" :size="15" /><CircleAlert v-else :size="15" /> {{ preflights[installation.id].message }}</div>
          <div class="installed-capability-actions"><button class="secondary-button" type="button" :disabled="actionId === `preflight-${installation.id}`" @click="preflight(installation)"><LoaderCircle v-if="actionId === `preflight-${installation.id}`" :size="15" class="is-spinning" /><template v-else>运行预检</template></button><button v-if="installation.status === 'needs_reconsent'" class="primary-button" type="button" :disabled="Boolean(actionId)" @click="reconfirm(installation)"><LoaderCircle v-if="actionId === `reconfirm-${installation.id}`" :size="15" class="is-spinning" /><template v-else>确认新权限</template></button><button v-else class="secondary-button" type="button" :disabled="Boolean(actionId)" @click="toggle(installation)"><Power :size="15" /> {{ installation.status === 'enabled' ? '暂停' : '启用' }}</button><button class="icon-danger-button" type="button" :disabled="Boolean(actionId)" :aria-label="`卸载 ${installation.name}`" title="卸载能力" @click="remove(installation)"><Trash2 :size="16" /></button></div>

          <section v-if="installation.slug === 'fifa-official-highlights' && installation.status === 'enabled'" class="capability-sandbox" aria-label="FIFA 赛事资料测试">
            <div><strong>试一次真实调用</strong><small>查询结果会记录来源、release 版本和调用时间。</small></div>
            <form @submit.prevent="runFifaSearch(installation)"><input v-model="fifaQuery[installation.id]" minlength="2" maxlength="120" placeholder="例如：阿根廷 vs 埃及"><button class="primary-button" type="submit" :disabled="!fifaQuery[installation.id]?.trim() || actionId === `query-${installation.id}`"><LoaderCircle v-if="actionId === `query-${installation.id}`" :size="15" class="is-spinning" /><template v-else>查官方资料</template></button></form>
            <div v-if="fifaResults[installation.id]" class="capability-call-result"><strong>已完成官方查询</strong><p>调用 {{ fifaResults[installation.id]?.id.slice(0, 8) }} · {{ fifaResults[installation.id]?.release.version }}</p><a v-for="url in resultUrls(fifaResults[installation.id])" :key="url" :href="url" target="_blank" rel="noreferrer"><ExternalLink :size="13" /> 打开来源</a></div>
            <button class="capability-screenshot-launch" type="button" @click="screenshotOpen = screenshotOpen === installation.id ? '' : installation.id"><Camera :size="15" /> 需要一张中文赛况截图？</button>
            <div v-if="screenshotOpen === installation.id" class="capability-screenshot-confirm"><p><strong>你正在确认生成任务私有截图。</strong> 这会访问百度体育公开赛况页并保存一张图片；不会下载视频、不会使用浏览器登录态，也不会自动发布。</p><div><input v-model="screenshotMatchId[installation.id]" maxlength="48" placeholder="FIFA 比赛编号，例如 M95"><select v-model="screenshotView[installation.id]"><option value="ratings">球员评分</option><option value="match">比赛赛况</option><option value="chat">公开聊天</option></select></div><button class="primary-button" type="button" :disabled="!screenshotMatchId[installation.id]?.trim() || actionId === `screenshot-${installation.id}`" @click="confirmScreenshot(installation)"><LoaderCircle v-if="actionId === `screenshot-${installation.id}`" :size="15" class="is-spinning" /><template v-else>我已知晓，生成截图</template></button></div>
            <div v-if="screenshotResult[installation.id]?.artifacts?.[0]" class="capability-screenshot-result"><img :src="screenshotResult[installation.id]?.artifacts?.[0].url" alt="FIFA 中文赛况任务私有截图"><a :href="screenshotResult[installation.id]?.artifacts?.[0].url" target="_blank" rel="noreferrer">打开原始任务产物 <ExternalLink :size="13" /></a></div>
          </section>
        </article>
      </div>
    </template>

    <template v-else>
      <div class="community-trust-strip reveal"><span><UsersRound :size="16" /> 创作者主动分享的真实口播成片</span><i /><span>现有视频保持独立托管，作为能力的使用案例</span></div>
      <div v-if="postsLoading" class="community-loading" role="status"><LoaderCircle :size="24" class="is-spinning" /><strong>正在打开创作案例…</strong></div>
      <div v-else-if="postsError" class="community-empty" role="alert"><span><RefreshCw :size="25" /></span><h2>案例暂时没有连上</h2><p>{{ postsError }}</p><button class="secondary-button" type="button" @click="loadPosts(true)">再试一次</button></div>
      <div v-else-if="!posts.length" class="community-empty reveal"><span><UsersRound :size="28" /></span><h2>还没有人发布案例</h2><p>完成一条新口播后，仍由你亲自选择是否分享到这里。</p><button class="primary-button" type="button" @click="emit('create')">去创作第一条 <ArrowRight :size="17" /></button></div>
      <template v-else><div class="community-grid reveal"><article v-for="post in posts" :key="post.id" class="community-card"><button class="community-poster" type="button" :aria-label="`播放 ${post.title}`" @click="selectedPost = post"><img v-if="post.posterUrl" :src="post.posterUrl" :alt="`${post.title} 视频预览`"><span v-else class="community-poster-fallback"><Sparkles :size="28" /></span><i class="community-play"><Play :size="20" fill="currentColor" /></i><small><Clock3 :size="12" /> {{ durationLabel(post.durationMs) }}</small></button><div class="community-card-body"><div class="community-author"><span>{{ post.authorName.slice(0, 1).toUpperCase() }}</span><strong>{{ post.authorName }}</strong><time :datetime="post.createdAt">{{ dateLabel(post.createdAt) }}</time></div><h2>{{ post.title }}</h2><p>{{ post.caption || '创作者分享了一条 MoonCut 口播成片。' }}</p></div></article></div><button v-if="nextCursor" class="community-load-more" type="button" :disabled="postsLoadingMore" @click="loadPosts(false)"><LoaderCircle v-if="postsLoadingMore" :size="16" class="is-spinning" />{{ postsLoadingMore ? '加载中…' : '查看更多作品' }}</button></template>
    </template>

    <div v-if="selectedPost" class="community-player-backdrop" role="presentation" @click.self="selectedPost = null"><section class="community-player" role="dialog" aria-modal="true" :aria-label="selectedPost.title"><button class="community-player-close" type="button" aria-label="关闭视频" @click="selectedPost = null"><X :size="18" /></button><video :src="selectedPost.videoUrl" :poster="selectedPost.posterUrl" controls autoplay playsinline preload="metadata" /><div><span>{{ selectedPost.authorName }}</span><h2>{{ selectedPost.title }}</h2><p>{{ selectedPost.caption || '创作者分享了一条 MoonCut 口播成片。' }}</p></div></section></div>
  </section>
</template>
