# MoonCut Web · Cloudflare Pages 部署指南

## 架构总览

```
用户浏览器 ──HTTPS──> Cloudflare Pages (全球边缘 CDN)
  ├─ 静态资源 (/, /assets/*, /定价…)  → Pages CDN 缓存（快）
  ├─ /api/v1/auth/* + /api/v1/community/packages/* + /api/v1/billing/* → Pages Function → D1
  └─ 剪辑任务 + 社区“连接 Agent” → Pages Function → Cloudflare Tunnel → 你电脑:4317
```

- **平时**：静态资源、登录和社区能力包（浏览、上传、下载）都在 Cloudflare，不碰你电脑。
- **Agent 运行时**：录制/成片/任务请求和社区“连接到 Agent”才经 Tunnel 到你电脑。
- **Agent 不在线**：社区仍可用，只有剪辑与连接操作会提示 Agent 不可达。

## 第一步：部署前端到 Cloudflare Pages

### 方式 A：Git 集成（推荐，自动部署）

1. 把代码推到 GitHub。
2. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**。
3. 选仓库，填：
   - **构建命令**：`npm run build`
   - **输出目录**：`dist`
   - **根目录**：`mooncut-web`（如果连的是 monorepo 根）
4. **环境变量**（Production 和 Preview 都加）：
   | 变量名 | 值 | 说明 |
   |---|---|---|
   | `AGENT_ORIGIN` | `https://agent.你的域名` | Pages Function 反代目标（Tunnel 公网地址） |
5. 保存，Cloudflare 自动构建部署。每次 push 自动更新。

### 方式 B：CLI 直推

```bash
cd mooncut-web
npm run build
npx wrangler pages deploy dist --project-name mooncut-web --branch main
```

环境变量在 Dashboard → 项目 → Settings → Environment variables 里设。

### 部署社区数据表

社区能力包现在由 **Pages Functions + 同一个 D1 数据库** 托管，不再读取 EdgeOne 或其他外部目录。首次部署此版本前，执行：

```bash
cd mooncut-web
npx wrangler d1 migrations apply mooncut --remote
```

这会创建 `community_packages` 与 `community_releases`。能力包只允许上传小型声明文件（`manifest.json`、`SKILL.md`、`connector.json`）；Pages 校验后存入 D1，可公开下载，无需开通 R2。

### 部署账户额度与支付回调

同一条 D1 迁移还会创建套餐账户、生成任务额度预留、用量流水和升级请求表。浏览器只能发起升级请求，**不能自行开通 Creator / Pro**。

在 Pages Production（也建议 Preview）配置以下机密变量：

| 变量 | 用途 |
|---|---|
| `BILLING_CHECKOUT_URL` | 你的 HTTPS 托管收银台入口。MoonCut 会追加 `checkoutRequestId`、`plan`、`customer` 与签名令牌。未配置时，账户页只记录“等待支付通道配置”的升级请求，不扣款、不授予权益。 |
| `BILLING_CHECKOUT_SIGNING_SECRET` | 与收银台后端共享的长随机 HMAC 密钥。收银台必须验证 `checkoutToken = HMAC-SHA256(checkoutRequestId + '.' + plan + '.' + customer)`，不能信任浏览器自行改写的价格或套餐参数。 |
| `BILLING_WEBHOOK_SECRET` | 支付服务回调专用的长随机 Bearer 密钥；绝不能放在前端或仓库。 |

例如：

```bash
npx wrangler pages secret put BILLING_CHECKOUT_URL --project-name mooncut
npx wrangler pages secret put BILLING_CHECKOUT_SIGNING_SECRET --project-name mooncut
npx wrangler pages secret put BILLING_WEBHOOK_SECRET --project-name mooncut
```

支付服务在确认到账后，需要由它的**服务器**请求：

```http
POST https://mooncut.me/api/v1/billing/provider/webhook
Authorization: Bearer <BILLING_WEBHOOK_SECRET>
Content-Type: application/json

{
  "checkoutRequestId": "MoonCut 创建升级请求时返回的 id",
  "providerReference": "支付平台不可重复的订单号",
  "periodEndsAt": "2026-08-11T00:00:00.000Z"
}
```

回调只接受处于 `ready_for_payment` 的升级请求；成功后才会把账户更新为 `active` 的 Creator / Pro，并记录平台订单号。相同订单号的重试是幂等的。不要把这个接口交给浏览器调用。

## 第二步：在你电脑上装 Cloudflare Tunnel

### 2.1 安装 cloudflared

```bash
# macOS
brew install cloudflared

# 验证
cloudflared --version
```

### 2.2 登录并创建隧道

```bash
cloudflared tunnel login          # 浏览器里选你的域名授权
cloudflared tunnel create mooncut-agent
# 输出会给你一个 tunnel-id，记下来
```

### 2.3 配置隧道

创建 `~/.cloudflared/config.yml`：

```yaml
tunnel: <你的-tunnel-id>
credentials-file: /Users/<你的用户名>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: agent.mooncut.your-domain
    service: http://localhost:4317
  - service: http_status:404
```

### 2.4 绑定 DNS

```bash
cloudflared tunnel route dns mooncut-agent agent.mooncut.your-domain
```

### 2.5 启动隧道（每次用 Agent 时）

```bash
cloudflared tunnel run mooncut-agent
```

启动后，`https://agent.mooncut.your-domain` 就会转发到你电脑的 `localhost:4317`。

## 第三步：在 Cloudflare Pages 设反代目标

回到 Pages 项目 → Settings → Environment variables，设：

```
AGENT_ORIGIN = https://agent.mooncut.your-domain
```

这样 Pages Function `functions/api/[[path]].ts` 会把所有 `/api/*` 请求转发到 `https://agent.mooncut.your-domain`（经 Tunnel 到你电脑）。

## 第四步：Agent 环境变量（你电脑上）

Agent 启动时需要设：

```bash
# HTTPS 下 cookie 必须 Secure
export MOONCUT_COOKIE_SECURE=true

# 同域反代，不需要 CORS（如果你也想直连，再加 MOONCUT_CORS_ORIGINS）
# export MOONCUT_CORS_ORIGINS=https://mooncut.pages.dev

# 启动 Agent
cd mooncut-pi-agent
npm start
```

## 日常使用流程

1. **你想用创作功能时**：
   ```bash
   # 终端 1：启动 Tunnel
   cloudflared tunnel run mooncut-agent
   # 终端 2：启动 Agent
   cd mooncut-pi-agent && npm start
   ```
   然后打开 Pages 域名，录制/成片请求会路由到你电脑。

2. **你电脑关机/Agent 没跑时**：
   - 前端 Pages、登录、社区浏览、能力包上传与下载照常可用。
   - 剪辑任务及社区“连接到 Agent”会提示本机 Agent 尚未连接。

## 本地开发（不走 Pages）

```bash
cd mooncut-web
npm run dev    # 自动读 .env.development，直连 http://127.0.0.1:4317
```

本地开发不经过 Pages Function，直接连本地 Agent。

## 文件说明

| 文件 | 作用 |
|---|---|
| `functions/api/[[path]].ts` | Pages Function：`/api/*` 同域反代到 Agent |
| `public/_redirects` | SPA fallback：`/* → /index.html 200` |
| `public/_headers` | 缓存策略 + 安全头 |
| `wrangler.toml` | Pages 项目配置 |
| `.env.development` | 本地 dev 直连 Agent |
| `.env.example` | 环境变量说明 |
| `.github/workflows/web-deploy.yml` | CI 自动部署到 Pages |
