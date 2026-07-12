# MoonCut iOS

原生 SwiftUI iPhone 客户端：登录会话、云端剪辑、脚本助手、口播陪练、我的任务、套餐额度与社区。

## 环境

- Xcode 16+（最低 iOS 17）
- SwiftUI + AVFoundation + PhotosUI + AVKit + Speech + Vision
- 无第三方运行时依赖
- Bundle ID：`com.mooncut.demo`

## 打开与运行

```bash
cd ios
xcodegen generate
open MoonCut.xcodeproj
```

Debug 与 Release 默认均为 `https://mooncut.me/api`，与 Web 的 Pages API 共用认证、账单和 Agent 隧道路由（见 `Config/*.xcconfig`）。
私有部署若使用私有 CA，需在受控配置中明确设置 `MOONCUT_TLS_MODE = pinned-private-ca` 与受信 host；默认 Pages 配置只使用系统 TLS 校验。

```bash
xcrun simctl list devices available | grep iPhone
xcodebuild -project MoonCut.xcodeproj -scheme MoonCut \
  -destination 'platform=iOS Simulator,id=<UDID>' build
xcodebuild -project MoonCut.xcodeproj -scheme MoonCut \
  -destination 'platform=iOS Simulator,id=<UDID>' test
```

## 已实现（真实路径）

- 邮箱验证码注册、验证码/密码登录，Cookie 会话（`mooncut_session`），无 API Key 内嵌
- 剪辑：上传素材 → 创建任务 → 轮询 stage/progress → 下载成片 → 分享/条件发布
- 建任务携带真实本地素材时长，供 Web 端额度预留后再由服务端探测结果校正
- 脚本助手：`/v1/assistant/script` 对话、建议、成稿、三类润色
- 陪练：Speech 转写、音量/停顿、Vision 镜头朝向估算 + `/v1/assistant/coach`
- 我的任务：`/v1/edit-jobs/{id}` 真实状态轮询；不展示 Web 已取消的全局队列占位数据
- 账户：`/v1/billing/summary`、安全支付升级请求；社区能力包的浏览、下载、连接与声明文件发布
- 三主题 `light | dark | memphis`（`mooncut:theme`）
- 宠物小月由业务状态驱动，开心值仅互动

## 明确不会做的伪装

- 无权限时不生成演示成片
- 网络/AI 失败不回退假回答
- 进度不本地自增；仅显示服务端 progress 或“仍在等待服务更新”

## 安全

- 不写入 `MOONCUT_API_KEY`
- 不关闭 ATS 或系统 TLS 校验
- 公共 Pages 使用系统信任链；只有显式私有 CA 模式才对固定 host 做证书锚定，证书缺失时阻断并提示

## 功能真实度

见仓库文档：[docs/IOS_FEATURE_ANALYSIS.md](../docs/IOS_FEATURE_ANALYSIS.md)（真实 API / 系统能力 / 后端依赖 / 公开包限制）。

## 公开 IPA（GitHub Actions）

- 工作流模板：[`docs/ci/ios-ipa.yml`](../docs/ci/ios-ipa.yml)（复制到 `.github/workflows/ios-ipa.yml` 后启用）
- 配置：`Config/Public.xcconfig`（`MOONCUT_API_BASE_URL=UNCONFIGURED`）
- 产物：**未签名** `MoonCut-public-unsigned.ipa`，在 Actions Artifacts（或 `ios-v*` Release）下载
- **不能开箱直连内部服务**；需自建 agent + 私有构建 + 自行重签安装

手动打包 Public（本机）：

```bash
cd ios && xcodegen generate
xcodebuild -project MoonCut.xcodeproj -scheme MoonCut -configuration Public \
  -sdk iphoneos CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build
# 再对 .app 运行 scripts/package-unsigned-ipa.sh
```
