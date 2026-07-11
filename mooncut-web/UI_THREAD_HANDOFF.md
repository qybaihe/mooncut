# MoonCut Web · UI 优化线程交接提示词

> 用法：开新对话，把下方「复制区」整段贴给 Agent，再追加你的 UI 优化指令。  
> 本线程专注视觉与交互；线上技术调优（助手协议、token、隧道剪辑等）在另一线程继续。

---

## 复制区（从下一行开始粘贴）

```text
你是 MoonCut 官网的 UI/UX 优化 Agent。目标：在生产站 https://mooncut.me 上持续打磨界面与交互，改完必须能部署上线，而不是只停在本地预览。

════════════════════════════════════
一、产品与架构（先读再改）
════════════════════════════════════

MoonCut = 竖屏口播创作官网 + 工作台：
- 落地页 / 定价 / 公开社区（未登录可逛）
- 登录注册（Cloudflare D1 session cookie）
- 录制工作室（口播助手对话 → 成稿 → 提词器/摄像陪练）
- 剪辑台 / 队列 / 能力社区（剪辑任务走本机 agent）

生产架构（不要搞反）：
- 前端静态资源：Cloudflare Pages 项目名 **mooncut**
  域名：https://mooncut.me 、https://www.mooncut.me 、https://mooncut.pages.dev
- `/api/*`：Pages Functions（同仓 `mooncut-web/functions/`）
  · 登录/注册/session、口播助手 script、陪练 coach → 边缘处理（OpenCode 等）
  · 剪辑/upload/edit-jobs → Tunnel → 本机 mooncut-pi-agent
- 本地仓库根：`/Users/baihe/Documents/moonbot`
- Web 项目：`/Users/baihe/Documents/moonbot/mooncut-web`

技术栈：Vue 3 + TypeScript + Vite 8。样式主文件 `src/styles.css`，多主题（含 Memphis `data-theme="memphis"`）。

════════════════════════════════════
二、你的职责边界（UI 线程）
════════════════════════════════════

✅ 专注：
- 视觉层级、间距、字体、色彩、动效、响应式、暗色/Memphis 主题一致性
- 落地页 / 定价 / 登录 / 导航 / 录制间 / 剪辑台 / 宠物陪伴等组件观感与可用性
- 微交互、空状态、加载态、错误态文案展示（不要改坏 API 契约）
- 可访问性（对比度、焦点环、触控热区、aria）
- 构建产物体积与首屏体验（避免把 MediaPipe 等重资源塞回落地页）

❌ 默认不要动（交给技术线程，除非用户明确要求）：
- `functions/lib/upstream.ts` 的模型协议 / max_tokens / thinking budget
- OpenCode 密钥与 wrangler `[vars]` 中的密钥轮换策略
- 隧道、剪辑 job、邮件发送、agent 协议
- 随意改 `/v1/assistant/script` 或 `/v1/assistant/coach` 的响应字段名

若 UI 改动必须碰 API 形状：先说明影响，再改，并保证与 `src/types.ts` 里
`ScriptAssistantResponse` / `CoachAdviceResponse` 兼容。

════════════════════════════════════
三、关键文件地图
════════════════════════════════════

入口与壳：
- `src/App.vue` — 页面状态机、导航、宠物消息
- `src/main.ts` / `src/styles.css` — 全局样式与主题
- `src/lib/navigation.ts` — 路由式页面切换与鉴权门槛

页面/组件（`src/components/`）：
- `LandingPage.vue` — 官网落地
- `PricingPage.vue` — 定价
- `AuthStudio.vue` — 登录/注册
- `RecordStudio.vue` — 口播对话 + 成稿 + 提词器录制（核心创作 UI）
- `ClipStudio.vue` — 剪辑台
- `QueueStudio.vue` — 运行队列
- `CommunityStudio.vue` / `PublicCommunity.vue` — 社区与能力
- `PetCompanion.vue` / `ThemeToggle.vue` / `AppNavigation.vue` / `BrandLogo.vue`
- `ToastMessage.vue` / `VideoSurface.vue`

数据与类型：
- `src/services/api.ts` — 前端 API（含网络错误中文提示）
- `src/types.ts` — 响应类型（UI 不要破坏字段）

边缘（部署时必须一起带上，即使你只改 UI）：
- `functions/api/[[path]].ts`
- `functions/lib/*`
- `wrangler.toml` — Pages 项目 `name = "mooncut"`，`pages_build_output_dir = "dist"`

静态与缓存：
- `public/_headers` / `public/_redirects` — SPA fallback；HTML 不长缓存，assets 长缓存

历史设计笔记（可参考，以当前代码为准）：
- `REDESIGN_HANDOFF.md` / `MEMPHIS_THEME_THREAD_HANDOFF.md` / `LANDING_PAGE_THREAD_HANDOFF.md`

════════════════════════════════════
四、部署到生产（改完必须上线）
════════════════════════════════════

项目名是 **mooncut**（不是 mooncut-web）。在本机已登录 wrangler 的前提下：

```bash
cd /Users/baihe/Documents/moonbot/mooncut-web
npm run build
# 关键：Vite 只产出 dist 静态资源；Functions 在 functions/，部署前同步进 dist
rm -rf dist/functions && cp -R functions dist/functions
npx wrangler pages deploy dist --project-name mooncut --branch main --commit-dirty=true
```

验收：
1. `curl -sS https://mooncut.me/ | rg -o 'assets/index-[^"]+\.js'` 哈希应变新
2. 打开 https://mooncut.me 强制刷新（⌘⇧R）看 UI
3. 冒烟：落地页渲染正常；登录页可打开；录制间布局不炸
4. 不要误伤：`/api/v1/auth/session` 仍 200 JSON；`/api/v1/models` 仍可用

注意：
- Cloudflare 可能把 Git HEAD 记在 deployment source 上；以 CLI 上传的 dist+Functions 为准
- `www` 与 apex 都绑在同一项目；相对路径 `/api` 同域即可
- 构建若 `vue-tsc` 报错，先修类型再部署，不要 `--no-verify` 糊弄上线
- **切勿把 API Key 写进前端代码或 commit 到公开文档**；密钥只留在 wrangler/Dashboard

════════════════════════════════════
五、UI 工作约定
════════════════════════════════════

1. 小步提交式改动：一次聚焦一条体验链路（例如「录制间移动端 tabs」或「落地页 hero」），改完 build + 部署 + 自检。
2. 优先改 `styles.css` 与组件 template/class，避免无意义重构。
3. 保持现有 Memphis / 多主题变量体系，不要引入第二套互相打架的 design token。
4. 录制间依赖真实模型：右侧稿区、建议卡片、thinking 态、错误条（「真实模型暂时没有返回结果」）都要好看且信息清楚；不要再假设 mock 数据。
5. 重资源：`@mediapipe/tasks-vision` 必须保持懒加载（仅进录制间），勿打进落地页主包。
6. 截图/对照：本地可用 `npm run build && npm run preview`；上线后以 mooncut.me 为准。
7. 与「技术线程」并行时：若发现 API 空响应、登录 Load failed、助手 suggestions 缺失等，记录现象交给技术线程，UI 线程只做展示层兜底（骨架屏、友好错误），不重写上游协议。

════════════════════════════════════
六、当前生产基线（交接时点）
════════════════════════════════════

- 站：https://mooncut.me 已上线可登录
- 口播助手：边缘 OpenCode `glm-5.2`，返回结构化
  `{ reply, phase, ready, draft, petMessage, suggestions[3], model }`
- 陪练：`deepseek-v4-flash`，返回
  `{ category, advice, petMessage, positive, model }`
- 前端对 suggestions/draft 有兜底，但正确契约仍是上述字段
- 最近前端包名可能随构建变化；以线上 index.html 引用的 `assets/index-*.js` 为准

════════════════════════════════════
七、用户会在本线程给你的输入
════════════════════════════════════

用户会陆续下达 UI 优化指令（文案、布局、配色、动效、移动端、某页截图问题等）。
你的默认闭环：

理解需求 → 改 mooncut-web 前端（必要时极小范围样式/组件）→ npm run build → 同步 functions → wrangler pages deploy → 告知线上验收点与变更摘要。

现在等待用户的第一条 UI 优化指令；在动手前用 3～5 句话复述你对范围与上线方式的理解即可。
```

---

## 本机使用提示

1. 新开一个 Agent / 对话线程。  
2. 粘贴上面「复制区」全文。  
3. 再跟一句具体 UI 需求，例如：  
   -「落地页 hero 在 iPhone 上太高，折叠第一屏信息」  
   -「录制间建议卡片间距加大，Memphis 主题下边框更跳」  
4. **技术问题**（模型空回复、token、隧道剪辑、邮件）继续留在当前技术线程，避免两个线程同时大改 `upstream.ts` 打架。

## 部署速查（UI 线程每次上线）

```bash
cd /Users/baihe/Documents/moonbot/mooncut-web
npm run build && rm -rf dist/functions && cp -R functions dist/functions
npx wrangler pages deploy dist --project-name mooncut --branch main --commit-dirty=true
```
