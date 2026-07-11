<script setup lang="ts">
import { ArrowRight, Download, FileJson2, LoaderCircle, LogIn, PackageCheck, RefreshCw, ShieldCheck } from '@lucide/vue'
import { onMounted, ref } from 'vue'
import { getCommunityRegistry, registryAssetUrl, type CommunityRegistryPackage } from '../services/communityRegistry'
import BrandMark from './BrandMark.vue'

defineProps<{ signedIn: boolean }>()
const emit = defineEmits<{
  home: []
  'open-auth': []
  create: []
}>()

const packages = ref<CommunityRegistryPackage[]>([])
const loading = ref(true)
const error = ref('')
const registryMeta = ref('')

function asset(item: CommunityRegistryPackage, name: 'package' | 'manifest' | 'skill' | 'connector') {
  return registryAssetUrl(item.release.files[name])
}

async function loadRegistry() {
  loading.value = true
  error.value = ''
  try {
    const catalog = await getCommunityRegistry()
    packages.value = catalog.packages
    registryMeta.value = `Registry v${catalog.schemaVersion} · ${catalog.packages.length} 个已发布能力包`
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '能力注册表暂时不可用'
  } finally {
    loading.value = false
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
          <p>社区统一托管可下载的能力目录、Skill 与连接器。浏览与下载不需要登录，也不会经由 MoonCut 业务服务器中转。</p>
        </div>
        <div class="registry-heading-actions"><button class="community-refresh" type="button" :disabled="loading" @click="loadRegistry"><RefreshCw :size="16" :class="{ 'is-spinning': loading }" /> 刷新目录</button></div>
      </div>

      <div class="registry-trust-strip reveal"><span><ShieldCheck :size="16" /> EdgeOne 公开只读注册表</span><i /><span>下载描述，不执行陌生代码</span></div>

      <div v-if="loading" class="community-loading" role="status"><LoaderCircle :size="24" class="is-spinning" /><strong>正在读取 EdgeOne 能力目录…</strong></div>
      <div v-else-if="error" class="community-empty" role="alert"><span><RefreshCw :size="25" /></span><h2>能力注册表暂时没有连上</h2><p>{{ error }}</p><button class="secondary-button" type="button" @click="loadRegistry">再试一次</button></div>
      <div v-else class="registry-grid reveal">
        <article v-for="item in packages" :key="item.slug" class="registry-card">
          <div class="registry-card-topline"><span><ShieldCheck :size="14" /> {{ item.publisher.label }}</span><small>v{{ item.release.version }}</small></div>
          <h2>{{ item.display.name }}</h2>
          <p>{{ item.display.tagline }}</p>
          <div class="registry-tags"><span v-for="kind in item.kinds" :key="kind">{{ kind === 'skill' ? 'Skill' : kind === 'connector' ? 'Connector' : kind }}</span></div>
          <div class="registry-permissions"><strong>需要确认</strong><p>{{ item.permissions.map((permission) => permission.reason).join('；') }}</p></div>
          <div class="registry-downloads">
            <a class="registry-download-main" :href="asset(item, 'package')" download><Download :size="15" /> 下载能力包</a>
            <a :href="asset(item, 'manifest')" target="_blank" rel="noreferrer"><FileJson2 :size="14" /> Manifest</a>
            <a :href="asset(item, 'skill')" target="_blank" rel="noreferrer">Skill</a>
            <a :href="asset(item, 'connector')" target="_blank" rel="noreferrer">Connector</a>
          </div>
        </article>
      </div>
      <p v-if="!loading && !error" class="registry-meta">{{ registryMeta }}</p>
    </div>
  </section>
</template>
