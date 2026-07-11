# MoonCut iOS · 全量原生重设计与真实接入交接

下面的代码块可以整段复制，作为新模型的第一条任务消息。

````text
你将负责 MoonCut iOS 客户端的完整原生重设计、Web 能力对齐与真实服务接入。目标不是给现有 Demo 换一层皮，而是把它变成可以登录、创作、真实剪辑、真实口播陪练、查看任务和发布/浏览社区作品的 iPhone 产品。

## 工作边界与硬性规则

- 工作区根目录：`/Users/baihe/Documents/moonbot`
- **只允许修改**：`/Users/baihe/Documents/moonbot/ios/`；如必须改动服务端契约，先停止并报告证据与最小变更方案，未经授权不得改服务端。
- 严禁修改：`mooncut-web/`、`mooncut-pi-agent/`、`hybrid-subtitle-service/`、`remotion-studio/`、`face-tracker/` 及其他目录。
- 开始先运行 `git status --short`。工作区已有大量用户未提交修改；将它们视为最新基线，绝不 `reset`、`checkout`、覆盖或清理无关文件。
- 不要提交、推送、修改 Bundle ID、写入真实账号、API Key、密码、证书私钥或 `.env`。
- 最低版本保持 iOS 17；保持 SwiftUI、AVFoundation、PhotosUI、AVKit，不引入第三方 UI 框架。可以使用 Apple 的 Speech、Vision、Combine/Observation、URLSession、Security 等系统框架。
- 代码、注释和用户文案必须明确区分“已真实连接”“尚未配置”“权限不可用”“服务失败”；禁止把网络、AI、ASR、渲染或录制失败伪装成成功。

## 开始前必读（完整阅读，不要只看文件名）

### iOS 现状

- `ios/README.md`
- `ios/project.yml`
- `ios/MoonCut/MoonCutApp.swift`
- `ios/MoonCut/Models/AppModels.swift`
- `ios/MoonCut/Models/DemoContent.swift`
- `ios/MoonCut/ViewModels/ClipStudioViewModel.swift`
- `ios/MoonCut/ViewModels/RecordStudioViewModel.swift`
- `ios/MoonCut/Services/CameraRecorder.swift`
- `ios/MoonCut/Services/VideoFileStore.swift`
- `ios/MoonCut/Views/RootView.swift`
- `ios/MoonCut/Views/Components/DesignSystem.swift`
- `ios/MoonCut/Views/Components/PetCompanionView.swift`
- `ios/MoonCut/Views/Components/CameraPreview.swift`
- `ios/MoonCut/Views/Components/VideoSurface.swift`
- `ios/MoonCut/Views/Clip/ClipStudioView.swift`
- `ios/MoonCut/Views/Record/RecordStudioView.swift`
- `ios/MoonCut/Views/Record/TeleprompterView.swift`
- `ios/MoonCutTests/DraftProcessorTests.swift`
- `ios/MoonCutUITests/PetCompanionUITests.swift`

### Web 产品行为与视觉基线（作为“能力和主题”参考，不复制 DOM/CSS）

- `mooncut-web/src/App.vue`
- `mooncut-web/src/types.ts`
- `mooncut-web/src/composables/useTheme.ts`
- `mooncut-web/src/components/LandingPage.vue`
- `mooncut-web/src/components/AuthStudio.vue`
- `mooncut-web/src/components/AppNavigation.vue`
- `mooncut-web/src/components/ClipStudio.vue`
- `mooncut-web/src/components/RecordStudio.vue`
- `mooncut-web/src/composables/useSpeakingCoach.ts`
- `mooncut-web/src/components/QueueStudio.vue`
- `mooncut-web/src/components/CommunityStudio.vue`
- `mooncut-web/src/components/PetCompanion.vue`
- `mooncut-web/src/services/api.ts`
- `mooncut-web/src/styles.css`

### 服务真实契约与安全边界

- `mooncut-pi-agent/API.md`
- `mooncut-pi-agent/openapi.yaml`
- `mooncut-pi-agent/src/server.ts`
- `mooncut-pi-agent/src/assistant.ts`
- `mooncut-pi-agent/src/auth.ts`
- `mooncut-pi-agent/src/config.ts`
- `mooncut-pi-agent/README.md`

## 已完成的审查结论（以此为基线，不要重新猜测）

| 范畴 | 现状证据 | 此任务必须达成 |
|---|---|---|
| iOS 视觉 | 现有 `DesignSystem.swift` 是单一蓝灰卡片体系；截图显示大标题/卡片像窄屏 Web，底部浮层会遮住滚动内容 | 重建为高级、密度合理、原生的 iPhone 信息架构；不得只调几个颜色或圆角 |
| 三主题 | Web 已是 `light | dark | memphis` 并持久化；iOS 仅为 `system | light | dark` | iOS 对齐为可明确选择、持久化的浅色、深色、Memphis 三主题；首次未选择时可按系统推导浅/深，但不要给用户增加不清楚的循环按钮 |
| 剪辑 | iOS `ClipStudioViewModel.startProcessing()` 通过固定 `Task.sleep` 把进度跑到 100；成片是原片加视觉叠层 | 上传、建任务、轮询、成片下载/播放必须调用真实 API；绝不伪造进度、完成或导出 |
| 稿件 | `RecordStudioViewModel` 通过固定等待、`DemoContent`、`DraftProcessor` 生成内容 | 对话、建议、成稿与三类润色调用真实 `/v1/assistant/script`；网络失败必须可重试，不能退回假 AI 回答 |
| 陪练 | Web 已有浏览器侧实时指标与 `/v1/assistant/coach`；iOS 没有陪练分析 | iOS 用系统 Speech、AVFoundation、Vision 采集真实可得指标，并调用真实教练接口；不可用的指标应明确标注不可用，不得捏造 |
| 相机/录制 | 现有 `CameraRecorder` 的真实前摄和分段合并可复用；无权限时会进入“演示录制”，却没有真实文件 | 保留并加强真实录制；无权限/无相机时引导到系统设置，绝不生成“演示成片”或允许假交接 |
| 宠物 | 已有 `HappyDogSpritesheet`、9 行状态、触摸开心值、轻触反馈 | 保留并重构为全局宠物状态中心；状态只能由真实业务状态/真实陪练反馈驱动，不得压住输入、底栏、媒体控制或无障碍焦点 |
| 服务 | 本机 `http://127.0.0.1:4317/healthz` 审查时返回 `ok: true`、模型网关可达；`127.0.0.1:8765` 字幕服务未运行 | 上线/真机验收先检查服务健康和字幕依赖；服务不完整时展示真实错误/等待，不得用模拟成功遮掩 |
| 鉴权 | 服务源码支持邮箱注册/登录后 HttpOnly `mooncut_session` Cookie；`API.md` 同时记录了面向可信客户端的 Bearer Key | App 默认用用户邮箱登录后的 Cookie 会话，绝不嵌入服务 API Key。若部署环境实测仅接受 Bearer Key，停下报告——必须由服务端提供移动端专用令牌机制，不能把通用 Key 放进 IPA |

## 产品目标

把 MoonCut 做成“从想法到能发布口播成片”的原生创作工具。产品气质：安静、精确、可信、带一点月亮与陪伴感；不是通用 AI 聊天壳，也不是把 Web 卡片逐个竖排到手机上。

三套视觉模式必须是同一产品、同一业务状态、同一可访问性质量下的三种完整外观：

1. `light` — 高级编辑台：暖白/微冷白背景、深灰正文、细腻层级、克制蓝色只用于主要动作和状态；利用 iOS material、分组列表、导航栏、底部 sheet 的原生质感。
2. `dark` — 影视工作间：深石墨背景、黑色视频承载区、柔和高对比文字、低饱和月蓝/银灰强调；不可做成一片纯黑或荧光赛博风。
3. `memphis` — 与 Web 对齐的第三主题：暖纸张、墨色描边、少量亮黄/粉/青/薄荷绿贴纸强调、受控错位阴影。只做一个精致的点睛系统，不能让提词、表单、队列和视频预览沦为贴纸墙。

主题应使用集中式 SwiftUI semantic tokens，而不是在每个 View 散落 RGB 值。浅/深主题优先依从系统对比度、减少动态效果和 Dynamic Type；Memphis 是应用主题，不得强行把系统 `ColorScheme` 固定为浅色。三主题都需在冷启动、登录、进入沉浸提词、弹 sheet、错误、禁用和加载状态下正确呈现。

## 原生信息架构与布局

不要沿用现有“顶部大品牌 + 两个巨大切换按钮 + 全屏浮动双 tab”的布局。建议实现以下原生结构；如因真实交互发现更好方案，可调整，但必须完整覆盖同等能力。

```text
认证（未登录）
  注册 / 登录（原生 Form、隐私与服务器状态）
       ↓
创作 Tab（默认）
  今日创作概览 + 开始剪辑 + 继续陪练/继续任务
  ├─ 剪辑工作流：选素材 → 配置 → 云端处理 → 成片复核/分享/发布
  └─ 口播工作流：脚本助手 → 稿件 → 沉浸提词 + 实时陪练 → 录制复核 → 交给剪辑
陪练 Tab
  稿件、可观测指标、实时建议、录制入口、历史/继续
任务 Tab
  我的任务、匿名共享队列、失败重试入口、完成任务详情
社区 Tab
  浏览已发布的成片、播放、主动发布质检通过的我的成片
```

- 用 `TabView`、`NavigationStack`、`NavigationSplitView`（若以后扩展 iPad）和系统 toolbar，而不是自制会遮挡内容的底部浮栏。
- “创作”可以是首页而不是再做一个 Web Landing Page；登录后要让用户在一屏内知道上次任务/稿件是否可继续。
- 剪辑、陪练、任务、社区四个目的地都应能在任意主题下独立工作。不要只美化首屏。
- 沉浸提词允许隐藏 tab bar，但必须有 44 pt 以上的退出、设置、状态和录制控制；退出时恢复同一个导航状态。
- 所有屏幕采用 safe area、可滚动内容和原生 presentation。键盘出现时输入框和稿件工具栏仍可用；宠物气泡要自动收起。
- 不要在 iPhone 上放 Web 版营销式巨型两行标题。标题层级使用 `navigationTitle`、`large`/`inline` display mode、`contentMargins` 和可读的正文密度。

## 设计系统与交互规范

### 必须保留并善用的原生能力

- `PhotosPicker` 和文件导入用于视频选择；选择后复制到 App 支持目录，显示真实大小、时长和缩略图。
- `AVCaptureSession` / `AVCaptureVideoPreviewLayer` 用于前摄录制；`AVPlayer` / `AVPlayerViewController` 用于本地与远程成片复核。
- `ShareLink` 或系统分享 sheet 只分享真正下载到本地的成片文件。
- 主题使用 `@AppStorage("mooncut:theme")`；值统一为 `light`、`dark`、`memphis`。主题选择器应是有标签、可读、可访问的 Menu 或 sheet，不能靠用户猜点击循环。
- 用 SF Symbols 和系统字体；避免从网页强搬字体、Canvas 图表或 CSS 风格的重阴影。
- 使用 `Material`、`ContentUnavailableView`、`ProgressView`、`Gauge`、`LabeledContent`、`ShareLink`、`confirmationDialog`、`sensoryFeedback`/haptic 等适合的系统组件，但不要为了“原生”把复杂创作流程塞成无层级的 `List`。

### 视觉和可访问性质量门槛

- 44×44 pt 最小触控目标；所有图标按钮有明确 `accessibilityLabel` 和状态/值。
- 支持 Dynamic Type（至少到 Accessibility Large）、VoiceOver、Reduce Motion、深色模式和 4.5:1 正文对比。
- 不使用仅靠颜色表达成功/失败；错误有图标、文字、重试及必要时诊断编号。
- 动效只表达状态：按钮按下 100–150ms，页面/卡片出现 200–350ms；减少动态时停止宠物循环和装饰性动效，保留录制/处理的文字状态。
- Memphis 页面最多一组主要几何装饰；视频、提词、聊天、队列与数据指标优先信息可读性。
- 任何滚动容器末尾都必须为系统 tab bar/底部操作区预留空间。不得通过固定 `UIScreen.main.bounds` 判断布局；用 size class、safe area、`ViewThatFits` 或 GeometryReader 的局部尺寸。

## 宠物“小月”：必须是产品状态的一部分

继续使用现有资产：

- `ios/MoonCut/Assets.xcassets/HappyDogSpritesheet.imageset/happydog-spritesheet.png`
- 现有的 8 列 × 9 行切帧约定（idle / waving / jumping / failed / waiting / running / review）

重构要求：

1. 抽出共享 `PetStateStore` / reducer，不能由每个 View 随意猜状态。
2. 状态映射必须真实：
   - 无稿件或空剪辑：`waiting`；
   - 正在请求脚本、上传、排队、渲染或下载：`running`；
   - 正在提词录制：`waving`；
   - 真正完成剪辑/完成录制复核/收到正向陪练反馈：`jumping` 或 `review`；
   - 明确的权限、网络、任务失败：`failed`；
   - 其他稳定态：`idle`。
3. 宠物应作为 tab bar 上方的轻量中心“搭子”入口或创作页局部组件，不能再用大号 `overlay` 压住底部导航、输入框、视频控件或 Share 按钮。
4. 点击保持轻触感、爱心反馈和本地开心值持久化；开心值只反映互动，不得被伪造为训练/任务完成数据。
5. 气泡内容来自真实当前状态或真实脚本/陪练 API 的 `petMessage`。小屏、键盘、提词沉浸页和 VoiceOver 时必须缩减/收起气泡，但宠物入口仍可访问。

## 真正的 API 接入：这是完成定义，不是后续 TODO

### 网络、安全与会话

1. 新建清晰的服务层，例如 `Services/API/`：`MoonCutAPIClient`、`APIConfiguration`、`AuthenticatedSession`、DTO、错误映射、上传/下载、任务轮询。UI View 不能直接拼 URL 或手写 JSON。
2. API Base URL 必须走 Debug/Release 的 xcconfig 或 `Info.plist` 配置注入；默认值可指向生产服务 `https://42.194.219.172`，但任何机密均不进入源码、plist、测试截图或 Git。
3. 用户认证使用以下现有端点：
   - `POST /v1/auth/register` `{email,password}`；
   - `POST /v1/auth/login`；
   - `GET /v1/auth/session` / `GET /v1/auth/me` 恢复会话；
   - `POST /v1/auth/logout`。
   使用一个设置了 `HTTPCookieStorage` 的 `URLSession` 持有服务端 HttpOnly `mooncut_session` Cookie。不要试图读取 Cookie 值、不要将其复制进 UserDefaults；注销要真正清除该站点 Cookie 和本地身份状态。
4. `API.md` 所述通用 `MOONCUT_API_KEY` 是可信服务/CLI 凭据，绝不能打进原生 App。服务源码支持用户 Cookie 会话；若生产入口与源码不一致并拒绝该会话，记录请求/响应证据并停止，要求服务端提供移动端 OAuth/短期 token 方案。
5. 生产服务使用私有 CA。不得关闭 ATS、不得使用 `URLSessionDelegate` 无条件信任所有证书、不得 `allowsAnyHTTPSCertificateForHost`。只在拿到经授权的 `mooncut-ca.crt` 后，为固定生产 host 实现最小范围的信任锚定/证书校验；没有证书时以可理解的“无法验证服务器身份”错误阻断，而不是不安全地继续。
6. 本地 Debug 服务可以走独立 Debug 配置及最窄的 ATS 例外；Release 禁止 HTTP。物理 iPhone 不得假定能访问电脑的 `127.0.0.1`。
7. URLSession 请求要有超时、取消、离线/401/413/415/429/5xx 的结构化错误，且 401 只在会话失效时回到登录页。上传使用 `uploadTask(fromFile:)` / 文件流，不得把大视频整体读进内存。

### 剪辑真实流程

实现下列真实路径，替换 `ClipStudioViewModel.startProcessing()` 的所有计时假进度：

```text
PhotosPicker / 文件导入 / 真录制 URL
  → 复制并校验真实媒体
  → POST /v1/assets?filename=...（二进制 body）
  → POST /v1/edit-jobs { assetId, title, prompt, imageGeneration }
  → 保存 jobId，前台每约 3 秒 GET /v1/edit-jobs/{jobId}
  → 服务端 status/stage/progress 驱动 UI
  → completed：下载/播放 result.artifacts.video，展示真实字幕/QA/摘要产物
  → failed：显示服务端安全摘要和可重试/保留素材动作
```

- 可以用单步 `POST /v1/edits`，但两阶段上传更容易恢复和显示状态；选一种并把状态持久化。
- `stage` 文案映射真实服务阶段：检查素材、转写、素材调度、跟脸、编排、渲染、质检、已完成；不要提前显示已完成。
- `progress` 是 0...1；没有数值或网络暂断时显示“不确定，仍在等待服务更新”，不能本地自行增长。
- 在 App 重启、页面切换、后台/前台恢复后读取保存的活跃 jobId 并继续查询。不要丢掉服务器上的真任务。
- 成片远程播放、下载、分享和发布都必须携带会话；如 `AVPlayer` 不自动带 Cookie，请为固定 URL 安全地提供当前 Cookie 请求头或先通过 URLSession 下载到本地，不能用未授权公开 URL 兜底。
- 对应实现任务队列 `GET /v1/render-queue` 与社区：`GET/POST /v1/community/posts`、Range 视频/海报。只有真实 `quality.ok` 的完成任务才显示发布入口；不要本地伪造社区贴。

### 真实脚本助手与陪练

#### 脚本助手

- 用 `POST /v1/assistant/script` 接入对话、三条建议、成稿、口语化/精简/增强情绪三类润色。请求字段遵从现有服务：`action`（`guide|generate|polish`）、可选 `style`（`oral|short|emotional`）、最近消息数组和当前 `draft`。
- 使用返回的 `reply`、`phase`、`ready`、`draft`、三条 `suggestions`、`petMessage`、`model`；保留本地稿件草稿，但模型内容不能由 `DemoContent` 或字符串替换伪造。
- 网络失败时保留用户输入/稿件并提供“重试真实请求”；不弹出假助手回答。

#### 实时口播陪练

这是独立产品核心，不是录制页上的一个装饰分数。用原生能力完成：

1. 请求并解释相机、麦克风、语音识别权限；未授权时给系统设置跳转和清楚的降级说明。
2. 用 `SFSpeechRecognizer`（中文优先 `zh-CN`，可用时）和真实音频输入获得局部/最终转写；用 AVFoundation 的实际音频采样计算音量、停顿、已说字数/速度。不得将计时器、随机数或稿件长度伪装成用户发声数据。
3. 用 `Vision` 对真实相机帧做脸部/朝向检测。若只能可靠判断脸部在画面和朝向，则产品标签应为“镜头朝向（估算）”，不能声称精确“眼神接触率”。Vision 无法工作时把该项标为暂不可用，不填一个漂亮数字。
4. 保留现有真实前摄录制、暂停续录、镜像、倒计时、设置和复核。若要同时录制和语音识别，必须正确管理 `AVAudioSession`、采样缓冲/格式和并发；不要为了赶工让两条链路互相抢麦克风。若该组合需要重构 `CameraRecorder`，优先保证真实视频/音频文件不会损坏。
5. 当存在真实转写及指标时，以防抖/节流方式调用 `POST /v1/assistant/coach`，传 `transcript`、`currentScript`、`currentSentence`、`lastAdvice` 和真实 `metrics`（pace、wordCount、volume、pauseCount、可选 eyeContact、elapsedSeconds）。使用返回的 `advice`、`category`、`positive`、`petMessage` 和 `model`。
6. 不要每一帧请求模型；只有跨越有效时间/语句/显著指标变化时请求，上一请求可取消，UI 要显示“正在分析”且不阻塞录制。网络失败只保留本地事实指标，建议区明确显示“教练暂时未连接”。
7. 复核页显示真实录制视频和真实时长；只有 `outputURL` 真实存在且可播放才允许“交给剪辑”。无权限或失败时不得创建“演示录制 · 已就绪”。

## 建议的数据与代码结构

可调整命名，但保持业务、网络、媒体、呈现分层，并避免巨型 ViewModel：

```text
MoonCut/
  App/
    MoonCutApp.swift, AppRouter.swift, AppTheme.swift
  Core/
    Models/, Persistence/, DesignSystem/, Pet/
  Services/
    API/ (client, DTO, auth/session, upload/download, errors)
    Media/ (video store, recorder, player/download)
    Coaching/ (speech, audio metrics, vision metrics)
  Features/
    Auth/, Home/, Edit/, Coach/, Teleprompter/, Jobs/, Community/, Settings/
  Views/Components/ (小而可复用的呈现组件)
```

- 因目标是 iOS 17，可使用 `@Observable` + `@MainActor` 或保留清晰的 `ObservableObject`；不要同时创建两套状态源。
- 主题、认证、宠物、活跃任务分别是单一可注入状态源。用户私有草稿、活跃 jobId、主题、宠物开心值按用户 ID 做 namespace，登出时清除私有本地数据或按产品定义安全隔离。
- DTO 与 UI model 分开；日期、字节数、时长和服务阶段均有本地化格式化。
- `DemoContent`、`DraftProcessor`、假 processing task 应移除或仅限 SwiftUI Preview/Test fixture，运行时产品路径不得引用它们。

## 必须实现的界面状态（每种主题都要覆盖）

- 认证：注册、登录、登录中、错误、恢复会话、登出。
- 创作首页：无内容、继续草稿、活跃剪辑任务、服务不可用。
- 剪辑：选择素材、真实媒体已选、上传中、排队中、服务分阶段处理、完成、下载/播放、失败、重新编辑、分享、发布社区。
- 脚本：初始引导、消息发送、真实响应、建议选择、生成稿件、三种真实润色、编辑/复制、网络错误与重试。
- 陪练/提词：权限说明、相机连接、实时真实指标、模型建议、倒计时、录制、暂停、续录、完成、语音/视觉不可用、网络异常、复核。
- 任务：我的活跃/最近任务、匿名共享队列、自动刷新、下拉刷新、空/失败状态。
- 社区：加载、空、分页、海报/视频播放、发布确认、质量门禁失败。
- 小月：正常、忙碌、失败、完成、触摸、Reduce Motion、小屏、键盘、沉浸提词。

## 执行顺序

1. 只读盘点现有 iOS、Web 和服务契约，先写在任务回复中的简短“计划与风险”。
2. 先建立原生导航、主题 token、认证会话、API client 和可测试 DTO；不要先画一张漂亮静态首页。
3. 替换剪辑的假任务为真实上传/创建/轮询/下载链路，完成活跃任务恢复。
4. 替换脚本假回答为真实脚本助手；完成陪练的原生采集与真实建议调用。
5. 建设创作、任务、社区，重组宠物，并逐主题完善组件。
6. 完成所有错误、权限、离线、动态字体、Reduce Motion 和小屏细节。
7. 每完成一个纵向流程在真实设备/模拟器上复查，再做最终视觉 QA；不得只凭 Xcode Preview 宣称完成。

## 验证与交付门槛

### 静态与自动化

必须至少运行：

```bash
cd /Users/baihe/Documents/moonbot/ios
xcodegen generate   # 仅在修改 project.yml 后
# 先用 `xcrun simctl list devices available` 选择实际已安装的 iPhone 16 Pro UDID。
xcodebuild -project MoonCut.xcodeproj -scheme MoonCut \
  -destination 'platform=iOS Simulator,id=<iPhone-16-Pro-UDID>' clean build
xcodebuild -project MoonCut.xcodeproj -scheme MoonCut \
  -destination 'platform=iOS Simulator,id=<iPhone-16-Pro-UDID>' test
```

新增并通过测试：

- API client：Cookie 会话、请求 JSON、错误映射、二进制文件上传、任务进度/失败响应、取消和轮询恢复（用 `URLProtocol` 或等价 stub，不接触真实密钥）。
- 主题：三主题保存/冷启动恢复、系统默认推导、Memphis 不污染浅/深 token。
- 宠物状态 reducer：真实任务/陪练事件到动画状态的映射。
- 媒体/录制：无真实 `outputURL` 时不能交给剪辑。
- UI：核心 tab、登录错误、空态、活跃任务、宠物入口和沉浸提词退出的 accessibility identifier/label；不要只保留旧宠物单测。

### 真连接验收

- 先执行 `GET /healthz`。现有本机服务审查时健康，但本机字幕服务未运行；生产/集成验收要把相关依赖状态如实报告。
- 如果本次任务环境被提供了经过授权的测试账户、生产 CA 与安全配置，必须在真实服务上完成：登录 → 选一段非敏感测试视频 → 上传 → 创建任务 → 轮询一段真实服务阶段 → 恢复任务 → 完成后下载/播放/分享（完整渲染可较久，等待期间保持真实状态）。
- 若没有授权凭据/CA，不得绕过 TLS、不得编造成功。完成 API stub 验收、证明 App 会在配置缺失时安全失败，并在最终回复列出缺少的配置。
- 陪练至少在模拟器/真机使用真实权限和可用的系统输入验证：实时指标不会由假计时产生；如模拟器不具备输入能力，使用真机验证或明确写出限制与已运行的单元/UI 测试。

### 截图与视觉审查

用真实模拟器生成并检查截图，放在以下目录（若目录不存在则创建）：

- `ios/screenshots/redesign/light-home-iphone16pro.png`
- `ios/screenshots/redesign/dark-edit-iphone16pro.png`
- `ios/screenshots/redesign/memphis-coach-iphone16pro.png`
- `ios/screenshots/redesign/light-teleprompter-iphone16pro.png`
- `ios/screenshots/redesign/memphis-jobs-iphone16pro.png`
- `ios/screenshots/redesign/dark-community-iphone16pro.png`
- `ios/screenshots/redesign/light-home-iphonese.png`

逐张检查：安全区、Dynamic Island、tab bar、键盘、宠物、长文本、最大字号、加载/错误、视频控制、对比度和触控目标。必须修复遮挡/截断后再交付。

## 最终回复格式

用中文简洁报告：

1. 已实现的真实用户流程与三主题设计要点。
2. 修改/新增的 iOS 文件（按功能归类）。
3. Web 与 iOS 之间的能力对齐表；明确哪些是系统原生替代而非照抄 Web。
4. 已接入端点、认证方式、隐私/证书处理方式；确认没有在 App 中写入 API Key。
5. 构建、单测、UI 测试、模拟器截图和真实服务验收结果。
6. 仍未完成的真实依赖或阻塞项（例如未提供私有 CA、服务端只接受通用 Bearer Key、字幕服务未运行），以及需要产品/后端确认的最小事项。

不要声称“完成真实对接”，除非每个相应用户操作确实由真实服务/系统数据驱动；不要将 Preview、mock、定时器或本地规则回退写成真实 AI、真实剪辑或真实陪练。
````

## 交接前审查摘要

- iOS 工程基线可通过 iPhone 16 Pro 模拟器测试命令；本次未改动 iOS 运行时代码。
- `mooncut-pi-agent` 本机健康接口返回正常，模型网关可达；本机字幕服务端口未启动，因此完整剪辑链路必须做依赖就绪判断。
- 现有 iOS 截图确认底部浮动导航与宠物存在遮挡风险；交接稿已将其设为视觉验收项。
- 生产私有 CA 与移动端鉴权需要按真实部署配置验证，不能靠关闭 TLS 或将通用服务 Key 内置到客户端解决。
