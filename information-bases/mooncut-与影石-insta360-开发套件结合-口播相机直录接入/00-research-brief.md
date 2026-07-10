# Research Brief

## Original Idea

MoonCut 与影石 Insta360 开发套件结合：口播相机直录接入

## Refined Research Question

MoonCut 如何用最少改造实现“插上影石相机→在提词器中直接录口播→自动进入字幕与剪辑”，并判断什么时候应使用标准 Webcam/UVC，什么时候才需要影石 Camera SDK / Media SDK / OSC。

## Scope Assumptions

- Geography: 以中国用户和当前 macOS 开发机为主，同时考虑 Windows、Linux、iOS 和 Android。
- Language: 结论为中文，官方 API 名称保留英文。
- Time horizon: 2026-07-10 现状；SDK 和机型支持属于高时效信息。
- Target user: 需要在桌面或手机端使用提词器录制 30 秒到 10 分钟口播的内容创作者。
- Target project: MoonCut Web（Vue/Vite）、早期 MoonCut iOS 工程、FastAPI 字幕服务和 Remotion 渲染工程。

## Must-Answer Questions

- 影石公开了哪些套件、平台和机型？
- 哪些影石设备可直接作为系统摄像头，无需原生 SDK？
- MoonCut 现有录制、素材交接、转写和渲染链路到了什么程度？
- “直录”、“相机内高画质录制后自动回传”和“360 重新取景”分别应用什么架构？
- macOS/Web 与影石桌面 SDK 的平台缺口如何规避？
- 先做哪个实机实验能最快消除不确定性？

## Coverage Target

快速但可执行的技术扫描：至少 8 个一手来源，覆盖影石开发者文档、官方 GitHub、典型设备的 Webcam 文档、Web 媒体 API 和本地代码证据；产出机型/方案矩阵、推荐架构、分阶段路线和实机验收敛标准。
