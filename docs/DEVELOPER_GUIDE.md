# MoonCut 开发者指南

MoonCut 是一个由 Web、iOS、桌面 Studio、受控剪辑 Agent、字幕服务、人物跟踪和 Remotion 渲染器组成的 monorepo。开发时不必一次启动全部模块：先选择要修改的产品面，再按对应模块的最小命令启动。

> 想先体验产品，请访问 [mooncut.me](https://mooncut.me)。想修改或部署产品，请从本指南开始。

## 1. 开始前

### 基础环境

| 用途 | 需要的环境 |
| --- | --- |
| Web、Agent、Remotion | Node.js（Web 推荐 20+；Studio 要求 Node.js 22.19+） |
| 桌面 Studio | Node.js 22.19+；macOS、Windows 10+ 或常见 Linux |
| 字幕服务、人物跟踪 | Python 3.12+、[uv](https://docs.astral.sh/uv/)、FFmpeg |
| iOS | macOS、Xcode 16+、iOS 17+ SDK、XcodeGen |
| 仓库媒体 | Git LFS |

克隆后先取得 LFS 媒体；不要用普通 Git 复制替代它：

```bash
git lfs install
git lfs pull
```

所有密钥都应放在被忽略的 `.env`、系统密钥链或部署平台 Secrets 中。不要把 API Key、Cookie、私有 CA、`.p12`、`mobileprovision`、`keychain` 或可用 Tunnel URL 写进提交。

## 2. 选择一个开发入口

| 你要改什么 | 目录 | 最快启动 | 深入文档 |
| --- | --- | --- | --- |
| 官网、落地页、浏览器创作台 | [`mooncut-web/`](../mooncut-web/) | `npm install && npm run dev` | [Web README](../mooncut-web/README.md)、[部署说明](../mooncut-web/DEPLOY.md) |
| 本机专业工作台 | [`mooncut-studio/`](../mooncut-studio/) | `npm install && npm run build && npm run dev` | [Studio README](../mooncut-studio/README.md) |
| 受控剪辑 API 与任务队列 | [`mooncut-pi-agent/`](../mooncut-pi-agent/) | `npm install && npm run serve` | [Agent README](../mooncut-pi-agent/README.md)、[API](../mooncut-pi-agent/API.md) |
| 混合字幕服务 | [`hybrid-subtitle-service/`](../hybrid-subtitle-service/) | `uv sync --extra dev` | [字幕服务 README](../hybrid-subtitle-service/README.md) |
| 人物跟踪 / 重构 | [`face-tracker/`](../face-tracker/) | `uv sync --frozen --python 3.12` | [Face Tracker README](../face-tracker/README.md) |
| 成片构图与渲染 | [`remotion-studio/`](../remotion-studio/) | `npm install && npm run studio` | [Remotion README](../remotion-studio/README.md) |
| iPhone 客户端 | [`ios/`](../ios/) | `xcodegen generate && open MoonCut.xcodeproj` | [iOS README](../ios/README.md) |

<a id="local-workflows"></a>

## 3. 常用本地工作流

### 只改 Web 界面

```bash
cd mooncut-web
npm install
npm run dev
```

默认前端读取 `VITE_MOONCUT_API_BASE_URL`。本机联调 Agent 时，在不提交的 `.env.development` 中设置：

```bash
VITE_MOONCUT_API_BASE_URL=http://127.0.0.1:4317
```

仅做页面、录制间或交互改动时，无需伪造后端成功响应；没有服务时应展示真实的未配置或不可达状态。

### Web + 本地 Agent 联调

终端一：启动 Agent。真实模型、字幕或渲染依赖均须在 `mooncut-pi-agent/.env` 中由开发者自行配置；仓库只提供 `.env.example`。

```bash
cd mooncut-pi-agent
npm install
npm run serve
```

终端二：启动 Web，并按上一节把 Web 指向 `127.0.0.1:4317`。

完整剪辑会调用字幕、人脸跟踪、Remotion 与质量检查。若只验证界面，请明确使用本地演示路径；若验证真实成片，请检查任务状态与最终产物，不以模拟进度代替服务结果。

### 本机 Studio 开发

```bash
cd mooncut-studio
npm install
npm run build
npm run dev
```

Studio 默认 local-first。开发初期可选择 Mock；启用真实 Agent 前，请在设置中显式配置 Provider 或运行时依赖。详细的项目格式、IPC 安全边界和打包路径见 [Studio README](../mooncut-studio/README.md)。

### iOS 开发

```bash
cd ios
xcodegen generate
open MoonCut.xcodeproj
```

Debug 指向本机 Agent；Release 使用受信 host 的私有 CA 锚定。模拟器构建与测试命令见 [iOS README](../ios/README.md)。

## 4. 提交前验证

按改动范围运行最小但充分的验证，不要用一次全仓库构建代替具体模块检查。

| 改动范围 | 命令 |
| --- | --- |
| Web | `cd mooncut-web && npm run build && npm test` |
| Studio | `cd mooncut-studio && npm run typecheck && npm test && npm run verify` |
| Agent | `cd mooncut-pi-agent && npm run typecheck && npm test` |
| Remotion | `cd remotion-studio && npm run typecheck && npm test && npm run verify:final-spec` |
| 字幕服务 | `cd hybrid-subtitle-service && uv run pytest` |
| iOS | `xcodebuild -project ios/MoonCut.xcodeproj -scheme MoonCut -destination 'platform=iOS Simulator,id=<UDID>' test` |

另外执行：

```bash
git diff --check
git status --short
```

若新增视频、音频或大型媒体，确认它们由 Git LFS 管理，并在推送前检查对应的 LFS 指针；不要提交 `dist/`、`out/`、`.wrangler/`、运行 PID、诊断包或本机媒体缓存。

<a id="signing-certificates"></a>

## 5. 生产 Secrets、TLS 与签名证书

### Web / Cloudflare Pages

- `mooncut.me` 的公开 HTTPS 由 Cloudflare Pages 托管，不应把 TLS 私钥或证书文件放进仓库。
- 页面函数所需的 `AGENT_ORIGIN`、`AGENT_INTERNAL_KEY`、`ASSISTANT_SCRIPT_API_KEY`、`ASSISTANT_COACH_API_KEY`、`DEEPGRAM_API_KEY` 与 `RESEND_API_KEY` 使用 Cloudflare Pages Secrets 注入。
- 例如：`wrangler pages secret put ASSISTANT_SCRIPT_API_KEY --project-name mooncut`。部署流程与变量说明见 [Web 部署文档](../mooncut-web/DEPLOY.md)。

### 私有 Agent API

- 私有部署的 API Key 与 CA 证书不进 Git；客户端凭据、CA 路径与生产 TLS 边界见 [Agent API 文档](../mooncut-pi-agent/API.md)。
- iOS、Android 或桌面客户端必须信任交付的 CA；**不要**通过关闭 TLS 校验绕过证书错误。

### iOS、macOS 与 Windows 签名

| 平台 | 当前仓库基线 | 发布时应由发布者完成 |
| --- | --- | --- |
| iOS | GitHub Actions 公开 IPA 是未签名预览包，不含内部服务密钥 | 使用自己的 Apple Developer 证书、Provisioning Profile 与 Team ID 重签；不要提交 `.p12` 或 profile |
| macOS Studio | `electron-builder` 设为 `identity: null`；不得把当前包宣称为已签名或已公证 | 注入自己的 Developer ID 证书与 Apple notarization 凭据，完成签名、公证与 Gatekeeper 验收 |
| Windows Studio | 当前配置不签名可执行文件 | 使用自己的 Authenticode 证书与 CI Secret 签名，并在目标 Windows 环境验证 |

桌面打包命令、runtime 体积和发行约束见 [Studio 发布文档](../mooncut-studio/docs/RELEASE.md)。

<a id="licensing"></a>

## 6. 许可证与第三方组件

MoonCut 自有源码采用 [Apache License 2.0](../LICENSE)。它允许使用、修改和分发，但要求保留许可证、版权和适用的归属声明；提交到仓库的贡献默认按 Apache-2.0 提供，除非贡献者在提交前明确书面说明不同安排。

- Apache-2.0 不授予 MoonCut 名称、Logo 或其他商标的使用权；请不要暗示官方背书。
- FFmpeg、Remotion、Ultralytics 模型与各类媒体素材有独立的许可证或再分发边界；公开安装包、App Store 上架或商用前必须逐项核验。
- 具体清单见 [Studio 许可证清单](../mooncut-studio/docs/LICENSES.md)。若要加入新的模型、媒体或 SDK，请同步记录其来源、许可证和可再分发范围。

## 7. 贡献约定

1. 先选择一个模块与可验证的用户路径，避免跨 Web、Studio、Agent 的无边界重写。
2. 修改前阅读该模块的 README、`.env.example` 和测试命令；不要从示例配置复制真实密钥。
3. UI 不能伪造后端已成功。需要真实服务的场景应提供加载、失败与恢复状态。
4. 对涉及媒体的功能，验证真实文件、时长、任务状态或渲染产物；对涉及 API 的功能，验证真实响应和鉴权边界。
5. 提交只包含本次范围，并附上运行过的验证命令。大型媒体使用 Git LFS。

## 8. 文档地图

- [主 README](../README.md)：产品概览、官网、案例与仓库地图。
- [Web 部署](../mooncut-web/DEPLOY.md)：Cloudflare Pages、D1、Functions、Secrets 与自定义域名。
- [Agent API](../mooncut-pi-agent/API.md)：HTTP API、TLS、客户端 CA 与运维边界。
- [安全部署基线](./SECURITY_DEPLOYMENT.md)：公开 Agent、Tunnel、OTP、邮件投递与 CI 的强制安全设置。
- [Studio 发行](../mooncut-studio/docs/RELEASE.md)：桌面打包、签名与公证。
- [Studio 许可证清单](../mooncut-studio/docs/LICENSES.md)：第三方依赖与公开分发前的核验项。
- [iOS README](../ios/README.md)：Xcode、本地 Agent、私有 CA 与未签名公开 IPA。
