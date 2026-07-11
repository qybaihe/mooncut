# MoonCut iOS · 功能分析报告（真实 vs Mock）

> 日期：2026-07-11  
> 范围：`ios/` 客户端行为，对照 `mooncut-pi-agent` 契约与系统能力  
> 原则：**禁止把网络/AI/ASR/渲染失败伪装成成功**；公开分发包不得暴露内网端口与服务密钥

---

## 1. 总览

| 模块 | 真实度 | 说明 |
|---|---|---|
| 视觉 / 三主题 / 导航 | ✅ 真实客户端 UI | 纯本地 SwiftUI，无服务依赖 |
| 邮箱注册 / 登录 / 会话 | ✅ 真实 API | Cookie `mooncut_session`，无 API Key |
| 服务健康检查 | ✅ 真实 API | `GET /healthz` |
| 云端剪辑上传 / 建任务 / 轮询 | ✅ 真实 API | 进度仅来自服务端，不本地自增 |
| 成片下载 / 分享 | ✅ 真实文件路径 | 需任务真正完成 |
| 社区列表 / 发布 | ✅ 真实 API | 发布受质检门禁 |
| 任务队列 | ✅ 真实 API | `GET /v1/render-queue` |
| 脚本助手 / 润色 | ✅ 真实 API | `/v1/assistant/script`，失败可重试、不回落假 AI |
| 口播陪练建议 | ✅ 真实 API + 系统能力 | 指标本地采集，建议走 `/v1/assistant/coach` |
| 相机录制 | ✅ 系统真实能力 | 无权限则阻断，不生成演示成片 |
| 语音语速/音量/停顿 | ✅ 系统 Speech + 音频 RMS | 模拟器可能不可用 → 标明不可用 |
| 镜头朝向 | ⚠️ 真实估算 | Vision 面部 yaw/roll/框位置，**非**精确眼神接触率 |
| 宠物小月动画 / 开心值 | ✅ 本地真实状态机 | 由业务事件驱动；开心值仅触摸互动 |
| 完整成片渲染结果 | ⚠️ 依赖服务端 | 客户端链路真实，但依赖字幕/渲染服务是否就绪 |
| 邮件通知 | ➖ 未做 iOS UI | 服务端有 mail API，App 未接 |
| 公开 CI IPA 默认联网 | ❌ 故意未配置 | 公共包不写死生产地址，需自建服务 |

**图例**：✅ 真实可用（有依赖时如实失败） · ⚠️ 部分真实 / 有限制 · ➖ 未实现 · ❌ 故意禁用（安全）

---

## 2. 分模块明细

### 2.1 认证与会话

| 能力 | 状态 | 证据 / 路径 |
|---|---|---|
| 注册 | ✅ | `POST /v1/auth/register` · `AuthView` + `MoonCutAPIClient` |
| 登录 | ✅ | `POST /v1/auth/login` |
| 会话恢复 | ✅ | `GET /v1/auth/session` · 冷启动 `AppEnvironment.bootstrap` |
| 登出 | ✅ | `POST /v1/auth/logout` + 清 Cookie |
| API Key 登录 | ❌ 不做 | 通用 Key 不得进 IPA |
| OAuth / 手机号 | ➖ | 未实现 |

**依赖**：可达的 agent 基址；生产需私有 CA（`mooncut-ca.crt` 锚定固定 host）。

### 2.2 剪辑工作流

| 步骤 | 状态 | 说明 |
|---|---|---|
| 相册 / 文件选片 | ✅ | PhotosUI / fileImporter，复制到 App 沙盒 |
| 显示大小 / 时长 | ✅ | 本地 `VideoFileStore` + AVAsset |
| 上传素材 | ✅ | `POST /v1/assets` 文件流上传 |
| 创建任务 | ✅ | `POST /v1/edit-jobs` |
| 进度展示 | ✅ | `GET /v1/edit-jobs/{id}` 的 `status/stage/progress` |
| 本地假进度条 | ❌ 已移除 | 无 `Task.sleep` 灌进度 |
| 完成后下载 | ✅ | artifacts/video → 本地再 ShareLink |
| 发布社区 | ✅ | 仅 `quality.ok == true` 显示入口 |
| 服务端真正渲染成片 | ⚠️ | 客户端已接；需 agent + 字幕服务 + Remotion 等后端就绪 |

### 2.3 脚本助手

| 能力 | 状态 |
|---|---|
| 对话 guide | ✅ `/v1/assistant/script` |
| 生成稿 generate | ✅ |
| 口语化 / 精简 / 情绪 polish | ✅ |
| 建议卡片 | ✅ 服务端返回 |
| 网络失败假回复 | ❌ 禁止，仅重试 |
| 本地草稿持久化 | ✅ UserDefaults（按用户隔离） |

### 2.4 口播陪练 / 提词

| 能力 | 状态 | 框架 |
|---|---|---|
| 前摄预览与录像 | ✅ | AVFoundation |
| 分段暂停合并 | ✅ | 真实文件 |
| 无权限演示成片 | ❌ 禁止 |
| 语速 / 词量 / 停顿 | ✅ | Speech + 时间线 |
| 音量 | ✅ | 麦克风 RMS |
| 镜头朝向 | ⚠️ 估算 | Vision Face Landmarks |
| 教练文案 | ✅ | `/v1/assistant/coach`（节流） |
| 教练断连 | ✅ 诚实文案 | 保留本地指标 |
| 只陪练不录制 | ✅ | 沉浸台双入口 |

**模拟器限制**：无真实麦/摄像头时指标标「不可用」——这是真实降级，不是 Mock 成功。

### 2.5 任务 / 社区 / 宠物 / 主题

| 能力 | 状态 |
|---|---|
| 渲染队列 | ✅ 真实轮询 |
| 社区列表分页 | ✅ |
| 社区播放 | ⚠️ 依赖 Cookie 与 AVPlayer；必要时应先下载 |
| 三主题 light/dark/memphis | ✅ 本地持久化 |
| 小月状态 | ✅ 业务事件 reducer |
| 小月开心值 | ✅ 仅互动，非训练成绩 |

### 2.6 仍依赖后端 / 环境的部分（不是客户端 Mock）

1. **hybrid-subtitle-service** 未启动时，完整剪辑可能失败或长时间停在转写阶段——客户端会显示服务端失败/等待，不伪造完成。  
2. **生产入口**若只接受 Bearer 通用 Key 而不接受用户 Cookie，移动端必须停用并改服务端发短期 token。  
3. **私有 CA**：无 `mooncut-ca.crt` 时生产 HTTPS 会被拒绝（安全阻断）。  
4. **真机 Debug**：不能假设 `127.0.0.1` 指向电脑，需局域网 Base URL。

---

## 3. 公开 IPA 安全策略

GitHub 上提供的 **Public IPA** 用于演示壳与自托管对接，**默认不能直接连上我们的内网/生产端口**。

| 措施 | 说明 |
|---|---|
| 不写生产 Base URL | `Config/Public.xcconfig` 使用 `UNCONFIGURED` |
| 不嵌入 API Key / 账号密码 | 源码与 CI 均禁止 |
| 不关闭 TLS 校验 | 无「信任任意证书」 |
| 未签名或需自签 | CI 产出 unsigned IPA，需用户用自己的 Apple 证书重签安装 |
| 服务需自备 | 用户部署自己的 `mooncut-pi-agent` 后，改 xcconfig / 企业分发配置再连 |

因此：**能下载 App 壳 ≠ 能调用我们的私有服务**。

---

## 4. 结论（给产品 / 发布）

- **客户端主路径已按真实 API + 系统能力实现**，不是 Demo 计时器。  
- **“能否完成一条成片”**取决于后端字幕/渲染是否健康，不取决于 iOS 是否 Mock。  
- **公开下载包**应走 `Public` 配置 + unsigned IPA，避免把生产 host/端口能力变成“装上就能打我们服务器”。  
- 内部验收请用 Debug（本机）或受控 Release（私有 CA + 内网/VPN），不要用 Public IPA 直连生产。
