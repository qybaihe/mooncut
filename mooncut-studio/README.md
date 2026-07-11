# MoonCut Studio

<p align="center">
  <strong>本地优先的专业口播创作操作系统 · 无需登录</strong><br />
  Electron · Vue 3 · TypeScript · 内嵌完整制作链路
</p>

> **一句话**：MoonCut Studio 不是浏览器里的演示页，而是一台装在你电脑上的 **Studio 面板 / 桌面工作台**——从写稿、提词录制、实时陪练，到智能剪辑与成片导出，全部在本机完成。

| 维度 | 说明 |
| --- | --- |
| **产品形态** | 独立桌面 App（macOS / Windows / Linux 打包），顶栏式 Studio 面板 |
| **账号** | **无需 MoonCut 登录**，无云端身份、无社区发布 |
| **数据默认位置** | 你选择的工作目录 + 本机 Electron `userData` |
| **制作引擎** | 可内嵌 `mooncut-pi-agent`、Remotion、FFmpeg、字幕与人脸跟踪运行时 |
| **模型** | 默认本地 / Mock；远程 OpenAI 兼容接口可选，由用户自行配置 |
| **与 Web / iOS** | 同一条口播产品链路；Studio 是 **离线专业工作站**，Web 是浏览器创作台，iOS 是随身录制与陪练 |

---

## Studio 是什么、解决什么问题

MoonCut 主仓里的 Web 与 iOS 适合「随时打开、轻量体验」；当你需要：

- 不依赖公网服务也能完整走完「稿 → 录 → 剪 → 验」；
- 把项目、素材、任务日志和成片都落在自己磁盘上；
- 把 Agent、FFmpeg、Remotion 等重依赖收进一个桌面壳子里；
- 用专业面板而不是网页标签页管理多个口播项目；

就该使用 **MoonCut Studio**。

可以把它理解成：

```text
┌─────────────────────────────────────────────────────────────┐
│  MoonCut Studio（桌面操作系统壳）                             │
│  ┌──────────┬──────────┬──────────┬──────────┐              │
│  │ 项目库   │ 创作口播 │ 剪辑台   │ 设置     │  ← Studio 面板 │
│  └──────────┴──────────┴──────────┴──────────┘              │
│         │ IPC（白名单）                                      │
│         ▼                                                    │
│  Main + Agent Host（127.0.0.1 + 随机 Token）                 │
│         │                                                    │
│         ├─ 脚本助手 / 提词录制 / 口播陪练                     │
│         ├─ 导入素材 → 异步剪辑任务 → 字幕 / 分镜 / 渲染       │
│         └─ 导出成片与可追溯产物                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 界面导航（怎么用）

首次启动会进入 **引导向导**（欢迎 → 三步上手 → 选工作目录 → 隐私与模型 → 就绪）。完成后顶栏固定四块主区域：

| 面板 | 作用 | 典型操作 |
| --- | --- | --- |
| **项目库** | 本地项目总览 | 新建 / 打开 / 在访达中显示 / 从索引移除或删除文件夹 |
| **创作口播** | 对话写稿 + 提词录制 + 实时陪练 | 选话题 → 生成/润色稿 → 进入提词 → 录制保存 → 送去剪辑 |
| **剪辑台** | 项目工作台（对应 Web 的 ClipStudio） | 导入或选用录制素材 → 一键开剪 → 看进度与成片预览 |
| **设置** | 模型、外观、通用、诊断 | 配置 Provider、重启 Agent、导出诊断包（不含密钥与成片） |

顶栏还会显示 **本地 Agent** 健康状态（启动中 / 健康 / 异常）。异常时可在设置中重启 Agent Host。

### 推荐第一次路径

1. **完成引导**：选定工作目录；默认「仅本地」；可创建示例项目骨架。  
2. **项目库** 打开示例或新建项目。  
3. 顶栏 **创作口播**  
   - 用助手聊清「观众要记住什么」；  
   - 生成可念的口播稿（可本地 Mock，或配置远程模型后走真实助手）；  
   - 进入 **提词录制**：倒计时、暂停续录、语速/音量/注视等实时提示；  
   - 录完保存到项目，可 **送去剪辑**。  
4. 顶栏 **剪辑台**  
   - 确认素材 → 选择节奏（轻 / 自然 / 紧凑）→ 一键剪辑；  
   - 观察阶段：读取口播 → 识别内容 → 整理节奏 → 合成成片 → 质量检查；  
   - 预览结果，产物落在项目目录的 `jobs/` / `exports/` 等路径下。  
5. 需要云端大模型时，打开 **设置 → 模型服务商**：仅在你启用远程并保存 Profile 后，才会访问你配置的 Base URL。

### 项目在磁盘上长什么样

每个项目是一个可移动文件夹（schema：`mooncut.studio.project.v1`）：

```text
MyProject/
  mooncut.project.json   # 项目元数据
  media/                 # 导入与录制素材
  recordings/            # 录制相关
  jobs/                  # 剪辑任务与中间产物
  exports/               # 导出成片
  logs/                  # 日志
  README.txt
```

应用索引与偏好在 Electron `userData`（例如 macOS：`~/Library/Application Support/MoonCut Studio`），**卸载 App 默认不会删除你的工作目录项目**。

---

## Studio 能做什么

### 1. 项目库 —— 本地项目管理

- 在指定父目录创建项目，维护最近列表。  
- 打开后进入剪辑台；可在系统文件管理器中揭示路径。  
- 移除索引时可选是否同步删除磁盘文件夹。

### 2. 创作口播 —— 从想法到可念的稿

- 对话式引导、快速选题、生成与润色口播稿。  
- 稿件与会话按本机作用域缓存，中断后可继续。  
- 助手请求经主进程转发到本地 Agent（`/v1/assistant/script`），**渲染进程不碰密钥**。

### 3. 提词录制与口播陪练

- 提词滚动、倒计时、暂停/继续、录后复核。  
- 本地实时语速、音量与人脸相关提示（MediaPipe 等），帮助你对着镜头说清楚。  
- 录制结果写入当前绑定项目，并可一键送入剪辑台。

### 4. 剪辑台 —— 一键智能剪辑

- 对齐 Web ClipStudio 的产品节奏：空态上传 → 就绪 → 处理中 → 完成。  
- 默认使用产品预设提示词（非自由无限 prompt 墙），支持节奏强度。  
- 轮询真实 Agent 任务阶段与进度；支持取消（源素材保留）。  
- 成片与任务产物可在本机预览与导出。

### 5. 设置与诊断

- **模型服务商**：OpenAI 兼容、本地 Ollama / LM Studio、智谱、DeepSeek、Grok 等 Profile（见内置图标与目录）。  
- **外观**：浅色 / 深色 / Memphis 等主题。  
- **诊断**：依赖探测（FFmpeg、Agent、Remotion 等）、重启 Agent、导出脱敏诊断包。  
- API Key 走系统安全存储（Keychain / DPAPI），**不进项目文件、不进日志**。

---

## 与 Web / iOS 的分工

| | **MoonCut Studio** | **mooncut-web** | **iOS** |
| --- | --- | --- | --- |
| 形态 | 桌面 App / Studio 面板 | 浏览器工作台 + 落地页 | 原生 iPhone App |
| 登录 | 无 | 可选会话 / 社区 | 可选会话 |
| 数据 | 本机项目文件夹 | 浏览器本地 + 可接 Pi API | 端侧状态 + 可接 API |
| 完整剪辑运行时 | 可打包内嵌 | 依赖远端或本地 Agent 服务 | 真实成片链路需接服务 |
| 适合场景 | 专业本地制作、离线可控 | 快速体验、多端网页 | 随身录制与陪练 |

Studio **不会** iframe 嵌入 Web；视觉语言与创作心智复用 monorepo 能力，但桌面侧用 IPC + 本地 Agent 替换 Cookie 登录。

---

## 快速开始（开发）

**要求**：Node.js ≥ 22.19；macOS 12+ / Windows 10+ / 常见 Linux。

```bash
cd mooncut-studio
npm install
npm run build
npm test
npm run verify   # 无 GUI 基线校验，写出 docs/VERIFICATION_REPORT.md
npm run dev      # Vite 127.0.0.1:5178 + Electron（MOONCUT_STUDIO_DEV=1）
```

更细的安装、卸载与体积说明见 [docs/INSTALL.md](./docs/INSTALL.md)。

---

## 打包分发

安装包可嵌入完整 `mooncut-runtime`（pi-agent、remotion-studio、face-tracker、hybrid-subtitle、ffmpeg/ffprobe 等），终端用户不必再 checkout 整个 monorepo：

```bash
npm run prepare:runtime   # 仅准备 runtime 树
npm run pack:mac          # macOS
npm run pack:win          # Windows（建议在 Windows 上执行）
npm run pack:linux        # Linux
```

产物目录：`apps/desktop/release/`。

- 签名 / 公证需自备证书；仓库默认 `identity: null`，**勿宣称已签名未公证的构建可直接对外正式分发**。  
- 完整 runtime 体积较大（多 GB）；可有 minimal profile 用于 CI 干跑。  
- 细节：[docs/RELEASE.md](./docs/RELEASE.md)

---

## 仓库结构

```text
mooncut-studio/
  apps/desktop/              Electron Main / Preload / Vue Renderer
  packages/shared/           领域类型 + IPC 契约
  packages/project-format/   可移植项目格式与索引
  packages/bootstrapper/     依赖探测
  packages/agent-host/       Mock / 真实 Agent 监督与 HTTP 客户端
  docs/                      架构、隐私、安装、发布、排障
  scripts/                   dev / build / pack / verify
```

| 包 | 职责 |
| --- | --- |
| `@mooncut/studio-shared` | IPC 通道名、设置、任务阶段标签等共享类型 |
| `@mooncut/studio-project-format` | `mooncut.project.json` 与本地项目索引 |
| `@mooncut/studio-bootstrapper` | FFmpeg、Agent、Remotion 等依赖探测 |
| `@mooncut/studio-agent-host` | 子进程监督、Mock Server、真实 pi-agent 启动 |
| `@mooncut/studio-desktop` | 桌面壳与 Studio UI |

与 monorepo 兄弟模块的关系：

| 模块 | Studio 中的角色 |
| --- | --- |
| `mooncut-pi-agent/` | 真实剪辑智能体；Studio 以 **studio mode** 子进程启动（环回 + 服务令牌，无 Cookie 登录） |
| `remotion-studio/` | 成片构图与渲染 |
| `hybrid-subtitle-service/` | 可选混合字幕 |
| `face-tracker/` | 可选人物跟踪 |
| `mooncut-web/` | UX / 视觉语言参考（不内嵌） |

架构与安全基线（`contextIsolation`、沙箱、Agent 只绑 `127.0.0.1` 等）见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

---

## 隐私与安全（摘要）

- **无** MoonCut 账号、云同步、遥测后端、自动社区发布、邮件发送。  
- 默认 **local-only**；远程模型仅在你主动开启并配置后访问。  
- 密钥仅存系统安全存储；诊断包脱敏，不含密钥与用户成片。  
- 完整说明：[docs/PRIVACY.md](./docs/PRIVACY.md)

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 产品模型、数据流、安全、项目格式 |
| [INSTALL.md](./docs/INSTALL.md) | 安装、开发、打包、首次启动、卸载 |
| [PRIVACY.md](./docs/PRIVACY.md) | 本地数据边界与网络策略 |
| [RELEASE.md](./docs/RELEASE.md) | 发布与打包约定 |
| [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | 常见故障与恢复 |
| [DEPENDENCY_MATRIX.md](./docs/DEPENDENCY_MATRIX.md) | 依赖矩阵 |
| [RISK_REGISTER.md](./docs/RISK_REGISTER.md) | 风险登记 |
| [LICENSES.md](./docs/LICENSES.md) | 许可说明 |

回到 monorepo 总览：[`../README.md`](../README.md)

---

<p align="center">
  <strong>一台电脑，一套 Studio，从口播到成片。</strong><br />
  MoonCut Studio — Local first. No login. Ship on your machine.
</p>
