# MoonCut iOS

原生 SwiftUI iPhone 客户端：登录会话、云端剪辑、脚本助手、口播陪练、任务队列与社区。

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

Debug 默认 `http://127.0.0.1:4317`（见 `Config/Debug.xcconfig`）。  
Release 默认 `https://42.194.219.172`，并使用捆绑的 `Resources/mooncut-ca.crt` 对固定 host 做证书锚定。

```bash
xcrun simctl list devices available | grep iPhone
xcodebuild -project MoonCut.xcodeproj -scheme MoonCut \
  -destination 'platform=iOS Simulator,id=<UDID>' build
xcodebuild -project MoonCut.xcodeproj -scheme MoonCut \
  -destination 'platform=iOS Simulator,id=<UDID>' test
```

## 已实现（真实路径）

- 邮箱注册/登录，Cookie 会话（`mooncut_session`），无 API Key 内嵌
- 剪辑：上传素材 → 创建任务 → 轮询 stage/progress → 下载成片 → 分享/条件发布
- 脚本助手：`/v1/assistant/script` 对话、建议、成稿、三类润色
- 陪练：Speech 转写、音量/停顿、Vision 镜头朝向估算 + `/v1/assistant/coach`
- 任务队列 `/v1/render-queue`、社区列表与发布
- 三主题 `light | dark | memphis`（`mooncut:theme`）
- 宠物小月由业务状态驱动，开心值仅互动

## 明确不会做的伪装

- 无权限时不生成演示成片
- 网络/AI 失败不回退假回答
- 进度不本地自增；仅显示服务端 progress 或“仍在等待服务更新”

## 安全

- 不写入 `MOONCUT_API_KEY`
- 不关闭 ATS 全局校验；仅 Debug 对本机 HTTP 最小例外
- 生产私有 CA 锚定在受信 host；证书缺失时阻断并提示
