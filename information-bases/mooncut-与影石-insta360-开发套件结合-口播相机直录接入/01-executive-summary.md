# Executive Summary

## Key Findings

- `Confirmed` MoonCut Web 已经有“提词器 + `getUserMedia` + `MediaRecorder` + Blob 预览 + 送入剪辑台”的真实浏览器录制骨架。因此，标准 USB 摄像头是最短接入点。
- `Confirmed` 影石当前公开的消费级 Camera SDK / Media SDK 支持表主要是 X 全景系列（X5、X4 Air、X4、X3、ONE RS 等），而不是 Link、GO 或 Ace 产品线。
- `Confirmed` 官方 SDK 可做连接、状态、预览、参数、录制、文件列表/下载和全景拼接/导出，但不能调用 Webcam 模式；通过 USB 录制时，视频仍先保存到相机存储卡。
- `Confirmed` 桌面 Camera SDK 只有 Windows/Linux，没有 macOS；iOS/Android 可通过 Wi-Fi/Bluetooth 连接。这使仓库中已有的 iOS 工程成为 X 系列深度集成的合理宿主。
- `Confirmed` 前端与真实 AI 处理尚未接通：Web `VideoAsset` 只保留临时 URL；剪辑进度和下载是演示；FastAPI 字幕服务和 Remotion 已存在但尚未与前端打通。

## Promising Signals

- Link 2 / Link 2C 和 Pro 型号可以不开 Link Controller，直接向第三方软件提供视频和音频，官方列出最高 4K30 和 1080p60。
- Link 系列同时支持横屏与竖屏规格，有物理摄像头流和可选的 Virtual Camera 流，适合口播创作。
- GO 3 / GO 3S 和 Ace 系列也有 Webcam 模式，可以作为现有用户设备的兼容路线。
- X 系列 SDK 能拿到实时预览、控制录制并下载原片；如果未来要做“拍完后再选机位/重新取景”，360 原片会成为有价值的差异化资产。

## Main Risks

- 用户尚未说明具体影石型号；不同产品线的集成方式完全不同。
- “官方支持 Webcam”不等于“所有浏览器都能按目标分辨率录制”；必须用目标机型 + 目标浏览器验证实际 `getSettings()`。
- X 系列全景视频为 INSV/双鱼眼资料，不能像普通 MP4 那样直接送入当前剪辑台；Media SDK 3.x 还有 GPU 要求。
- 相机自建 Wi-Fi 不能加入路由器，移动端控制、素材下载与云端上传可能需要分步。
- SDK 许可是免版税但可撤销，影石保留未来收费和停止功能的权利；品牌使用和隐私告知也有条款。

## Confidence Summary

对 SDK 功能、支持机型、连接方式、平台和许可条款的结论为高置信，来自影石开发者文档和官方 GitHub。对具体摄像头在 MoonCut/Chrome/Safari 内的实际分辨率、音画同步、稳定性和设备标签匹配是中置信，需要实机验证。

## Recommended Next Move

先用一台目标机型做 60–90 分钟的 UVC 技术尖刺。如果还没有确定采购，固定机位口播优先测 Link 2/Link 2 Pro；已有 GO 3/3S 或 Ace 则先直接测 Webcam 模式。通过后实现设备选择、影石自动识别、1080p30 录制、独立麦克风选择和断连恢复。同时申请 SDK，但不让申请阻塞 UVC MVP。
