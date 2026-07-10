# Evidence Notes

## Problem and Context

### MoonCut 当前结构

`Confirmed` Web 录制链路已经存在：

```text
默认摄像头/麦克风
→ getUserMedia({ facingMode: "user", audio: true })
→ MediaRecorder
→ 内存 Blob
→ blob: 临时 URL
→ VideoAsset
→ ClipStudio 本地预览
```

本地代码证据：

- `mooncut-web/src/components/RecordStudio.vue:141-169` 请求默认前置摄像头和默认音频，没有设备枚举、`deviceId` 或分辨率约束。
- `RecordStudio.vue:241-292` 选 MIME、创建 `MediaRecorder`、收集分片并产生 Blob URL。
- `RecordStudio.vue:361-370` 将录制结果包成 `VideoAsset` 送给剪辑台。
- `mooncut-web/src/types.ts:3-8` 的 `VideoAsset` 只有名称、显示大小、URL 和来源，没有 `Blob/File`、MIME、时长、分辨率或摄像头元数据。
- `mooncut-web/src/components/ClipStudio.vue:136-152` 的“智能剪辑”是计时器；`321-343` 成片仍播放原资产，下载只触发 Toast。
- `hybrid-subtitle-service/src/hybrid_subtitle/app.py:128-174` 已接收 FFmpeg 可读的视/音频并生成字幕任务，但 Web 前端未调用。
- `remotion-studio/src/Root.tsx:13-29` 和 `TalkingHeadDemo.tsx:133-205` 可消费口播视频与逐词字幕，但仍使用固定 `public/media` 资产。

`Confirmed` 仓库中还有一个 iOS 17 SwiftUI 骨架：`ios/project.yml:1-29`。`RecordStudioViewModel.swift:121-153` 已有提词/复盘/资产交接状态，`VideoFileStore.swift:5-41` 有应用内文件存储，但尚未发现 AVFoundation 录制、影石 SDK 依赖或相机桥接代码。

## Existing Solutions

### 影石官方开发套件

| 能力 | 支持平台 | 主要机型 | 适合 MoonCut 的用法 |
|---|---|---|---|
| Camera SDK | Windows/Linux/iOS/Android | X5、X4 Air、X4、X3、ONE R/RS/X2/X 等全景线 | 连接、预览、录制、文件下载 |
| Media SDK | Windows/Linux/iOS/Android | 同上，以全景资料为主 | INSV 拼接、稳定、导出 MP4 |
| OSC | 任意能连接相机 Wi-Fi 并发 HTTP 的环境 | 影石全景相机 | 轻量开始/停止录制、列文件/下载；无实时预览 |
| Webcam / UVC-style system camera | Windows/macOS/Linux/浏览器（具体机型实测） | Link 系列，部分 GO/Ace/X | 直接复用 MoonCut `MediaRecorder` |

新官方开发者文档已把 GO、ACE、Wave 和 Link 列为“暂不支持”的其他系列；GO/ACE 的 Android/iOS SDK 在规划中，Link SDK/API 暂未对外开放。因此 Link 路线不应等待 SDK，而应当作标准摄像头。

### 机型/接入判断

| 机型类别 | 直接系统摄像头 | 公开 Camera SDK | 结论 |
|---|---:|---:|---|
| Link 2 / 2C / 2 Pro / 2C Pro | 是，物理视/音频流，4K30/1080p60 | 否，暂未对外开放 | **固定桌面口播首选** |
| GO 3 / GO 3S | 是，需 Action Pod | 否，规划中 | 已有设备可先做兼容测试 |
| GO Ultra | 官方明确否 | 否 | 只适合本机录后导入，不适合直接 Web 录制 |
| Ace / Ace Pro / Ace Pro 2 | 是，官方上限 1080p30 | 否，规划中 | 直录可用；4K 高质量建议内录+导入 |
| X4/X5 | 有 Webcam 模式，官方主要验证 OBS 360 输出 | 是 | 需 360 后期重构图时才值得深度接入 |
| X4 Air | 官方 FAQ 表明不支持电脑 Webcam | 是 | 用 SDK/OSC 或手工导入 |

### 接入路线比较

| 路线 | 实时预览 | 原片质量 | 程序控制 | macOS | 工程量 |
|---|---:|---:|---:|---:|---:|
| Browser Webcam | 是 | 主机协商后的摄像头流 | 低：选设备/开停主机录制 | 是 | 低 |
| OBS + obs-websocket | 是 | 由 OBS 编码 | 中：开停、场景、录制状态 | 是 | 中，有外部依赖 |
| OSC | 否 | 相机内录原片 | 中：开停/列文件/下载 | 可用本地桥 | 中 |
| Camera + Media SDK | 是 | 相机内录原片 | 高 | 桌面否；iOS 是 | 高 |
| U-Disk 自动导入 | 否 | 相机内录原片 | 低 | 是 | 低到中 |

## Recent Changes

- `Confirmed` 影石在 2026 年建立了新的 `Insta360-Developer_Docs` 官方仓库，将 X 系列与暂未开放的 GO/ACE/Wave/Link 系列状态集中展示。
- `Confirmed` Desktop Media SDK 官方 GitHub 在 2026-01-29 显示 Windows Media 3.1.3 / Linux Media 3.1.1 发布；生产接入应锁定版本而不是始终跟随“最新”。
- `Confirmed` 新 Link 2 Pro / 2C Pro 文档继续保留物理摄像头流、虚拟摄像头流、横/竖屏 4K30 和 1080p60，但开发 API 仍未开放。

## Contradictions or Gaps

- `Single-source / needs test` 用户的具体相机型号未知，所以无法将方案收敛到唯一硬件。
- `Inferred` Link 在 Windows/macOS 作为标准摄像头被浏览器识别的可行性很高，但影石官方并未对 MoonCut 或 `MediaRecorder` 做专项兼容认证。
- `Confirmed` `devicechange` 在 Web 中不是 Baseline；不能只依赖插拔事件，还需要手动刷新/页面重获取。
- `Confirmed` X4 的 Webcam 官方页说主要测试 OBS；不应由“有 Webcam 模式”推导出“适合浏览器平面口播”。
- `Inferred` Webcam、文件传输和 SDK Android 控制是相机 USB 菜单中的不同模式，应按互斥设计；此点需实机确认。
