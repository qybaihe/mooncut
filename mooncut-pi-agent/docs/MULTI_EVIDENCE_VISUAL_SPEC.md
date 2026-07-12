# MoonCut 多证据与多元视觉编排 Spec

状态：Implemented v1（兼容 `mooncut.edit.v1`）
适用链路：Codex / Pi / Grok planner → `save_edit_spec` → `AgentTalkingHeadVideo` → `verify_render`

## 1. 目标

在不牺牲真实性、可读性和人物信任感的前提下，让编辑 Agent 自主选择更丰富的画面表达：

- 一份证据足够时保持单窗；
- 两至三份证据各自增加新信息时，允许同时展示并独立滚动；
- 解释概念时使用更有层级的 16:9 原生窗口，而不是统一的大按钮和无意义数字；
- 解释流程、关系、决策树或架构时，可调用 Excalidraw 手绘图能力；
- 多元化是 AI 的可选能力，不是每个视频的硬指标。

## 2. 不变量

1. 最终画布固定为 16:9。桌面内容在 1920×1080 设计画布上编排，再等比缩放到 720p、1080p 或 4K。
2. 人物仍是信任主体。支持内容使用固定圆形人物气泡，字幕和人物不得被面板遮挡。
3. 真实证据、AI 插画、手绘图是三种不同语义：
   - `evidence`：可归因的网页或 X 原帖；
   - `illustration`：生成示例，必须披露；
   - `diagram`：解释结构的手绘图，不是事实证据。
4. 旧版仅含 `evidenceId` 的 `mooncut.edit.v1` 任务继续可渲染。

## 3. AI 编排决策

Agent 按以下顺序判断：

1. 真人画面是否已经是最强表达？是则使用 `speaker`。
2. 是否需要真实来源支撑当前口播？否则不要为了丰富而抓证据。
3. 一份来源是否完整回答当前画面问题？是则使用单一 `evidenceId`。
4. 第二或第三份来源是否提供不同且可一句话说明的作用？只有答案为“是”才使用 `evidencePanels`。
5. 来源之间是什么关系：
   - 同时补充不同信息：`parallel`；
   - 明确对照或争议：`comparison`；
   - 有顺序的步骤：`sequence`。
6. 如果流程/关系仍难以理解，再判断是否需要一个独立 `diagram` beat。不要把图解和证据堆在同一拍。

## 4. 多证据数据结构

```json
{
  "kind": "evidence",
  "headline": "能力、价格与官方说明",
  "body": "三份来源分别回答是什么、多少钱、如何使用",
  "evidenceMode": "parallel",
  "evidencePanels": [
    {
      "evidenceId": "official-product",
      "role": "primary",
      "purpose": "确认产品能力",
      "scrollStartPct": 0,
      "scrollEndPct": 28
    },
    {
      "evidenceId": "official-pricing",
      "role": "supporting",
      "purpose": "补充价格范围",
      "scrollStartPct": 8,
      "scrollEndPct": 42
    }
  ]
}
```

约束：

- 面板数量 1–3；推荐 2。
- `role`：`primary | supporting | contrast | step`。
- `purpose` 必须具体且彼此不同。
- `scrollStartPct` / `scrollEndPct` 范围 0–70；每窗独立计算。
- `comparison` 至少有一个 `contrast` 面板。
- `sequence` 的所有面板都使用 `step`。
- 同一 beat 禁止重复 evidence ID、规范化 URL 或 purpose。

## 5. 冲突与重复处理

- 两份来源表达相同内容：保留更权威、更清晰的一份。
- 两份来源结论冲突但冲突不是口播主题：只保留已验证的主来源。
- 冲突本身是主题：使用 `comparison`，将反方标为 `contrast`，并在 `headline/body` 明确说明“存在差异”，不能让观众误以为两者同时成立。
- 同一页面的不同滚动位置不算两份证据；使用一个面板的滚动区间表达。
- 面板加入后若不能用一句独特 `purpose` 解释其价值，应删除该面板。

## 6. 富桌面模板

`desktop` beat 可选：

- `editorial`：主观点 + 结构化摘要；
- `workflow`：有顺序的节点；
- `comparison`：两侧差异；
- `dashboard`：有语义的指标与状态。

每拍最多四个 `visualItems`：

```json
{
  "kind": "desktop",
  "desktopTemplate": "workflow",
  "visualItems": [
    {"title": "理解口播", "detail": "读取字幕与上下文"},
    {"title": "匹配素材", "detail": "选择互补而非重复的证据"},
    {"title": "验证成片", "detail": "检查遮挡、滚动和真实性"}
  ]
}
```

禁止使用没有解释的数字、装饰性 KPI 或统一的大按钮阵列。

## 7. 手绘图桥接

适用：流程、依赖、架构、因果链、决策树。默认零张，通常一张，最多两张。

Codex 必须：

1. 调用已安装的 `$excalidraw` skill；
2. 将 `.excalidraw` JSON 和渲染 PNG 放在当前 job 目录；
3. 调用 `import_handdrawn_diagram`；
4. 将返回的 `diagramId` 用于独立 `diagram` beat。

```bash
node --experimental-strip-types src/cli.ts tool <JOB_DIR> import_handdrawn_diagram \
  '{"sourcePath":"<JOB_DIR>/codex-diagrams/flow.png","sourceExcalidrawPath":"<JOB_DIR>/codex-diagrams/flow.excalidraw","label":"证据编排流程","purpose":"解释多证据选择与降级"}'
```

导入器会校验：

- 两个文件都位于当前 job 目录；
- PNG 文件签名正确；
- JSON 可解析且包含 Excalidraw `elements` 数组；
- 资产数量未超过两张。

## 8. 渲染行为

- 单证据：一个 16:9 Safari 窗口 + 解释 Inspector。
- 双证据：两个并排 16:9 Safari 窗口，各自滚动。
- 三证据：三个等宽 16:9 Safari 窗口，顶部保留标题区，底部保留来源角色区。
- 手绘图：16:9 主图窗口 + Diagram Notes，显示“解释性手绘图 · 非事实证据”。
- 所有桌面类场景共享 1920×1080 基准坐标，低分辨率导出只等比缩放，不重新排版或裁切。

## 9. 硬质量门禁

`validateSpecQuality` 拒绝：

- 超过三份并行证据；
- 重复 evidence ID、URL 或 purpose；
- 多面板却声明 `single`；
- `parallel/comparison/sequence` 只有一份来源；
- comparison 缺少 contrast；
- sequence 混入非 step 角色；
- diagramId 不存在、用在非 diagram beat，或导入后未使用；
- 生成插画与手绘图冒充 evidence；
- 证据、插画、手绘图超过各自预算。

`verify_render` 对多证据场景抽取连续三帧，检查真实页面、面板数量、遮挡和独立滚动；对手绘图检查节点/连线/标签是否完整可见。

## 10. 降级策略

- 第二份来源缺失或质量差：降级为单证据。
- 面板在 16:9 内不可读：减少面板数量，不缩小到不可读。
- 手绘图生成/导入失败：使用 `workflow` desktop，不用假图占位。
- 没有真实证据：回到 speaker/desktop，不生成拟真网页。
- AI 不确定是否需要多窗：选择单窗。

## 11. 验收条件

- 旧单证据 spec 可继续通过类型检查和渲染。
- 720p/1080p/4K 输出保持相同 16:9 构图。
- 双窗与三窗可表达独立滚动，且人物气泡、标题、字幕互不遮挡。
- 重复/冲突配置在渲染前被质量门禁拦截。
- Excalidraw JSON 与 PNG 均作为 job 资产保留，diagram beat 可正常渲染和质检。
