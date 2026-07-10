# MoonCut 与影石 Insta360 开发套件结合：口播相机直录接入

Research date: 2026-07-10

## Navigation

- [Research brief](00-research-brief.md)
- [Executive summary](01-executive-summary.md)
- [Source index](02-source-index.md)
- [Evidence notes](03-evidence-notes.md)
- [Competitors and substitutes](04-competitors-and-substitutes.md)
- [Users, market, and demand](05-users-market-and-demand.md)
- [Risks, constraints, and open questions](06-risks-constraints-and-open-questions.md)
- [Opportunities and next steps](07-opportunities-and-next-steps.md)

## Current Conclusion

MoonCut 与影石有两条可落地的结合路线：

1. **桌面口播直录（首选 MVP）**：Link / Link 2 / Link 2C / Link 2 Pro / Link 2C Pro 作为标准 USB 摄像头输出，MoonCut Web 用浏览器的 `getUserMedia` + `MediaRecorder` 直接录制，不需要申请影石 SDK。
2. **X 系列深度集成（高画质二期）**：用影石 Camera SDK 控制 X3/X4/X4 Air/X5 预览和录制，原片先落相机存储卡，停止后下载，必要时用 Media SDK 拼接/导出。仓库中的 iOS 工程可作为这条路线的原生宿主。

当前不建议一开始就用全景 SDK 来解决普通口播：它不支持调用 Webcam 模式，桌面 SDK 没有 macOS 版，且全景视频需要额外拼接与重新取景。

## Next Update Checklist

- [ ] Add new sources to `02-source-index.md`.
- [ ] Update changed claims in topic files.
- [ ] Add a dated note under `updates/`.
- [ ] 记录用户手上的具体影石型号、开发主机系统和希望的竖/横屏规格。
- [ ] 用实机验证浏览器可见的设备名、实际分辨率/帧率、音频输入和 5 分钟音画同步。
