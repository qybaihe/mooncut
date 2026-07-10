# Opportunities and Next Steps

## Opportunity Areas

- 基于口播稿做 `category + moods + useCase + energy` 分类，再调用现有 `rankBgmTracks`。
- 用 ASR 单词活跃区间做人声闪避，而不是全片固定压低音乐。
- 给每首曲生成 15 秒试听片段、波形和“适合/不适合”示例。
- 导出时生成可下载的来源与许可证明 JSON，减少平台申诉成本。
- 在曲库 UI 中提供“无音乐”“仅开头”“全程铺底”“高潮增强”四种策略。
- 建立“平台参考曲”层：只保存曲名、版本、搜索关键词、适配赛道和建议起播秒数，不保存受限音频。
- 接入国内 B2B 曲库的热门/场景标签，再使用真实用户选择数据训练 MoonCut 自己的口播榜。

## Differentiation Hypotheses

- 少而准、对口播做过频段处理的音乐，比海量未审核曲目更能提升默认成片质量。
- 显示“为什么选这首”和自动可懂度保护，会比只按情绪标签推荐更可信。
- 把 `redistributeSourceFile` 做成一等元数据，可以从产品架构上避免版权越界。

## Validation Experiments

1. 人工审计 30–50 条真实中文口播，覆盖知识/商业观点/生活情绪/悬疑分析/信息流，记录曲名、版本、前 15 秒和互动量。
2. 向 HIFIVE、Vfine 各索取 30 首候选和完整合同边界，同时找中国音乐人制作三类各 8–12 首的原创原型。
3. 同一段口播比较无音乐、平台参考曲、商业曲库候选和原创候选；让 8–12 位目标用户盲评熟悉感、专业感、情绪匹配和不抢字。
4. 只保留综合均分达标且权利完整的 20–40 首；高能曲默认 `intro_only`，硬核知识允许 `no_music`。
5. 回写每首 `speechFit`、`gainDb`、适用时长、授权编号与平台范围，并做 Content ID 私密测试。

## Sources to Monitor

- HoliznaCC0 的逐曲 FMA 页面及许可状态。
- Creative Commons CC0 官方文本。
- YouTube、Meta、抖音等平台的音乐识别和申诉政策。
- Mixkit、Pixabay 等外部导入源的条款更新。
- Incompetech 目录与 Content ID 说明，作为第二开放包候选。
- 抖音开放平台热歌榜（只做全品类热度信号）和高收藏口播策展内容。
- HIFIVE/Vfine/TME 的曲库、合同和短视频趋势更新。
