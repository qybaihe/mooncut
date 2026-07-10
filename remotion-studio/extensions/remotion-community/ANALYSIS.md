# 社区动效扩展审阅

三套上游仓库被刻意隔离在这个目录。宿主应用不安装它们的 package，也不执行它们的 CLI；首批代码只由 `CommunityMotionDemo` 按需引用，移除时可以整块删除。

| 库            | 对 Moonbot 最有价值的能力 | 首选组件/场景                                                                                                 | 注意事项                                                                                                                                     |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Remocn        | 高完成度的产品 / UI 叙事  | `focus-blur-resolve`、`simulated-cursor`、`animated-bar-chart`、`infinite-bento-pan`、`live-code-compilation` | 第一轮不要使用 shader 转场：`grain-dissolve` 会带入 `@paper-design/shaders-react`。其 cursor 实际接收像素坐标，而非文档里写的归一化坐标。    |
| Remotion Bits | 严格逐帧的动效积木        | `AnimatedText`（中文应按字拆分）、CSS 3D Cursor Flyover、粒子点缀、Mosaic Reframe、Fracture Reassemble        | 粒子要限量；它会在每个输出帧回放粒子物理。其渐变工具目前缺少已声明的 `culori` 运行时依赖，不适合直接装入主工程。                             |
| Onda          | 统一且克制的视觉运动语言  | `MeshGradient`、`DeviceFrame`、`Cursor`、`Captions`、`devicePullback`、`depthPush`                            | 一些源码依赖 Onda 的 schema / layout helper；应作为独立扩展一起带入，或像本 Demo 一样做小型适配。`BrowserFrame` 当前会间接带入 motion-blur。 |

## Demo 设计

`src/extensions/community-motion/CommunityMotionDemo.tsx` 是一个 16:9、12.4 秒的可渲染展示：

1. **Remocn** 直接使用本目录中的 `FocusBlurResolve`、`SimulatedCursor`、`AnimatedBarChart` 源码模块。
2. **Remotion Bits** 使用其 `AnimatedText` 和 `ParticleSystem` 的零依赖适配模式。完整上游导入会连带解析可选的 `three` 与尚未声明的 `culori`，不符合“宿主零污染”的目标。
3. **Onda** 用一个逐帧的小适配器展示 `MeshGradient`、`DeviceFrame` 与 device-pullback 的设计语言，避开其可选 schema 和 motion-blur 依赖链。

所有视觉运动都是 `useCurrentFrame()` 的纯函数；没有 CSS keyframe，也没有依赖墙钟时间的动画。

## 上游快照

- `remocn/` — 浅克隆，MIT，`9d269b3`
- `remotion-bits/` — 浅克隆，MIT 声明，`6c71169`
- `onda/` — 浅克隆，MIT，`3c81405`
