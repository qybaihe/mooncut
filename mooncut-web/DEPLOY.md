# MoonCut Web · Cloudflare Pages 部署指南

## 架构总览

```
用户浏览器 ──HTTPS──> Cloudflare Pages (全球边缘 CDN)
  ├─ 静态资源 (/, /assets/*, /定价…)  → Pages CDN 缓存（快）
  └─ /api/* → Pages Function → Cloudflare Tunnel → 你电脑:4317 (Agent)
```

- **平时**：只服务静态资源，全球 CDN 缓存，不碰你电脑。
- **Agent 运行时**：录制/成片/任务请求经 `/api/*` 反代到你电脑。
- **Agent 不在线**：`/api/*` 返回 502，静态页（定价/社区/落地）照常可用。

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
   | `VITE_MOONCUT_COMMUNITY_REGISTRY_URL` | `https://mc.classby.cn` | 社区注册表地址 |
5. 保存，Cloudflare 自动构建部署。每次 push 自动更新。

### 方式 B：CLI 直推

```bash
cd mooncut-web
npm run build
npx wrangler pages deploy dist --project-name mooncut-web --branch main
```

环境变量在 Dashboard → 项目 → Settings → Environment variables 里设。

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
   - 前端 Pages 照常访问（定价/社区/落地页）。
   - 需要登录或任务的请求返回 502，前端显示"Agent 不可达"。

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
