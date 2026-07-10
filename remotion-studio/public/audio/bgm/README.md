# MoonCut 口播 BGM Starter Library

这是一组可以直接交给 Remotion 使用的纯音乐底乐。当前共 25 首：15 首 CC0 技术验证曲，以及 10 首面向黑客松演示的高质口播 Demo 曲。

## 文件与接入

- 音频：`tracks/*.mp3`
- Demo 音频：`demo-tracks/*.mp3`
- 机器可读目录：`../../../src/data/bgm-library.json`
- 自动排序与选曲：`../../../src/bgm.ts`
- Remotion 路径：`staticFile(track.file)`，其中 `track.file` 形如 `audio/bgm/tracks/calm-currents.mp3`

首版建议把对白归一化到约 `-16 LUFS`，再使用目录中的 `mix.gainDb` 作为音乐起始增益；有对白时额外应用 `mix.duckDb`。所有曲目都不是无缝循环，长视频应使用 `mix.crossfadeLoopMs` 做交叉循环。

`TalkingHeadDemo` 已默认接入 `demo-tech-house-vibes`。Remotion Studio 里还提供 `TalkingHeadDemoGroove` 和 `TalkingHeadDemoEmotional`，用于快速展示同一段口播切换三类音乐的效果。

## 为口播做过的处理

- 48 kHz、双声道、160 kbps MP3
- 目标约 `-16 LUFS`、真峰值不高于约 `-1.5 dBTP`
- 45 Hz 高通
- 约 2.5 kHz 处衰减 3 dB，为口播主要清晰度频段留空间
- 每首曲目的实测响度、节拍、频段占用、推荐增益和 SHA-256 均记录在目录中

## 授权与来源

Core Pack 作者为 HoliznaCC0，文件从 Free Music Archive 的逐曲页面下载；每个页面均将对应曲目标为 [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)，并标注为纯音乐。黑客松 Demo Pack 的逐曲来源和标记见 [`demo-tracks/README.md`](demo-tracks/README.md)。

尽管无需署名，产品仍应保留目录中的 `source.pageUrl`、`source.downloadUrl`、下载时间和哈希，以便处理平台误报。不要把这些公共领域曲目登记到 Content ID 或其他会限制下游使用者的音频指纹系统。

具体逐曲来源、原始文件哈希和处理后哈希见 [`bgm-library.json`](../../../src/data/bgm-library.json)。
