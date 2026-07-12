<script setup lang="ts">
import { ArrowRight, Cable, Download, FileJson2, LoaderCircle, LogIn, PackageCheck, RefreshCw, ShieldCheck, Upload } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { communityPackageAssetUrl, connectCommunityPackage, listCommunityPackages, uploadCommunityPackage } from '../services/api'
import type { CommunityRegistryPackage } from '../types'
import BrandMark from './BrandMark.vue'

const props = defineProps<{ signedIn: boolean }>()
const emit = defineEmits<{
  home: []
  'open-auth': []
  create: []
}>()

const packages = ref<CommunityRegistryPackage[]>([])
const loading = ref(true)
const error = ref('')
const registryMeta = ref('')
const showUpload = ref(false)
const uploadError = ref('')
const uploadHint = ref('')
const uploading = ref(false)
const connectingSlug = ref('')
const connectHint = ref('')
const uploadForm = ref<HTMLFormElement | null>(null)

const canUpload = computed(() => props.signedIn && !uploading.value)

function asset(item: CommunityRegistryPackage, name: 'package' | 'manifest' | 'skill' | 'connector') {
  return communityPackageAssetUrl(item.release.files[name])
}

async function loadRegistry() {
  loading.value = true
  error.value = ''
  try {
    const catalog = await listCommunityPackages()
    packages.value = catalog.items
    registryMeta.value = `Pages 社区 · ${catalog.items.length} 个已发布能力包`
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '能力社区暂时不可用'
  } finally {
    loading.value = false
  }
}

function openUpload() {
  if (!props.signedIn) {
    emit('open-auth')
    return
  }
  uploadError.value = ''
  uploadHint.value = ''
  showUpload.value = !showUpload.value
}

async function submitUpload() {
  if (!uploadForm.value || !canUpload.value) return
  uploading.value = true
  uploadError.value = ''
  uploadHint.value = ''
  try {
    const result = await uploadCommunityPackage(new FormData(uploadForm.value))
    uploadHint.value = `已发布 ${result.item.display.name} v${result.item.release.version}`
    uploadForm.value.reset()
    showUpload.value = false
    await loadRegistry()
  } catch (reason) {
    uploadError.value = reason instanceof Error ? reason.message : '上传失败，请检查能力包文件'
  } finally {
    uploading.value = false
  }
}

async function connect(item: CommunityRegistryPackage) {
  if (!props.signedIn) {
    emit('open-auth')
    return
  }
  connectingSlug.value = item.slug
  connectHint.value = ''
  try {
    const result = await connectCommunityPackage(item.slug)
    connectHint.value = `${item.display.name} 已${result.created ? '连接到' : '同步到'}本机 Agent，可在剪辑任务中选择。`
  } catch (reason) {
    connectHint.value = reason instanceof Error ? reason.message : '连接失败，请确认本机 Agent 与 Tunnel 已启动。'
  } finally {
    connectingSlug.value = ''
  }
}

onMounted(() => {
  void loadRegistry()
})
</script>

<template>
  <section class="public-community-page registry-page">
    <header v-if="!signedIn" class="public-community-nav">
      <button class="brand-home-button" type="button" aria-label="返回 MoonCut 首页" @click="emit('home')"><BrandMark /></button>
      <nav aria-label="公开导航"><button type="button" @click="emit('home')">首页</button><button class="is-active" type="button" aria-current="page">社区</button></nav>
      <div><button class="public-community-login" type="button" @click="emit('open-auth')"><LogIn :size="15" /> 登录</button><button class="public-community-create" type="button" @click="emit('create')">开始创作 <ArrowRight :size="15" /></button></div>
    </header>

    <div class="public-community-content workspace-page registry-content">
      <div class="registry-heading reveal">
        <div>
          <span class="eyebrow"><PackageCheck :size="15" /> MoonCut 社区</span>
          <h1>能力包与<br><em>创作资源</em>都在这里。</h1>
          <p>社区由 MoonCut Cloudflare Pages 托管：登录后可上传能力包，所有人可下载；连接操作只把经过格式校验的 Skill 与 Connector 交给你的本机 Agent。</p>
        </div>
        <div class="registry-heading-actions">
          <button class="community-refresh" type="button" :disabled="loading" @click="loadRegistry"><RefreshCw :size="16" :class="{ 'is-spinning': loading }" /> 刷新目录</button>
          <button class="primary-button registry-upload-button" type="button" @click="openUpload"><Upload :size="16" /> {{ signedIn ? '上传能力包' : '登录后上传' }}</button>
        </div>
      </div>

      <div class="registry-trust-strip reveal"><span><ShieldCheck :size="16" /> Pages + D1 托管，不依赖外部目录服务</span><i /><span>下载包不执行代码，仅可连接审核过的本机 Connector</span></div>

      <form v-if="showUpload" ref="uploadForm" class="registry-upload-form reveal" @submit.prevent="submitUpload">
        <div class="registry-upload-title"><strong>发布社区能力包</strong><small>仅上传声明文件：manifest.json、SKILL.md、connector.json；不接受或执行脚本。</small></div>
        <label><span>唯一 slug</span><input name="slug" required pattern="[a-z0-9][a-z0-9-]{2,79}" maxlength="80" placeholder="例如 my-story-research"></label>
        <label><span>版本</span><input name="version" required pattern="[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?" maxlength="64" placeholder="1.0.0"></label>
        <label><span>发布者名</span><input name="publisherName" required maxlength="48" placeholder="显示在社区卡片上"></label>
        <label><span>manifest.json</span><input name="manifest" required type="file" accept="application/json,.json"></label>
        <label><span>SKILL.md</span><input name="skill" required type="file" accept="text/markdown,text/plain,.md"></label>
        <label><span>connector.json</span><input name="connector" required type="file" accept="application/json,.json"></label>
        <div class="registry-upload-actions"><button class="secondary-button" type="button" :disabled="uploading" @click="showUpload = false">取消</button><button class="primary-button" type="submit" :disabled="uploading"><LoaderCircle v-if="uploading" :size="15" class="is-spinning" /> {{ uploading ? '正在校验并发布…' : '发布能力包' }}</button></div>
        <p v-if="uploadError" class="registry-form-error" role="alert">{{ uploadError }}</p>
      </form>
      <p v-if="uploadHint" class="registry-success" role="status">{{ uploadHint }}</p>
      <p v-if="connectHint" class="registry-success" role="status">{{ connectHint }}</p>

      <div v-if="loading" class="community-loading" role="status"><LoaderCircle :size="24" class="is-spinning" /><strong>正在读取 MoonCut Pages 社区目录…</strong></div>
      <div v-else-if="error" class="community-empty" role="alert"><span><RefreshCw :size="25" /></span><h2>能力社区暂时没有连上</h2><p>{{ error }}</p><button class="secondary-button" type="button" @click="loadRegistry">再试一次</button></div>
      <div v-else-if="packages.length" class="registry-grid reveal">
        <article v-for="item in packages" :key="item.slug" class="registry-card">
          <div class="registry-card-topline"><span><ShieldCheck :size="14" /> {{ item.publisher.label }}</span><small>v{{ item.release.version }}</small></div>
          <h2>{{ item.display.name }}</h2>
          <p>{{ item.display.tagline }}</p>
          <div class="registry-tags"><span v-for="kind in item.kinds" :key="kind">{{ kind === 'skill' ? 'Skill' : kind === 'connector' ? 'Connector' : kind }}</span></div>
          <div class="registry-permissions"><strong>需要确认</strong><p>{{ item.permissions.map((permission) => permission.reason).join('；') }}</p></div>
          <div class="registry-connect"><button class="primary-button" type="button" :disabled="Boolean(connectingSlug)" @click="connect(item)"><LoaderCircle v-if="connectingSlug === item.slug" :size="15" class="is-spinning" /><Cable v-else :size="15" /> {{ connectingSlug === item.slug ? '正在连接…' : '连接到 Agent' }}</button><small>仅连接内置审核 adapter；不会执行下载内容。</small></div>
          <div class="registry-downloads">
            <a class="registry-download-main" :href="asset(item, 'package')" download><Download :size="15" /> 下载能力包</a>
            <a :href="asset(item, 'manifest')" download><FileJson2 :size="14" /> Manifest</a>
            <a :href="asset(item, 'skill')" download>Skill</a>
            <a :href="asset(item, 'connector')" download>Connector</a>
          </div>
        </article>
      </div>
      <div v-else class="community-empty"><span><PackageCheck :size="25" /></span><h2>社区还没有能力包</h2><p>发布第一个经过本机 Connector 约束的 Skill，其他创作者即可下载或连接。</p></div>
      <p v-if="!loading && !error" class="registry-meta">{{ registryMeta }}</p>
    </div>
  </section>
</template>
