<script setup lang="ts">
import { ArrowRight, LogIn } from '@lucide/vue'
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
  openAuth: [mode: AuthMode]
  create: []
}>()

const updatedAt = '2026-07-11'
</script>

<template>
  <div class="landing-shell privacy-page">
    <header class="landing-nav privacy-nav" role="banner">
      <div class="landing-nav-inner">
        <button class="landing-brand privacy-brand" type="button" aria-label="返回 MoonCut 首页" @click="emit('home')">
          <BrandLogo variant="mark" class="landing-brand-logo" />
          <span class="landing-brand-copy" aria-hidden="true">
            <strong>MoonCut</strong>
            <small>口播创作台</small>
          </span>
        </button>

        <nav class="landing-anchors" aria-label="隐私页主导航">
          <button type="button" @click="emit('home')">首页</button>
          <button type="button" @click="emit('openPricing')">定价</button>
          <button type="button" @click="emit('openCommunity')">社区</button>
          <button class="is-active" type="button" aria-current="page">隐私与政策</button>
        </nav>

        <div class="landing-nav-actions">
          <template v-if="signedIn">
            <button class="landing-cta-primary" type="button" @click="emit('create')">
              进入工作台 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </template>
          <template v-else>
            <button class="landing-auth-ghost" type="button" @click="emit('openAuth', 'login')">
              <LogIn :size="15" aria-hidden="true" /> 登录
            </button>
            <button class="landing-cta-primary" type="button" @click="emit('create')">
              开始创作 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </template>
        </div>
      </div>
    </header>

    <main class="landing-content privacy-content">
      <article class="privacy-doc" aria-labelledby="privacy-doc-title">
        <header class="privacy-doc-header">
          <p class="privacy-doc-kicker">Privacy &amp; Policy</p>
          <h1 id="privacy-doc-title">隐私与政策</h1>
          <p class="privacy-doc-lead">
            这份说明用普通中文讲清楚：MoonCut 会处理哪些信息、哪些留在你自己的设备、哪些会经过我们的服务，以及当前产品边界。它不是法律套话堆砌，而是希望你在开始创作前，对数据流向有真实预期。
          </p>
          <p class="privacy-doc-meta">最近更新：{{ updatedAt }}</p>
        </header>

        <section class="privacy-doc-section" aria-labelledby="p-scope">
          <h2 id="p-scope">1. 适用范围</h2>
          <p>
            本文适用于 mooncut.me 官网、登录账户、录制工作室、剪辑台、运行队列，以及与之配套的边缘 API 服务。社区能力目录若由独立注册表托管，浏览与下载规则以其自身说明为准；我们会在相关界面标明来源。
          </p>
          <p>
            MoonCut 是竖屏口播创作工具：帮你从想法写成稿、提词录制，再进入剪辑与任务队列。功能在演进中；凡涉及「演示」「本机 Agent」「待开放」的表述，均按当前真实能力描述，不替代正式合规认证。
          </p>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-collect">
          <h2 id="p-collect">2. 我们处理哪些信息</h2>
          <p>按你实际使用的功能，可能涉及以下几类：</p>
          <ul>
            <li>
              <strong>账户信息</strong>：注册与登录时的邮箱、会话标识（session cookie）。用于识别你是否已登录、恢复工作台入口，以及在你开启相关通知时发送任务状态邮件。
            </li>
            <li>
              <strong>创作内容</strong>：你在口播助手对话中输入的想法、生成的稿件草稿、润色请求、提词与陪练相关文本。助手与陪练请求会经边缘服务转发至所配置的模型提供方，以便返回结构化回复。
            </li>
            <li>
              <strong>媒体与任务</strong>：你主动上传或从录制间送入剪辑的视频素材、剪辑指令与任务状态。素材会进入你所配置的 MoonCut Agent 处理链路；任务进度与产物由服务端（含你本机 Agent 侧）按当前架构持久化或回传。
            </li>
            <li>
              <strong>技术与运行日志</strong>：为保障服务可用，边缘与部署平台可能记录常规请求元数据（如时间、状态码、错误类型）。我们不以「隐私营销」话术夸大安全等级。
            </li>
          </ul>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-local">
          <h2 id="p-local">3. 哪些尽量留在你这边</h2>
          <p>
            <strong>浏览器本地草稿与会话偏好。</strong>
            脚本草稿、部分页面偏好（例如同会话内的工作台记忆）会优先保存在当前浏览器本地。换设备、清缓存或换浏览器时，本地内容可能不可用——这是本地存储的正常边界，不是「云端默认同步全部草稿」。
          </p>
          <p>
            <strong>模型密钥不进前端。</strong>
            调用大模型所需的密钥与服务端配置留在边缘/服务端环境中，不会写入前端打包代码，也不会要求你在浏览器里粘贴 API Key。
          </p>
          <p>
            <strong>摄像头与麦克风。</strong>
            提词录制依赖你在浏览器里授予的媒体权限。实时画面与录音在录制流程中由浏览器处理；是否进一步上传或送入剪辑，取决于你是否主动进入剪辑/上传路径。
          </p>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-flow">
          <h2 id="p-flow">4. 数据大致怎么走</h2>
          <p>用一条常见创作路径说明（细节以线上实现为准）：</p>
          <ol>
            <li>你在浏览器打开 mooncut.me，未登录可浏览落地页、定价与公开社区；创建与剪辑等创作功能需要登录。</li>
            <li>登录后，会话由 Cloudflare Pages / Functions 侧维护的 session cookie 标识，前端通过同域 <code>/api</code> 访问业务接口。</li>
            <li>口播助手（写稿、润色、建议）与摄像陪练：请求到达边缘 API，再转发到所配置的模型服务，返回结构化结果展示在工作台。</li>
            <li>剪辑与上传：素材与任务经隧道等链路进入你配置的 MoonCut Agent（通常运行在你可控的本机或私有环境），状态与产物再回写到队列/工作台可见的结果。</li>
          </ol>
          <p>
            因此：<strong>「全部数据永远不出设备」并不准确</strong>；更准确的说法是——草稿与偏好可优先本地，模型推理经服务端，媒体剪辑走你配置的 Agent。请按你信任的部署方式使用。
          </p>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-use">
          <h2 id="p-use">5. 我们如何使用这些信息</h2>
          <ul>
            <li>提供登录、写稿、录制、剪辑、队列与能力相关功能；</li>
            <li>在界面中展示助手回复、建议卡片、任务进度与错误提示；</li>
            <li>在你需要时发送与任务/账户相关的通知；</li>
            <li>排查故障、保障可用性与安全（例如识别异常请求）。</li>
          </ul>
          <p>
            我们不会把你的口播草稿或视频素材当作广告定向素材对外售卖。若未来引入第三方分析或新的数据用途，会在产品内或本页同步说明。
          </p>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-share">
          <h2 id="p-share">6. 与谁共享</h2>
          <ul>
            <li>
              <strong>基础设施提供方</strong>：如 Cloudflare Pages / Functions、你选择的模型提供方、邮件或隧道相关基础设施——仅为实现功能所必需。
            </li>
            <li>
              <strong>你配置的 Agent</strong>：剪辑与上传任务会到达你自己配置的 MoonCut Agent；其运行环境、磁盘与网络策略由部署方控制。
            </li>
            <li>
              <strong>法律要求</strong>：在法律法规要求或为保护用户与服务安全所必需时，可能依法披露。
            </li>
          </ul>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-retention">
          <h2 id="p-retention">7. 保存与删除</h2>
          <p>
            账户会话在你退出登录或会话失效后不再作为有效登录凭证使用。本地草稿随浏览器存储生命周期变化。服务端任务与产物的保留周期取决于当前 Agent 与边缘实现，以及你是否主动清理任务。
          </p>
          <p>
            若你需要删除账户或清除服务端关联数据，请通过产品内反馈渠道或你部署环境的运维方式联系处理；我们会按可实现的技术路径协助，不承诺「一键抹除所有第三方模型日志」（模型提供方有其自身留存规则）。
          </p>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-boundary">
          <h2 id="p-boundary">8. 产品边界（请先读这一段）</h2>
          <ul>
            <li>MoonCut 不虚构用户规模、媒体背书或已获隐私合规认证；本页也不是 ISO/等保类证明。</li>
            <li>模型输出可能不完整、延迟或失败；界面会尽量用清晰错误条与兜底文案说明，不伪装成「永远成功」。</li>
            <li>公开社区/能力目录侧重发现与下载描述；安装与执行陌生能力前请自行审阅权限与来源。</li>
            <li>你应对上传内容的版权与合法性负责；请勿上传他人隐私或违法内容。</li>
          </ul>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-rights">
          <h2 id="p-rights">9. 你的选择</h2>
          <ul>
            <li>可以不登录，仅浏览公开页面；</li>
            <li>可以拒绝摄像头/麦克风权限，但录制相关功能将不可用；</li>
            <li>可以不上传视频，仅使用写稿与本地向的创作路径；</li>
            <li>可以随时退出登录，并清理浏览器本地数据；</li>
            <li>可以在浏览器设置中限制 Cookie 与站点数据（可能导致无法保持登录）。</li>
          </ul>
        </section>

        <section class="privacy-doc-section" aria-labelledby="p-update">
          <h2 id="p-update">10. 说明更新</h2>
          <p>
            产品能力会迭代。我们会在本页更新关键表述，并尽量在界面中同步重要变化。继续使用服务即表示你已阅读当前版本的说明；若你不同意某项处理方式，请停止使用相关功能并联系我们协商。
          </p>
          <p>
            有疑问时，优先通过官网内的账户与反馈入口联系；涉及你自建 Agent 环境的问题，请同时检查本机配置与隧道连通状态。
          </p>
        </section>

        <footer class="privacy-doc-footer">
          <p>MoonCut · 从一句话开始，陪你走到一条能发的口播。</p>
          <div class="privacy-doc-actions">
            <button class="landing-cta-secondary" type="button" @click="emit('home')">返回首页</button>
            <button class="landing-cta-primary" type="button" @click="emit('create')">
              开始创作 <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </article>
    </main>
  </div>
</template>
