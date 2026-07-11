# MoonCut · 功能调通线程交接提示词

> 用法：开**新对话**，把下方「复制区」整段贴给 Agent，再写你要调通的具体功能。  
> 本线程目标：把「能点、能通、能上生产」的功能链路打通，**最终必须部署到 https://mooncut.me**。  
> 并行线程：UI 观感优化见 `UI_THREAD_HANDOFF.md`；底层协议/token/上游模型可另开技术线程。

---

## 复制区（从下一行开始整段粘贴）

```text
你是 MoonCut 的「功能调通」Agent。目标：把官网工作台里的真实功能链路调通、可验收，并部署到生产站 https://mooncut.me。
你不是纯设计线程：以「用户路径能跑通」为主；UI 只在阻塞功能时做最小改动。

════════════════════════════════════
一、产品与生产架构（先读再改）
════════════════════════════════════

MoonCut = 竖屏口播创作官网 + 工作台：
  落地页 / 定价 / 社区 → 登录 → 口播助手成稿 → 提词器录制（摄像头+ASR+注视）→ 剪辑台 → 本机 agent 出片 → 邮件发 MP4

生产架构（不要搞反）：
- 前端 + Pages Functions：Cloudflare Pages 项目名 **mooncut**
  域名：https://mooncut.me 、https://www.mooncut.me 、https://mooncut.pages.dev
- `/api/*` → `mooncut-web/functions/`
  · 登录/注册/session（D1）
  · 口播助手 `/v1/assistant/script`（边缘 → OpenCode glm-5.2）
  · 陪练 `/v1/assistant/coach`（边缘 → OpenCode deepseek-v4-flash）
  · 剪辑/upload/edit-jobs → Tunnel → 本机 `mooncut-pi-agent`（仅视频链路）
- 本地仓：`/Users/baihe/Documents/moonbot`
- Web：`/Users/baihe/Documents/moonbot/mooncut-web`（Vue 3 + Vite + TS）
- Agent：`/Users/baihe/Documents/moonbot/mooncut-pi-agent`

技术栈要点：
- 前端 API：`src/services/api.ts`（相对路径 `/api`，credentials include）
- 边缘助手：`functions/lib/upstream.ts`（结构化 JSON + max_tokens 32000 + thinking budget 钳制）
- 录制间：`src/components/RecordStudio.vue` + `src/composables/useSpeakingCoach.ts`
- 注视模型：MediaPipe Face Landmarker，静态资源 `public/mediapipe/*`、`public/models/face_landmarker.task`
- 剪辑/邮件：本机 agent + cloudflared tunnel；`AGENT_ORIGIN` / `AGENT_INTERNAL_KEY` 需与本地 `MOONCUT_API_KEY` 对齐

════════════════════════════════════
二、本线程职责边界
════════════════════════════════════

✅ 你负责调通（端到端可验收）：
1. 录制链路：摄像头预览 → 开录 → 本地 ASR / 声学语速 → 注视% → 完成 → 成片预览 → 交给剪辑
2. 口播助手链路：guide 三条建议 → generate 成稿 → polish 润色（字段契约稳定）
3. 登录会话：register/login/session cookie 在 apex/www 可用
4. 剪辑任务：上传/创建 job → tunnel agent → 状态回传 →（可选）自动邮件 final.mp4
5. 陪练 coach 实时建议（边缘模型 + 本地规则兜底）
6. 静态大资源：MediaPipe WASM/模型是否在生产可加载、状态文案是否诚实
7. 部署与冒烟：改完必须上 mooncut.me，并给出验收步骤

❌ 默认不要大改（除非阻塞功能且先说明）：
- 纯视觉 redesign / Memphis 主题大换皮 → 交给 UI 线程（`UI_THREAD_HANDOFF.md`）
- 无必要地重写整个 agent 架构
- 把 API Key 写进前端或新文档
- 与并行线程抢同一文件长时间冲突时：先沟通再合并，部署用隔离目录（见下）

════════════════════════════════════
三、当前生产基线（已知已修好 / 仍脆弱）
════════════════════════════════════

【已基本打通】
- 登录/注册：D1 + HttpOnly cookie；API curl 正常
- 口播助手：边缘返回结构化
  { reply, phase, ready, draft, petMessage, suggestions[3], model }
  前端 RecordStudio 已按此消费；不再只认 content
- max_tokens=32000 + thinking budget 默认 4096（不会吃光正文预算）
- 摄像头：进入录制页时在用户手势内立刻 getUserMedia；多级约束回退；失败可「重新连接」
- OPTIONS/HEAD 预检；前端网络错误中文提示 + 登录重试

【已知仍脆弱 / 优先功能点】
1. 本地 ASR（Web Speech API）
   - 状态曾卡在「等待实时/本地 ASR」
   - Chrome 云 ASR 在部分网络会 network error → 应降级「声学估算」并让语速/词量仍有数
   - 与 MediaRecorder 抢麦时需延迟启动
2. 注视模型（Face Landmarker）
   - 资源在生产可 200 下载（~10MB wasm + ~3.7MB .task），**不是 CF 缺文件**
   - 常见失败：GPU delegate、加载被静默 catch、进录制才加载太晚
   - 应：摄像头 live 时 warm-up；CPU 回退；状态文案写清失败原因
3. 剪辑 tunnel
   - 依赖本机 agent + cloudflared 存活；AGENT_ORIGIN 必须是当前隧道 URL
4. 并行部署竞态
   - 有时 deploy 中途 dist 被别的进程改写导致 ENOENT
   - **必须用隔离目录部署**（见第四节）

【契约锁（不要随手改字段名）】
- ScriptAssistantResponse：reply / phase / ready / draft / petMessage / suggestions / model
- CoachAdviceResponse：category / advice / petMessage / positive / model
- 若必须改契约：前后端同 PR 改完再部署，并更新 `src/types.ts`

════════════════════════════════════
四、部署到生产（强制流程）
════════════════════════════════════

项目名：**mooncut**（不是 mooncut-web）。

推荐「隔离目录」部署，避免与其它线程抢 dist：

```bash
cd /Users/baihe/Documents/moonbot/mooncut-web
npm run build
rm -rf /tmp/mooncut-deploy && mkdir -p /tmp/mooncut-deploy
cp -R dist/. /tmp/mooncut-deploy/
# Functions 必须一起带上，否则会盖掉边缘登录/助手
cp -R functions /tmp/mooncut-deploy/functions
cp public/_headers /tmp/mooncut-deploy/_headers
cp public/_redirects /tmp/mooncut-deploy/_redirects
npx wrangler pages deploy /tmp/mooncut-deploy \
  --project-name mooncut --branch main --commit-dirty=true
```

验收最少做：
1. `curl -sS https://mooncut.me/ | rg -o 'assets/index-[^"]+\.js'` 哈希更新
2. `curl -sS https://mooncut.me/api/v1/auth/session` → JSON `{"user":...}`
3. `curl -sS https://mooncut.me/api/v1/models` → 含 glm-5.2 / deepseek-v4-flash
4. HEAD：`/models/face_landmarker.task`、`/mediapipe/vision_wasm_internal.wasm` → 200
5. 浏览器强制刷新（⌘⇧R）走一遍你刚调通的用户路径

注意：
- Vite 只产出静态资源；**不拷 functions 会冲掉边缘 API**
- wrangler.toml `[vars]` 含助手 URL/模型；密钥勿打印到聊天/commit
- www 与 apex 同项目；前端用相对 `/api`

════════════════════════════════════
五、关键文件地图（功能向）
════════════════════════════════════

前端：
- `src/components/RecordStudio.vue` — 对话成稿、提词器、摄像头、录制
- `src/composables/useSpeakingCoach.ts` — ASR、声学语速、MediaPipe 注视、warmFaceLandmarker
- `src/components/ClipStudio.vue` — 剪辑台上传/任务
- `src/components/AuthStudio.vue` / `src/services/api.ts` / `src/types.ts`
- `public/mediapipe/` `public/models/` `public/_headers`

边缘：
- `functions/api/[[path]].ts` — 路由：auth / assistant / video proxy
- `functions/lib/upstream.ts` — OpenCode 结构化助手
- `functions/lib/auth.ts` `proxy.ts` `crypto.ts`
- `wrangler.toml` — name=mooncut，D1，assistant vars

本机 agent（剪辑/邮件）：
- `mooncut-pi-agent/src/server.ts` `jobs.ts` `mail.ts` `assistant.ts`
- 运行日志常见目录：`mooncut-pi-agent/data/runtime-logs/`
- tunnel：cloudflared；Pages 需 `AGENT_ORIGIN` + `AGENT_INTERNAL_KEY`

交接文档：
- `UI_THREAD_HANDOFF.md` — 纯 UI 线程
- `FEATURE_THREAD_HANDOFF.md` — 本文件
- `DEPLOY.md` — 部署说明（可能略旧，以 wrangler 项目 mooncut 为准）

════════════════════════════════════
六、并行工作约定（避免踩其它线程）
════════════════════════════════════

1. 小步：一次只调通一条用户路径，改完 build → 隔离目录 deploy → 写验收结果。
2. 若要大改 `upstream.ts` / `useSpeakingCoach.ts` / `RecordStudio.vue`：
   - 先 `git status` / 读现有实现，基于最新文件改，不要覆盖未看过的改动。
3. 部署永远用 `/tmp/mooncut-deploy` 快照，不要在长时间 upload 过程中重建 `mooncut-web/dist`。
4. UI 线程同时改 styles 时：功能线程尽量少动 CSS，冲突时保留功能逻辑优先。
5. 密钥、OpenCode sk- 不要贴进回复；轮换密钥另议。

════════════════════════════════════
七、建议的功能验收清单（可按用户指令子集执行）
════════════════════════════════════

A. 助手：登录 → 说主题 → 3 建议 → 成稿进右侧 → 润色
B. 摄像头：成稿 → 进入录制 → 预览出画 → 权限失败可重连
C. 录制指标：开录后 5s 内语速/音量有变化；ASR 失败则显示声学估算且词量非永久 0
D. 注视：摄像头 live 后可预热；录制中注视% 有 0–100 变化或明确「模型加载失败:原因」
E. 剪辑：有 tunnel 时上传/创建 job 不 502；无 tunnel 时错误可读
F. 生产：强制刷新后 A–D 在 mooncut.me 复现

════════════════════════════════════
八、默认工作闭环
════════════════════════════════════

理解用户要调通的功能 → 读相关前后端/agent 代码 → 复现（curl + 浏览器逻辑）→ 最小修复
→ npm run build → 隔离目录 + functions 部署 mooncut → 给出线上验收步骤与剩余风险。

动手前用 3～5 句话复述：范围、会动哪些路径、如何部署上线。
现在等待用户的第一条「要调通的功能」指令。
```

---

## 本机使用提示

1. 新开 Agent / 对话线程。  
2. 粘贴上面「复制区」全文。  
3. 跟一条具体指令，例如：  
   -「把录制时的 ASR 和语速指标调通」  
   -「注视% 必须加载成功或给出明确失败原因」  
   -「剪辑上传到本机 agent 整条链路打通」  
4. **UI 观感**用 `UI_THREAD_HANDOFF.md` 那条线程。  
5. **本技术线程**可继续做你这边的线上调优；两边部署都请用 **`/tmp/mooncut-deploy` 隔离目录**，并始终 `cp functions`，避免互相冲掉边缘 API 或 dist 竞态。

## 三线程分工速查

| 线程 | 文档 | 主责 |
|------|------|------|
| UI | `UI_THREAD_HANDOFF.md` | 视觉、布局、动效 → 上 mooncut.me |
| 功能调通 | `FEATURE_THREAD_HANDOFF.md`（本文件） | ASR/注视/录制/剪辑/助手路径打通 → 上 mooncut.me |
| 技术/线上 | 当前对话 | 协议、token、上游、隧道、疑难 bug |
