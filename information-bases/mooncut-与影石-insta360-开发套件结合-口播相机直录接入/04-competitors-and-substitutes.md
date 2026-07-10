# Integration Alternatives and Substitutes

## Direct Competitors

此调研的决策单元是“影石怎么进 MoonCut”，不是市场竞争分析。最直接的替代方案是：

- **系统 Webcam 路线**：将 Link/GO/Ace 当作通用摄像头，不集成影石 SDK。
- **OBS 路线**：OBS 占有摄像头并负责编码，MoonCut 通过 obs-websocket 开停录制。
- **X 系列 OSC 路线**：MoonCut 本地桥使用 HTTP 遥控内录、停止后下载原片，但不提供实时预览。
- **X 系列官方 SDK 路线**：功能最全，需申请、原生宿主、机型适配和全景媒体处理。

## Indirect Substitutes

- 用 Mac/iPhone 内置摄像头直接录制：零硬件成本，但没有影石跟踪、构图和画质特性。
- 用手机原生相机录后上传：画质高，但提词、开停和素材交接割裂。
- 用影石官方 App / Link Controller 完成录制，然后手工导入 MoonCut：可使用官方高级效果，但缺少“自然连接”的产品体验。

## Manual Workflows

1. 在相机上录制普通平面 MP4。
2. USB 切换到 U-Disk / File Transfer。
3. 将最新文件复制到电脑或 iPhone App 容器。
4. 用 FFmpeg 统一成 H.264/AAC MP4。
5. 上传到现有字幕 API，再交给 Remotion。

这条路径是所有机型的最低保底，也是评估自动化所节省操作数的基准。

## Positioning Notes

MoonCut 有机会把影石定位为“创作输入设备”而不只是“另一个摄像头”：插上即自动识别，在提词器中录制，停止后自动转写、切停顿和生成字幕。如果后续加入 X 全景原片，还可以做“先说完，后取景”，这才是影石深度合作的差异化点。
