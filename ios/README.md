# MoonCut iOS

原生 SwiftUI iPhone Demo，完整迁移 `mooncut-web` 的剪辑台、口播助手、稿件、提词录制、录制复核与跨流程交接。

## 环境

- Xcode 26（项目最低支持 iOS 17）
- SwiftUI + AVFoundation + PhotosUI + AVKit
- 无第三方运行时依赖
- 默认 Bundle ID：`com.mooncut.demo`

## 打开与运行

项目文件已经生成，可直接打开：

```bash
open MoonCut.xcodeproj
```

如修改了 `project.yml`，重新生成工程：

```bash
xcodegen generate
```

命令行构建与测试：

```bash
xcodebuild -project MoonCut.xcodeproj \
  -scheme MoonCut \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  build

xcodebuild -project MoonCut.xcodeproj \
  -scheme MoonCut \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  test
```

## 已实现

- 剪辑台四阶段：导入、设置、模拟处理、原片/成片结果与导出分享。
- 口播助手：快捷话题、对话、建议多选、规则式生成与本地保存。
- 稿件：字符/时长估算、三类润色、复制与原生 TextEditor。
- 提词录制：前置相机、麦克风、字号/速度/镜像、倒计时、暂停/继续、分段合并、权限失败演示模式。
- 录制复核：本地回放、重新录制、一键送入剪辑台。
- 浅色/深色/系统外观、iPhone 安全区、小屏布局与本地状态恢复。
- 创作搭子“小月”：9 行 HappyDog 图集按创作状态切换帧动画；触摸有跳跃、爱心、轻触感与持久化开心值。

## Demo 边界

与 Web 基线一致，当前“智能剪辑、字幕生成和统计”是本地演示状态机；没有调用真实 AI、ASR 或视频渲染服务。导出会分享原始本地素材，成片字幕与水印是预览叠层。

宠物素材来源与生产使用提示见 [ASSET_SOURCES.md](ASSET_SOURCES.md)。正式发布前请替换 Bundle ID、配置开发者 Team、补齐正式 AppIcon，并确认宠物素材授权。
