# MoonCut 口播图片素材库

这是一套供口播脚本与剪辑 Agent 语义检索的本地素材库。它保留真实照片和品牌原始视觉，不套用 UI 组件或 Memphis 风格。

## 目录

- `manifest.json`：AI 调用入口，包含每张图的语义标签、用途、尺寸、哈希、来源和许可。
- `brands/`：AI、云服务、开发工具和内容平台的品牌标识。
- `photos/`：常用物体、AI 科技、金融经济、商业生活题材图。
- `symbols/finance/`：中性线性金融 SVG，用于人物旁挂件、关键词强调和数据转场。
- `symbols/general/`：中性线性常用物体与科技 SVG，用于缺少合适实拍图时的语义示意。

Remotion 中直接使用清单的 `remotionSrc`：

```tsx
<Img src={staticFile(asset.remotionSrc)} />
```

命令行检索示例：

```bash
node scripts/search-material-library.mjs "讲到 OpenAI Codex"
node scripts/search-material-library.mjs "股票上涨和交易行情"
node scripts/search-material-library.mjs "播客麦克风"
```

## AI 选图约定

1. 先用口播句子匹配 `spokenTriggersZh`、`aliases`、`tagsZh` 和 `useWhenZh`。
2. 直接提到具体品牌时优先选择 `brand-logo`；泛指行业时优先选择真实题材图。
3. 全屏切镜优先选择横图，人物旁挂件可选择方图或 SVG。
4. 不拉伸图片；根据 `aspectRatio` 选择 `cover` 或 `contain`。
5. `source.attributionRequired` 为 `true` 时，把 `source.creditLine` 加入片尾或发布说明。
6. 品牌 Logo 只用于直接讨论该品牌的内容，保持原始比例和颜色，不暗示合作或背书。

## 重建

```bash
node scripts/collect-material-library.mjs
```

加 `--refresh` 会重新下载已有文件。图库检索结果可能随 Wikimedia Commons 更新，因此日常使用应以已经提交的 `manifest.json` 与本地文件为准。

校验 JSON、文件哈希、格式、重复项、来源字段及 100–200 的数量范围：

```bash
npm run materials:verify
```
