# Risks, Constraints, and Open Questions

## Technical Risks

### P0：机型与路线选错

- Link 是 Webcam 路线，X 系列是 SDK/OSC/360 媒体路线，GO/Ace 主要是 Webcam 或录后导入。没有具体型号无法锁定实现。
- GO Ultra 不支持 Webcam；X4 Air 不应按 X4/X5 的电脑 Webcam 方案处理。

### P0：资产契约不能进入真实处理

- Web `VideoAsset` 没有 `File/Blob` 和媒体元数据；Blob URL 刷新即丢，也不能直接被 Remotion 服务端消费。
- 浏览器在 4K 长时录制时会持续累积内存 Blob；MVP 应限定 1080p30 和时长，再引入分片持久化/上传。
- `MediaRecorder` 在不同浏览器可输出 MP4 或 WebM；后端需统一转为 H.264/AAC MP4。

### P0：平台限制

- 影石 Desktop SDK 无 macOS 版；Mac 上只能使用 Webcam/OBS、OSC 本地桥、U-Disk 导入，或让 iOS/Android 作为 SDK 伴侣。
- 纯 Web 不能加载原生 SDK；浏览器直连相机私有网段的 OSC 可被 CORS、HTTPS→HTTP mixed content 和本地网络权限拦截，应放到 Electron/Tauri 主进程或 localhost 桥。

### P1：摄像头与 USB 行为

- 物理摄像头通常只能被一个进程稳定占用；不要让浏览器、OBS 和 FFmpeg 同时抢占。
- Link Virtual Camera 可保留背景/美颜等效果，但不支持 50/60fps，部分 4K 效果也受限。
- `devicechange` 不是所有浏览器稳定支持；需人工“重新扫描设备”和页面回到前台时重新枚举。
- Webcam、U-Disk 和 SDK/Android USB 控制很可能是互斥模式，不能假设一根线上同时直播、内录、挂盘和 SDK 控制。

### P1：360 素材复杂度

- X4/X5 全景视频需拼接与重新取景，Media SDK 3.x 需 GPU，且桌面只有 Windows/Linux。
- 官方说 SDK 主要用于全景拍摄、不建议单镜头模式；普通口播不应为了“用 SDK”而引入 360 处理。
- X5/X4/X4 Air/X3 普通录制约每 29:59 自动分段；自动导入要能识别一次录制的多文件组。

### P1：音频

- 当前 `audio: true` 只拿默认麦克风，即使影石视频选对，也可能录到错误音源。
- 应将视频设备和音频设备分开选择，并以齐声/手掌测试 5 分钟音画漂移。

## Regulatory or Policy Risks

- SDK EULA 是有限、可撤销、不可转让的许可；影石可改变/删除 SDK 功能，也保留未来收费权利。
- 不能在未获书面同意时用影石商标暗示官方认证或联合开发；应使用“兼容 Insta360 设备”等中性表达并经审核。
- 若初始化影石 SDK，EULA 要求在隐私政策/产品页告知使用该 SDK，并在首次初始化前取得有效同意。
- MoonCut 的混合字幕服务会把音频发给外部 ASR 提供商；需独立告知与数据删除策略，不应与摄像头权限合并成一句模糊提示。

## Distribution Risks

- 桌面 SDK 的实际二进制、Maven 仓库凭证、iOS xcframework 和完整 Demo 需申请后获得；公开 GitHub 文档不足以完成发布构建。
- Windows Camera SDK 需 libusbK/Zadig，会增加安装、管理员权限和客服成本。
- Link Controller / Virtual Camera 作为可选外部依赖时，需明确其版本和用户安装路径；MVP 应先兼容物理摄像头流。

## Trust and Safety Risks

- 录制红点、麦克风状态和摄像头名称必须始终可见，避免误录或录到错误设备。
- 默认保留原片以防自动剪辑损坏内容；在用户确认成片前不自动删除相机卡原文件。
- 将“本地录制”与“上传云端转写/剪辑”作为两个明确阶段，用户能看到上传状态和删除入口。

## Open Questions

1. 用户手上或准备买的具体型号是 Link、GO、Ace 还是 X 系列？
2. 主要录制端是 Mac 网页、未来 Electron 桌面端，还是 iPhone/iPad？
3. 产品目标是“录制结束立即拿文件”还是“相机内录 4K/8K 高质原片”？
4. 竖屏 9:16 是摄像头原生输出，还是先录 16:9/4K 再自动裁切？
5. 音频准备用 Link 内置麦、Mac 默认麦、无线麦还是相机内录音轨？
6. 是否真正需要 360 后期自动取景？如果不需要，不应为普通口播引入 Media SDK。
