# MoonCut 生产 API 文档（多端接入）

> 面向 **iOS / 鸿蒙 / Android / 桌面** 等非 Web 客户端。  
> 以生产站 **https://mooncut.me** 边缘 API 为准（Cloudflare Pages Functions）。  
> 文档版本：2026-07-11 · 与仓库 `functions/` + 前端 `src/services/api.ts` 对齐。

---

## 1. 总览

### 1.1 Base URL

| 环境 | Base URL | 说明 |
|------|----------|------|
| 生产（推荐） | `https://mooncut.me/api` | 与官网同域，证书与 Cookie 域一致 |
| 生产别名 | `https://www.mooncut.me/api` | 同一 Pages 项目；Cookie 的 `Domain` 未显式写死，请固定用 **一个** host |
| 预览部署 | `https://<hash>.mooncut.pages.dev/api` | 临时，不要写死到 App |
| 本地 Agent（仅本机） | `http://127.0.0.1:<port>` | **浏览器用户不要直连**；生产鉴权在边缘 |

所有下文路径均相对于 Base URL。  
例如：`POST /v1/auth/otp/send` → `https://mooncut.me/api/v1/auth/otp/send`。

### 1.2 架构（必须先理解）

```
┌─────────────────── 客户端（iOS / 鸿蒙 / Web）───────────────────┐
│  统一只访问 https://mooncut.me/api/*                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
              Cloudflare Pages Functions（边缘）
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   登录 / Session        口播助手 / 陪练        剪辑相关路径
   D1 + Cookie           边缘调模型              反代 Tunnel
        │                    │                    │
        ▼                    ▼                    ▼
     Cloudflare D1      OpenCode 等 LLM     本机 mooncut-pi-agent
     Resend 发 OTP                           上传 / 任务 / 成片
```

| 类别 | 处理位置 | 登录要求 | 依赖本机 Agent？ |
|------|----------|----------|------------------|
| 认证（OTP / 密码 / Session） | 边缘 D1 | 见各接口 | 否 |
| 口播助手、摄像陪练 | 边缘 | **需要登录** | 否（可走 Tunnel 中继 LLM） |
| 模型列表、邮件意图、队列摘要 | 边缘（部分为占位） | 否 | 队列真实数据在 Agent，边缘目前可能返回空摘要 |
| 上传素材、创建剪辑任务、任务状态、产物下载 | 边缘 **反代** Agent | **需要登录**（健康检查除外） | **是**（Tunnel + 本机 worker） |

**原则：App 只打 `mooncut.me/api`，不要在 App 里配置 Tunnel URL 或 Agent 密钥。**

### 1.3 通用约定

| 项 | 约定 |
|----|------|
| 协议 | HTTPS only |
| 编码 | UTF-8；JSON 使用 `application/json; charset=utf-8` |
| 时间 | ISO-8601 字符串，如 `2026-07-11T12:00:00.000Z` |
| 缓存 | 鉴权与业务 JSON 响应带 `Cache-Control: no-store` |
| 成功 | 多数 `200`；注册 OTP 成功可能 `201`；创建剪辑任务 Agent 侧常为 `202` |
| 失败 | JSON：`{ "error": "人类可读中文或英文", "code": "MACHINE_CODE" }`（部分 Agent 错误可能无 `code`） |

---

## 2. 鉴权（Session Cookie）— 多端重点

### 2.1 机制说明

生产鉴权是 **服务端 Session + HttpOnly Cookie**，不是 JWT 写在响应 body 里。

| 项 | 值 |
|----|-----|
| Cookie 名 | `mooncut_session` |
| 属性 | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| 默认有效期 | 约 **30 天**（服务端 `SESSION_DAYS`，上限 90） |
| 存储 | Cloudflare D1：`sessions` 表存 **token 的 SHA-256**，明文 token 只在 Cookie 里 |

登录 / 注册成功时，响应头会包含：

```http
Set-Cookie: mooncut_session=<opaque-token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<seconds>
```

后续需登录的接口，客户端必须带上：

```http
Cookie: mooncut_session=<opaque-token>
```

### 2.2 iOS / 鸿蒙实现建议

原生 App **没有浏览器自动 Cookie 管理时**，请自行：

1. 在 `login` / `otp/verify` / `register` 响应中解析 `Set-Cookie`（或系统 Cookie 容器）。
2. 将 `mooncut_session` 存入 **Keychain（iOS）/ 系统凭据（鸿蒙）**，不要明文写日志。
3. 每次请求自动附加 `Cookie: mooncut_session=...`。
4. 收到 `logout` 的 `Set-Cookie`（Max-Age=0）或 `401 AUTH_REQUIRED` 时清除本地 token。
5. App 启动时调用 `GET /v1/auth/session` 恢复会话。

#### iOS（URLSession）要点

```swift
// 1) 使用共享 Cookie 存储，或手动管理
let config = URLSessionConfiguration.default
config.httpCookieAcceptPolicy = .always
config.httpShouldSetCookies = true
// 若跨域自定义 base，需手动从 HTTPCookieStorage 取出 mooncut_session 再拼 Cookie 头

// 2) 请求示例
var req = URLRequest(url: URL(string: "https://mooncut.me/api/v1/auth/session")!)
req.httpMethod = "GET"
req.setValue("application/json", forHTTPHeaderField: "Accept")
// credentials / cookie 由 session 自动带，或：
// req.setValue("mooncut_session=\(token)", forHTTPHeaderField: "Cookie")
```

#### 鸿蒙（@ohos.net.http）要点

```ts
// 登录成功后：从 response.header['set-cookie'] 解析 mooncut_session
// 持久化 preferences / 系统安全存储
// 后续：
httpRequest.request(url, {
  method: http.RequestMethod.POST,
  header: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Cookie': `mooncut_session=${sessionToken}`,
  },
  extraData: JSON.stringify(body),
})
```

### 2.3 当前 **没有** 的鉴权方式

| 方式 | 状态 |
|------|------|
| `Authorization: Bearer <user-jwt>` 用户令牌 | **未对浏览器/App 用户开放** |
| 在 JSON body 里返回 `accessToken` | **无**；token 仅在 `Set-Cookie` |
| OAuth / 微信 / Apple 登录 | **未实现** |
| Agent 内部 `Bearer <AGENT_INTERNAL_KEY>` | 仅边缘 → Agent，**禁止下发到 App** |

> 若未来要给纯 Header 鉴权（无 Cookie 的部分嵌入 WebView 场景），需要边缘增加「签发可读 session token / Bearer」能力；**现状请按 Cookie 实现**。

### 2.4 CORS（仅浏览器第三方站）

边缘对 `OPTIONS` 返回：

- `Access-Control-Allow-Origin: <请求 Origin>`
- `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS`
- `Access-Control-Allow-Headers: Authorization, Content-Type, Accept`

原生 App **不受 CORS 限制**。  
若 Web 嵌入页跨域，必须 `credentials: 'include'` 且服务端 Allow-Origin 不能是 `*`（当前是回显 Origin）。

### 2.5 公共 Header 建议

```http
Accept: application/json
Content-Type: application/json          # 有 JSON body 时
Cookie: mooncut_session=<token>         # 登录后
```

上传二进制时：

```http
Content-Type: application/octet-stream  # 或实际 MIME
# 不要强制 application/json
```

---

## 3. 错误模型与安全策略

### 3.1 统一错误 JSON

```json
{
  "error": "请先登录",
  "code": "AUTH_REQUIRED"
}
```

| HTTP | 常见 code | 含义 |
|------|-----------|------|
| 400 | `INVALID_EMAIL` / `INVALID_PASSWORD` / `INVALID_CODE` / `OTP_REQUIRED` / `OTP_INVALID` / `OTP_EXPIRED` | 参数或验证码问题 |
| 401 | `AUTH_FAILED` / `OTP_MISMATCH` / `AUTH_REQUIRED` | 未登录或凭证错误 |
| 404 | `USER_NOT_FOUND` / `Not found` | 用户不存在或路径不存在 |
| 409 | `EMAIL_TAKEN` | 邮箱已注册 |
| 429 | `OTP_RATE_LIMIT` / `OTP_COOLDOWN` / `OTP_LOCKED` | 频率 / 锁定 |
| 502 | `AGENT_UNREACHABLE` / `ASSISTANT_UPSTREAM_FAILED` | 上游失败 |
| 503 | `EMAIL_SEND_FAILED` / `AGENT_ORIGIN_MISSING` / `ASSISTANT_NOT_CONFIGURED` | 服务未就绪 |
| 500 | `EDGE_ERROR` | 边缘未分类错误 |

**客户端展示：** 优先展示 `error` 字符串；用 `code` 做分支（如 `AUTH_REQUIRED` → 跳转登录）。

### 3.2 邮箱与密码规则

| 字段 | 规则 |
|------|------|
| email | trim + lower-case；需匹配基本邮箱格式；长度 ≤ 254 |
| password | 字符串，长度 **8–128** |
| OTP code | **6 位数字** |

### 3.3 OTP 安全参数（边缘硬编码）

| 参数 | 值 |
|------|-----|
| 有效期 | 10 分钟 |
| 重发冷却 | 60 秒 |
| 每邮箱每用途每小时最多发送 | 8 次 |
| 错误尝试上限 | 5 次（超出需重新获取） |
| 用途 `purpose` | 仅 `login` \| `register` |

发送成功后，同邮箱同用途的旧码会被作废（只认最新一封）。

---

## 4. 认证 API（边缘 · 完整）

### 4.1 推荐流程（App）

#### A. 注册（邮箱验证码 + 密码）

```
1) POST /v1/auth/otp/send     { "email", "purpose": "register" }
2) 用户收邮件，输入 6 位码 + 设置密码
3) POST /v1/auth/otp/verify   { "email", "password", "code", "purpose": "register" }
4) 保存 Set-Cookie → mooncut_session
```

#### B. 登录（验证码，推荐）

```
1) POST /v1/auth/otp/send     { "email", "purpose": "login" }
2) POST /v1/auth/otp/verify   { "email", "code", "purpose": "login" }
3) 保存 Session
```

#### C. 登录（密码，兼容）

```
POST /v1/auth/login   { "email", "password" }
```

#### D. 会话恢复 / 退出

```
GET  /v1/auth/session   → { "user": User | null }
POST /v1/auth/logout    → 清 Cookie
```

---

### 4.2 `POST /v1/auth/otp/send`

发送邮箱验证码。

**鉴权：** 不需要  
**Body：**

```json
{
  "email": "user@example.com",
  "purpose": "register"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱 |
| purpose | `"register"` \| `"login"` | 是 | 注册 / 登录 |

**成功 `200`：**

```json
{
  "ok": true,
  "email": "user@example.com",
  "purpose": "register",
  "expiresInSec": 600,
  "resendAfterSec": 60
}
```

**失败示例：**

| code | 场景 |
|------|------|
| `EMAIL_TAKEN` | purpose=register 但邮箱已注册 |
| `USER_NOT_FOUND` | purpose=login 但邮箱未注册 |
| `OTP_COOLDOWN` | 60s 内重复发送 |
| `OTP_RATE_LIMIT` | 一小时发送过多 |
| `EMAIL_SEND_FAILED` | 邮件通道失败（503） |

**App 注意：** 不要在 UI 假设「未注册也可发 login 码」——边缘会 `404 USER_NOT_FOUND`。

---

### 4.3 `POST /v1/auth/otp/verify`

校验验证码并建立会话。

**鉴权：** 不需要  
**Body（注册）：**

```json
{
  "email": "user@example.com",
  "password": "your-password-8+",
  "code": "123456",
  "purpose": "register"
}
```

**Body（登录）：**

```json
{
  "email": "user@example.com",
  "code": "123456",
  "purpose": "login"
}
```

| purpose | password | 成功状态码 |
|---------|----------|------------|
| `register` | **必填** | `201` |
| `login`（默认） | 不需要 | `200` |

**成功响应 body：**

```json
{
  "user": {
    "id": "a1b2c3d4e5f67890",
    "email": "user@example.com",
    "createdAt": "2026-07-11T10:00:00.000Z"
  }
}
```

**响应头：** `Set-Cookie: mooncut_session=...`

**User 对象字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 用户 ID（hex 风格随机串） |
| email | string | 规范化后的邮箱 |
| createdAt | string | ISO 时间 |

---

### 4.4 `POST /v1/auth/register`

兼容入口。  
- 若 body 含 `code`：等价于 OTP 注册（同 `registerWithOtp`）。  
- 若无 `code`：返回 `400 OTP_REQUIRED`（**禁止无验证码注册**）。

---

### 4.5 `POST /v1/auth/login`

**Body：**

```json
{
  "email": "user@example.com",
  "password": "your-password-8+"
}
```

也可：`{ "email", "code" }`（无 password）→ 走 OTP 登录。

**成功 `200`：** `{ "user": User }` + `Set-Cookie`  
**失败：** `401 AUTH_FAILED`（邮箱或密码不正确，不区分哪一项）

---

### 4.6 `POST /v1/auth/logout`

**鉴权：** 可选（有 Cookie 则删会话）  
**成功 `200`：**

```json
{ "ok": true }
```

**响应头：** 清除 `mooncut_session` 的 `Set-Cookie`。

---

### 4.7 `GET /v1/auth/session`

探测当前会话（**未登录也是 200**）。

**成功 `200`：**

```json
{ "user": null }
```

或：

```json
{
  "user": {
    "id": "...",
    "email": "...",
    "createdAt": "..."
  }
}
```

**用途：** App 冷启动恢复；Web 首屏 loading。  
支持 `HEAD`（仅状态，无 body）。

---

### 4.8 `GET /v1/auth/me`

与 session 类似，但 **未登录返回 401**。

```json
{ "error": "请先登录", "code": "AUTH_REQUIRED" }
```

---

## 5. 边缘业务 API

### 5.1 `GET /v1/models`

**鉴权：** 不需要  
**用途：** 探测助手路由 / 是否「像在线」。

**示例响应：**

```json
{
  "available": ["glm-5.2", "deepseek-v4-flash"],
  "routing": {
    "planner": "local-video-agent",
    "script": "glm-5.2",
    "coach": "deepseek-v4-flash",
    "vision": [],
    "image": { "configured": false, "model": null, "maxImages": 0 }
  },
  "relayConfigured": true,
  "note": "..."
}
```

Web 用它判断「Agent 已连接」是历史命名；边缘该接口主要反映 **助手配置**，不保证 Tunnel 视频节点在线。视频节点请用 `GET /v1/agent/health`（需可走反代，见 §6）。

---

### 5.2 `POST /v1/assistant/script` 🔒

口播助手：聊想法 / 生成稿 / 润色。

**鉴权：** 需要登录  
**Body：**

```json
{
  "action": "guide",
  "style": "oral",
  "messages": [
    { "role": "user", "content": "我想讲时间管理" }
  ],
  "draft": ""
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | `"guide"` \| `"generate"` \| `"polish"` | 否 | 默认 `guide` |
| style | `"oral"` \| `"short"` \| `"emotional"` | 否 | 默认 `oral` |
| messages | array | 建议 | 最多保留最近 **12** 条；role 仅 `user`/`assistant`；单条 content 截断约 4000 字 |
| draft | string | 否 | 当前稿；polish/generate 时有用；服务端最多约 12k 字参与提示 |

**成功 `200`：**

```json
{
  "reply": "助手的自然语言回复",
  "phase": "discover",
  "ready": false,
  "draft": "",
  "petMessage": "给宠物气泡的短文案",
  "suggestions": [
    { "eyebrow": "角度", "title": "标题", "detail": "说明" },
    { "eyebrow": "...", "title": "...", "detail": "..." },
    { "eyebrow": "...", "title": "...", "detail": "..." }
  ],
  "model": "glm-5.2",
  "content": ""
}
```

| 字段 | 说明 |
|------|------|
| phase | `discover` \| `outline` \| `draft` |
| ready | 是否可进入录制等下一步 |
| draft | 口播正文；guide 阶段可为空 |
| suggestions | 目标 **3** 条；客户端应做空数组兜底 |
| content | `draft \|\| reply` 的兼容别名 |

**错误：** `401 AUTH_REQUIRED` · `503 ASSISTANT_NOT_CONFIGURED` · `502 ASSISTANT_EMPTY_DRAFT` / `ASSISTANT_UPSTREAM_FAILED`

**App 交互建议：**

1. `guide` 多轮对话，展示 `reply` + 三张 `suggestions`。  
2. 信息够时 `action=generate` 取 `draft`。  
3. 用户改稿后 `action=polish` + 当前 `draft`。  
4. 超时建议 ≥ 60–90s（推理模型可能较慢）。

---

### 5.3 `POST /v1/assistant/coach` 🔒

提词录制时的实时陪练建议。

**鉴权：** 需要登录  
**Body：**

```json
{
  "transcript": "用户最近识别到的口播文本",
  "currentScript": "完整提词稿",
  "currentSentence": "当前句",
  "lastAdvice": "上一条建议，可空",
  "metrics": {
    "pace": 140,
    "wordCount": 32,
    "volume": 0.6,
    "pauseCount": 2,
    "eyeContact": 0.7,
    "elapsedSeconds": 18
  }
}
```

**成功 `200`：**

```json
{
  "category": "pace",
  "advice": "稍慢一点，把关键字咬清楚",
  "petMessage": "讲得很稳！",
  "positive": true,
  "model": "deepseek-v4-flash"
}
```

| category | 含义（客户端可用图标映射） |
|----------|----------------------------|
| `pace` | 语速 |
| `volume` | 音量 |
| `pause` | 停顿 |
| `script` | 稿件 / 走词 |
| `camera` | 镜头 / 出画 |
| `steady` | 整体平稳 |

`advice` / `petMessage` 服务端会截断偏短，适合 HUD。

**调用频率建议：** 客户端节流（如每 8–15s 或句子变化时），避免打满模型。

---

### 5.4 `GET /v1/mail/status`

**鉴权：** 不需要  
**边缘当前固定意图响应（成片邮件由本机 Agent 发送）：**

```json
{
  "authorized": true,
  "aliases": [],
  "transport": "local-agent",
  "automatic": true,
  "requiresConfirmation": false,
  "note": "成片由本机剪辑节点自动发往任务里的 notificationEmail"
}
```

---

### 5.5 `GET /v1/render-queue`

**鉴权：** 不需要（边缘）  
**注意：** 边缘当前可能返回 **空队列占位**；真实队列数据在本机 Agent。多端若要做全局队列，需后续把该路径改为反代 Agent（或单独接口）。现状请以 **单任务轮询** `GET /v1/edit-jobs/:id` 为准。

---

### 5.6 社区能力包：`/v1/community/packages`

社区目录、上传和下载均由 Pages + D1 提供，不依赖本机 Agent：

- `GET /v1/community/packages`：公开列出最新版能力包。
- `POST /v1/community/packages`：登录用户以 multipart 上传 `manifest.json`、`SKILL.md` 和 `connector.json`。
- `GET /v1/community/packages/{slug}/{version}/{manifest.json|SKILL.md|connector.json|package.mooncut-capability.json}`：公开下载。
- `POST /v1/community/packages/{slug}/connect`：需登录；Pages 把校验过的声明转给该用户的本机 Agent 完成安装。

Connector 只能引用 Agent 已内置、已审核的 adapter，下载内容绝不作为代码执行。Agent 未连接时，前三类社区操作仍可用，只有 `connect` 返回 Agent 不可达。

---

### 5.7 账户套餐与额度：`/v1/billing/*` 🔒

套餐、额度和升级请求均在 Pages + D1 中结算，不依赖本机 Agent；但「智能成片」任务会在创建时预留额度、在任务完成轮询时按真实结果入账。

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/v1/billing/summary` | 当前套餐、周期、视频次数、处理分钟、创作点、升级提醒与最近升级请求 |
| POST | `/v1/billing/checkout` | 创建或复用 Creator / Pro 的安全结算请求，body：`{ "plan": "creator" | "pro" }` |

`GET /v1/billing/summary` 关键字段：

```json
{
  "account": {
    "plan": "free",
    "subscriptionStatus": "free",
    "periodEndsAt": null,
    "exportQuality": "720P",
    "maxParallelJobs": 1
  },
  "usage": {
    "videoGenerations": { "used": 1, "inProgress": 0, "limit": 3, "remaining": 2 },
    "smartMinutes": { "used": 0, "limit": null, "remaining": null },
    "creativePoints": { "used": 4, "inProgress": 0, "limit": 12, "remaining": 8 }
  },
  "upgradePrompt": { "level": "warning", "recommendedPlan": "creator", "title": "…", "detail": "…" }
}
```

计费规则：

- Free：3 条体验成片、12 个一次性创作点、单条素材最多 5 分钟、720P、1 个并行任务。
- Creator：¥39/月、60 分钟智能处理、80 创作点、1080P、2 个并行任务。
- Pro：¥149/月、300 分钟智能处理、400 创作点、4K、3 个并行任务。
- 创建剪辑任务会预留 1 条视频、预计处理分钟，以及（未关闭 AI 视觉时）最多 8 个创作点；Agent 不可达或任务失败时自动释放。完成后按任务 probe 时长（分钟向上取整）、实际生成的视觉张数和 1 条成片写入流水。
- 脚本 `generate` / `polish` 与一次字幕定点修复各扣 1 个创作点；`guide` 不扣点。

额度不足返回 `402`，客户端应展示服务端 `error`，并引导到套餐页或账户中心；不要在客户端自行递减或授予额度。

> 支付收银台及 `POST /v1/billing/provider/webhook` 仅供支付服务的服务器对接，**客户端绝不能调用**。其签名配置见 [DEPLOY.md](../DEPLOY.md)。

---

## 6. 剪辑 / 上传 API（边缘反代 → 本机 Agent）🔒

以下路径经边缘校验登录后，转发到 Tunnel 后的 `mooncut-pi-agent`。  
边缘会附加内部 Header（App **不要**伪造）：

- `Authorization: Bearer <AGENT_INTERNAL_KEY>`（边缘注入）
- `X-MoonCut-User-Id` / `X-MoonCut-User-Email`（来自 Session）

若 Tunnel 或本机 Agent 宕机：

```json
{ "error": "渲染节点不可达，请确认本机 Agent 与 Tunnel 已启动", "code": "AGENT_UNREACHABLE" }
```

### 6.1 健康检查

| 方法 | 路径 | 登录 |
|------|------|------|
| GET | `/v1/agent/health` | 否（边缘会改写为 Agent `/healthz`） |
| GET | `/healthz` | 否 |

用于判断「剪辑能力是否在线」。

---

### 6.2 `POST /v1/assets` 🔒

上传原始视频素材。

```http
POST /api/v1/assets?filename=koubo.mp4
Content-Type: video/mp4
Cookie: mooncut_session=...
<body raw bytes>
```

| Query | 说明 |
|-------|------|
| filename | 原始文件名，建议 URL 编码 |

**成功示例：**

```json
{
  "assetId": "…",
  "filename": "koubo.mp4",
  "bytes": 12345678
}
```

**限制：** 受本机 Agent 与网络影响；大文件请用后台上传 + 进度条；失败重试需幂等策略（新文件新 asset）。

---

### 6.3 `POST /v1/edit-jobs` 🔒

基于已上传 asset 创建剪辑任务。

**Body：**

```json
{
  "assetId": "<from upload>",
  "title": "可选标题",
  "prompt": "可选剪辑说明",
  "notificationEmail": "user@example.com",
  "imageGeneration": "auto"
}
```

| 字段 | 说明 |
|------|------|
| assetId | 与 `inputPath` 二选一；生产请用 assetId |
| notificationEmail | 成片通知邮箱；**若省略，边缘会注入当前登录用户邮箱** |
| imageGeneration | `"auto"` \| `"off"` |
| capabilityInstallIds / capabilityRequests | 能力扩展；需登录用户；一期可省略 |

**成功（通常 `202`）：**

```json
{
  "id": "<jobId>",
  "status": "queued",
  "statusUrl": "https://…/v1/edit-jobs/<jobId>"
}
```

**App 轮询：** `GET /v1/edit-jobs/{id}`，建议 1–2s 起步、指数退避，上限 5s。

---

### 6.4 `POST /v1/edits` 🔒

一步：上传 body + query 参数创建任务（较少用于 App，Web 历史路径）。

```
POST /v1/edits?filename=a.mp4&title=...&prompt=...&notificationEmail=...&imageGeneration=auto
Content-Type: video/*
<body>
```

---

### 6.5 `GET /v1/edit-jobs/{jobId}` 🔒

任务详情。核心字段与前端 `EditJob` 对齐：

```json
{
  "id": "...",
  "originalName": "koubo.mp4",
  "status": "running",
  "stage": "cutting",
  "progress": 0.42,
  "error": null,
  "mail": {
    "recipient": "user@example.com",
    "status": "scheduled",
    "updatedAt": "..."
  },
  "result": {
    "summary": "...",
    "artifacts": {
      "video": "/path-or-key",
      "subtitles": "..."
    },
    "probe": {
      "durationMs": 83000,
      "width": 1920,
      "height": 1080,
      "hasAudio": true
    }
  }
}
```

| status | 含义 |
|--------|------|
| `queued` | 排队 |
| `running` | 处理中 |
| `completed` | 成功，可读 artifacts |
| `failed` | 失败，读 `error` |

**权限：** 仅任务所有者（边缘注入的 user id）可访问；否则 Agent 侧表现为 404。

---

### 6.6 `GET /v1/edit-jobs/{jobId}/artifacts/{name}` 🔒

下载产物流。  
Web 拼 URL：

```
https://mooncut.me/api/v1/edit-jobs/{jobId}/artifacts/video
```

| name 示例 | 说明 |
|-----------|------|
| `video` | 成片（主产物） |
| 其他 | 以 `result.artifacts` 的 key 为准 |

请求需带 Cookie。响应为二进制流（`video/mp4` 等），可用 `AVPlayer` / 鸿蒙 `AVPlayer` 边下边播或落盘。

---

### 6.7 字幕返修 / 邮件确认（进阶）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/edit-jobs/{id}/subtitle-repairs` | body: `{ instruction, atMs?, replacementText? }`；父任务须 `completed` |
| GET | `/v1/edit-jobs/{id}/subtitle-repairs` | 返修列表 |
| POST | `/v1/edit-jobs/{id}/cancel` | 取消 |
| POST | `/v1/edit-jobs/{id}/mail/prepare` | 准备发信（若流程需确认） |
| POST | `/v1/edit-jobs/{id}/mail/{pendingId}/confirm` | 确认发信 |

一期 App 可只做：上传 → 建任务 → 轮询 → 播/下载 `artifacts/video`。

---

## 7. 端到端示例

### 7.1 cURL：OTP 登录 + 拉会话

```bash
BASE=https://mooncut.me/api
JAR=$(mktemp)

# 1) 发码（邮箱须已注册）
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/v1/auth/otp/send" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","purpose":"login"}'

# 2) 验码（替换 CODE）
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/v1/auth/otp/verify" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","code":"CODE","purpose":"login"}'

# 3) 会话
curl -sS -c "$JAR" -b "$JAR" "$BASE/v1/auth/session"

# 4) 口播助手
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/v1/assistant/script" \
  -H 'Content-Type: application/json' \
  -d '{"action":"guide","style":"oral","messages":[{"role":"user","content":"讲怎么早起"}]}'
```

### 7.2 cURL：上传并剪辑

```bash
# 上传
curl -sS -c "$JAR" -b "$JAR" -X POST \
  "$BASE/v1/assets?filename=demo.mp4" \
  -H 'Content-Type: video/mp4' \
  --data-binary @./demo.mp4

# 创建任务（assetId 来自上一响应）
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/v1/edit-jobs" \
  -H 'Content-Type: application/json' \
  -d '{"assetId":"ASSET_ID","title":"demo","imageGeneration":"off"}'

# 轮询
curl -sS -c "$JAR" -b "$JAR" "$BASE/v1/edit-jobs/JOB_ID"

# 下载成片
curl -sS -c "$JAR" -b "$JAR" -L \
  -o out.mp4 \
  "$BASE/v1/edit-jobs/JOB_ID/artifacts/video"
```

### 7.3 伪代码：Swift 登录状态机

```text
enum AuthState { loggedOut, awaitingOtp(email), session(User) }

func sendOtp(email, purpose) -> expiresInSec, resendAfterSec
func verifyOtp(email, code, password?) -> User  // persist cookie
func restoreSession() -> User?
func logout()

// 任何 401 + code AUTH_REQUIRED → clear session → AuthState.loggedOut
```

---

## 8. 接口清单速查

### 8.1 边缘实现（稳定，优先对接）

| 方法 | 路径 | 登录 | 说明 |
|------|------|------|------|
| POST | `/v1/auth/otp/send` | 否 | 发验证码 |
| POST | `/v1/auth/otp/verify` | 否 | 验码登录/注册 |
| POST | `/v1/auth/register` | 否 | 需带 code |
| POST | `/v1/auth/login` | 否 | 密码或 code |
| POST | `/v1/auth/logout` | 可选 | 退出 |
| GET | `/v1/auth/session` | 否 | 会话探测 |
| GET | `/v1/auth/me` | 是 | 当前用户 |
| GET | `/v1/models` | 否 | 模型路由信息 |
| POST | `/v1/assistant/script` | **是** | 口播助手 |
| POST | `/v1/assistant/coach` | **是** | 录制陪练 |
| GET | `/v1/mail/status` | 否 | 邮件意图 |
| GET | `/v1/billing/summary` | **是** | 套餐、额度、升级提醒与支付请求 |
| POST | `/v1/billing/checkout` | **是** | 创建/复用 Creator 或 Pro 结算请求 |
| GET | `/v1/render-queue` | 否 | 边缘可能为空摘要 |
| GET | `/v1/capabilities` | 否 | 边缘可能为空 |
| GET | `/v1/me/capability-installations` | 否* | 边缘空列表 |
| GET | `/v1/community/*` | 否 | 边缘空列表 |

\* 安装/调用能力的 POST/PATCH 在边缘多数 **未反代**，会 404 `EDGE_ONLY`。

### 8.2 反代到 Agent（登录后；依赖 Tunnel）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/agent/health` · `/healthz` | 节点健康 |
| POST | `/v1/assets` | 上传素材 |
| POST | `/v1/edit-jobs` | 创建任务 |
| POST | `/v1/edits` | 一步上传创建 |
| GET | `/v1/edit-jobs/:id` | 任务状态 |
| GET | `/v1/edit-jobs/:id/artifacts/:name` | 产物 |
| POST | `/v1/edit-jobs/:id/cancel` | 取消 |
| POST/GET | `/v1/edit-jobs/:id/subtitle-repairs` | 字幕返修 |
| POST | `/v1/edit-jobs/:id/mail/*` | 邮件确认流 |
| POST | `/v1/edge-relay/chat/completions` | **内部 LLM 中继，App 勿用** |

---

## 9. 多端接入检查清单

### 9.1 一期（登录 + 口播助手）

- [ ] Base URL 固定 `https://mooncut.me/api`
- [ ] Cookie `mooncut_session` 安全存储 + 自动附加
- [ ] 注册 / 登录 OTP 流程 + 冷却 UI（60s）
- [ ] `GET /v1/auth/session` 冷启动
- [ ] `POST /v1/assistant/script` 三态：guide / generate / polish
- [ ] 统一处理 `code` + `error`；`AUTH_REQUIRED` 回登录
- [ ] 助手请求超时 ≥ 60s；失败可重试

### 9.2 二期（录制陪练）

- [ ] 本地 ASR / 音量 / 语速 metrics
- [ ] 节流调用 `POST /v1/assistant/coach`
- [ ] 用 `category` + `positive` 驱动 UI

### 9.3 三期（剪辑）

- [ ] 先 `GET /v1/agent/health` 判断是否可剪
- [ ] 分片/后台上传 `POST /v1/assets`
- [ ] `POST /v1/edit-jobs` + 轮询
- [ ] 带 Cookie 下载 `artifacts/video`
- [ ] 处理 `AGENT_UNREACHABLE` / `503` 友好文案

### 9.4 安全

- [ ] 禁止打包任何 LLM / Agent API Key
- [ ] 不在日志打印完整 Cookie / OTP
- [ ] ATS / 明文 HTTP 仅调试本机，生产强制 HTTPS
- [ ] 证书锁定可选（默认系统信任链即可）

---

## 10. 与 Web 前端对照

| 能力 | Web 实现 | 多端应对 |
|------|----------|----------|
| 请求封装 | `src/services/api.ts` · `credentials: 'include'` | 等价：Cookie 存储 + 每次带上 |
| 页面鉴权门槛 | `src/lib/navigation.ts` · `requiresAuth` | App 路由守卫 |
| 类型 | `src/types.ts` | 建议生成 Swift/Kotlin/ArkTS 模型 |
| 边缘路由 | `functions/api/[[path]].ts` | 本文 §4–§6 |
| 会话实现 | `functions/lib/auth.ts` | Cookie 名与 OTP 规则以该文件为准 |

---

## 11. 已知边界（对接前对齐产品）

1. **用户身份载体只有 Cookie**，没有移动端友好的 Bearer access token 响应字段。  
2. **剪辑强依赖本机 Agent + Tunnel**；边缘登录正常 ≠ 一定能剪视频。  
3. **全局渲染队列 / 社区 / 能力商店** 在边缘多为占位；完整能力需后续打开反代或独立 BFF。  
4. **CORS** 主要为浏览器；原生 App 无此问题。  
5. **www 与 apex** 请二选一作为 Cookie 宿主，避免双 host 会话分裂。  
6. OTP 邮件依赖 Resend 等配置；发送失败返回 `503 EMAIL_SEND_FAILED`。

---

## 12. 变更与联系

- 实现源码：`mooncut-web/functions/`  
- 前端调用样例：`mooncut-web/src/services/api.ts`  
- 生产验收：`curl -sS https://mooncut.me/api/v1/auth/session` 应返回 JSON `{ "user": null }` 或用户对象，而非 HTML。

若 iOS / 鸿蒙需要 **Bearer Token 版鉴权** 或 **OpenAPI 3.1 机器可读规格**，可在此文档基础上开技术线程加签发接口与 `openapi.yaml`。

---

*本文档描述的是「客户端应如何调用生产 API」；内部 Agent 密钥、Tunnel URL、模型 Key 一律不进入客户端二进制。*
