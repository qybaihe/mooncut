<script setup lang="ts">
import {
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Keyboard,
  Monitor,
  PlaySquare,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from '@lucide/vue'
import type { AuthMode } from '../lib/navigation'
import BrandLogo from './BrandLogo.vue'

defineProps<{
  signedIn: boolean
  userEmail?: string | null
}>()

const emit = defineEmits<{
  home: []
  openPricing: []
  openCommunity: []
  openPrivacy: []
  openAuth: [mode: AuthMode]
  create: []
}>()

const releaseUrl = 'https://github.com/qybaihe/mooncut/releases'

const capabilities = [
  {
    icon: FolderOpen,
    title: '项目都在你的磁盘上',
    detail: '每条内容都有可移动的项目文件夹：素材、录制、任务、导出与日志分开归档。',
  },
  {
    icon: Keyboard,
    title: '一条桌面创作链路',
    detail: '从对话写稿、提词录制、实时陪练，到智能剪辑与预览，不必在多个网页标签间跳转。',
  },
  {
    icon: ShieldCheck,
    title: '本地优先，边界清楚',
    detail: '默认本机工作；只有你主动配置远程模型服务时，才会连接你指定的接口。',
  },
] as const

const studioFlow = [
  { label: '选工作目录', hint: '项目从这里开始落盘', icon: FolderOpen },
  { label: '写稿并录制', hint: '提词器与陪练在桌面内完成', icon: Keyboard },
  { label: '交给本机剪辑', hint: 'Agent、字幕与渲染按需接力', icon: WandSparkles },
  { label: '预览并导出', hint: '成片回到你的项目目录', icon: PlaySquare },
] as const
</script>

<template>
  <div class="landing-shell studio-page">
    <header class="landing-nav studio-nav" role="banner">
      <div class="landing-nav-inner">
        <button class="landing-brand studio-brand" type="button" aria-label="返回 MoonCut 首页" @click="emit('home')">
          <BrandLogo variant="mark" class="landing-brand-logo" />
          <span class="landing-brand-copy" aria-hidden="true">
            <strong>MoonCut</strong>
            <small>口播创作台</small>
          </span>
        </button>

        <nav class="landing-anchors" aria-label="MoonCut Studio 页面导航">
          <button type="button" @click="emit('home')">首页</button>
          <button class="is-active" type="button" aria-current="page">Studio</button>
          <button type="button" @click="emit('openPricing')">定价</button>
          <button type="button" @click="emit('openCommunity')">社区</button>
          <button type="button" @click="emit('openPrivacy')">隐私与政策</button>
        </nav>

        <div class="landing-nav-actions">
          <template v-if="signedIn">
            <button class="landing-auth-ghost" type="button" @click="emit('create')">进入网页版</button>
          </template>
          <template v-else>
            <button class="landing-auth-ghost" type="button" @click="emit('openAuth', 'login')">登录</button>
          </template>
          <a class="landing-cta-primary studio-nav-download" :href="releaseUrl" target="_blank" rel="noreferrer">
            下载 Studio <Download :size="16" aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>

    <main class="landing-content studio-content">
      <section class="studio-hero" aria-labelledby="studio-title">
        <div class="studio-hero-copy">
          <p class="studio-kicker"><Monitor :size="15" aria-hidden="true" /> MoonCut Studio · Desktop app</p>
          <h1 id="studio-title">把完整的口播工作台，<br>装进你的电脑。</h1>
          <p class="studio-lead">
            MoonCut Studio 是本地优先的桌面创作工作台。写稿、提词录制、智能剪辑和成片导出，沿着一条不打断的桌面路径完成。
          </p>
          <div class="studio-hero-actions">
            <a class="landing-cta-primary studio-download-cta" :href="releaseUrl" target="_blank" rel="noreferrer">
              <Download :size="18" aria-hidden="true" /> 前往 GitHub Releases <ExternalLink :size="15" aria-hidden="true" />
            </a>
            <button class="landing-cta-secondary" type="button" @click="emit('home')">
              了解网页版 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </div>
          <p class="studio-download-note"><HardDrive :size="14" aria-hidden="true" /> 安装包与支持平台以 Releases 页面中的当前说明为准。</p>
        </div>

        <section class="studio-window" aria-label="MoonCut Studio 桌面工作台预览">
          <header class="studio-window-bar">
            <span class="studio-window-dots" aria-hidden="true"><i /><i /><i /></span>
            <span class="studio-window-title">MoonCut Studio</span>
            <span class="studio-window-status"><i aria-hidden="true" /> 本地 Agent 健康</span>
          </header>
          <div class="studio-window-body">
            <aside class="studio-window-sidebar" aria-hidden="true">
              <span class="studio-sidebar-brand">MC</span>
              <span class="is-selected"><FolderOpen :size="17" /> 项目库</span>
              <span><Keyboard :size="17" /> 创作口播</span>
              <span><WandSparkles :size="17" /> 剪辑台</span>
              <span><ShieldCheck :size="17" /> 设置</span>
            </aside>
            <div class="studio-workspace">
              <div class="studio-workspace-head">
                <div><small>本地项目</small><strong>本周的口播</strong></div>
                <span>同步已关闭</span>
              </div>
              <div class="studio-workspace-grid" aria-hidden="true">
                <div class="studio-project-card studio-project-card--main">
                  <div class="studio-card-video"><PlaySquare :size="24" /></div>
                  <div><b>在镜头前，说清一个观点</b><small>录制素材 · 03:42</small></div>
                </div>
                <div class="studio-project-card">
                  <div class="studio-card-progress"><i /><i /><i /><i /></div>
                  <b>智能剪辑</b><small>整理节奏与字幕</small>
                </div>
                <div class="studio-timeline-card">
                  <div class="studio-timeline-label"><span>时间线</span><small>00:42 / 03:42</small></div>
                  <div class="studio-timeline"><i /><i /><i /><i /><i /><b /></div>
                </div>
              </div>
              <div class="studio-workspace-footer"><span><i /> 本机保存</span><span>exports / video.mp4</span></div>
            </div>
          </div>
        </section>
      </section>

      <section class="studio-trust" aria-label="MoonCut Studio 特点">
        <span><HardDrive :size="17" aria-hidden="true" /> 本地项目文件夹</span>
        <i aria-hidden="true" />
        <span><ShieldCheck :size="17" aria-hidden="true" /> 无需 MoonCut 登录</span>
        <i aria-hidden="true" />
        <span><Sparkles :size="17" aria-hidden="true" /> 远程模型按需配置</span>
      </section>

      <section class="studio-capabilities" aria-labelledby="studio-capabilities-title">
        <header class="studio-section-head">
          <p class="studio-kicker">LOCAL-FIRST WORKSTATION</p>
          <h2 id="studio-capabilities-title">不是又一个网页标签页，<br>是一张完整的制作台。</h2>
        </header>
        <div class="studio-capability-grid">
          <article v-for="item in capabilities" :key="item.title" class="studio-capability-card">
            <span class="studio-capability-icon"><component :is="item.icon" :size="22" aria-hidden="true" /></span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.detail }}</p>
          </article>
        </div>
      </section>

      <section class="studio-flow-section" aria-labelledby="studio-flow-title">
        <div class="studio-flow-intro">
          <p class="studio-kicker">ONE CONTINUOUS FLOW</p>
          <h2 id="studio-flow-title">一台电脑，一套 Studio，<br>从口播到成片。</h2>
          <p>工作区不会把你的创作拆成散落的页面。每一步完成后，下一步就在同一个项目里等你。</p>
        </div>
        <ol class="studio-flow-list">
          <li v-for="(step, index) in studioFlow" :key="step.label" class="studio-flow-step">
            <span class="studio-flow-num">0{{ index + 1 }}</span>
            <span class="studio-flow-icon"><component :is="step.icon" :size="19" aria-hidden="true" /></span>
            <div><strong>{{ step.label }}</strong><small>{{ step.hint }}</small></div>
            <Check :size="17" aria-hidden="true" />
          </li>
        </ol>
      </section>

      <section class="studio-download-panel" aria-labelledby="studio-download-title">
        <div>
          <p class="studio-kicker">GET THE DESKTOP APP</p>
          <h2 id="studio-download-title">准备好把工作台放到本机了吗？</h2>
          <p>在 GitHub Releases 查看当前可用的桌面包、版本说明与安装提示。</p>
        </div>
        <a class="landing-cta-primary studio-download-cta" :href="releaseUrl" target="_blank" rel="noreferrer">
          <Download :size="18" aria-hidden="true" /> 下载 MoonCut Studio <ExternalLink :size="15" aria-hidden="true" />
        </a>
      </section>

      <footer class="landing-footer studio-footer">
        <div class="footer-brand" aria-label="MoonCut">
          <BrandLogo variant="mark" class="footer-logo-mark" />
          <span class="footer-brand-name">MoonCut</span>
        </div>
        <p class="footer-note">网页版轻量开始，Studio 把完整制作链路留在你的电脑上。</p>
        <p class="landing-footer-links">
          <button type="button" @click="emit('home')">返回首页</button>
          <button type="button" @click="emit('openPrivacy')">隐私与政策</button>
          <a :href="releaseUrl" target="_blank" rel="noreferrer">GitHub Releases</a>
        </p>
      </footer>
    </main>
  </div>
</template>
