# MoonCut Web · Memphis 主题新任务交接

下面的代码块可以整段复制，作为新任务的第一条消息。

```text
你将继续改造 MoonCut 的 Web 前端，并只负责第三套「现代 Memphis」视觉主题。

## 已绑定目录

- 工作区根目录：`/Users/baihe/Documents/moonbot`
- Web 项目目录：`/Users/baihe/Documents/moonbot/mooncut-web`
- 必须使用的 Skill：`memphisify-website`
- Skill 绝对目录：`/Users/baihe/.codex/skills/memphisify-website`
- Skill 图标库：`/Users/baihe/.codex/skills/memphisify-website/assets/memphis-simple-icons-160`
- 图标 Wiki：`/Users/baihe/.codex/skills/memphisify-website/assets/memphis-simple-icons-160/wiki/icon-wiki.tsv`

开始工作前必须完整读取：

1. `/Users/baihe/.codex/skills/memphisify-website/SKILL.md`
2. `/Users/baihe/.codex/skills/memphisify-website/references/visual-system.md`
3. `/Users/baihe/.codex/skills/memphisify-website/references/transformation-prompt.md`
4. `/Users/baihe/.codex/skills/memphisify-website/references/icon-usage.md`

不要在运行时代码中直接引用 Skill 目录。需要的图标必须用 Skill 自带的 `copy_icons.py` 复制到 `mooncut-web/public/memphis-icons/`。

## 任务目标

在现有浅色、深色主题之外，增加第三套可切换、可持久化的 `memphis` 主题。它是同一个 MoonCut 产品的第三套视觉系统，不是另建一个页面或复制一套业务代码。

三套主题最终应为：

- `light`：保留现有克制浅色设计。
- `dark`：保留现有深色设计。
- `memphis`：暖色纸张背景、粗黑描边、饱和撞色、贴纸图标、错位阴影和克制的几何动效。

只修改 Web：`/Users/baihe/Documents/moonbot/mooncut-web`。

严禁修改：

- `/Users/baihe/Documents/moonbot/ios`
- `hybrid-subtitle-service`
- `remotion-studio`
- `fifa-highlights-cli`
- 其他与 MoonCut Web 无关的工作区文件

## 当前项目基线

- Vue 3 + TypeScript + Vite。
- 现有 Web 是纯本地 Demo，无后端 API。
- 两条主流程必须完整保留：
  - 剪辑台：`empty → ready → processing → done`
  - 录制间：`compose → teleprompter → review → handoff to edit`
- 已有浅色/深色主题、移动底部导航、摄像头权限降级和本地状态持久化。
- 已加入 HappyDog 创作搭子「小月」：等待、跑动、挥手、跳跃、Review 等帧动画；轻触会提升开心值。
- 当前工作树包含用户未提交修改。开始前先运行 `git status --short`，把它们当作最新基线，禁止 reset、checkout 或覆盖现有修改。

优先阅读这些现有文件：

- `mooncut-web/src/styles.css`
- `mooncut-web/src/App.vue`
- `mooncut-web/src/components/ThemeToggle.vue`
- `mooncut-web/src/components/AppNavigation.vue`
- `mooncut-web/src/components/ClipStudio.vue`
- `mooncut-web/src/components/RecordStudio.vue`
- `mooncut-web/src/components/PetCompanion.vue`
- `mooncut-web/src/components/VideoSurface.vue`
- `mooncut-web/src/types.ts`

## 实现要求

### 1. 主题架构

- 将主题类型扩展为 `light | dark | memphis`。
- 继续使用 `localStorage` 键 `mooncut:theme`。
- 没有保存值时仍可跟随系统浅色/深色偏好；Memphis 只由用户主动选择。
- 将当前二态主题按钮升级为三态、键盘可访问的主题选择器。可以保留组件名 `ThemeToggle.vue`，但交互必须能明确选择三套主题，不能让用户猜循环顺序。
- 使用 `document.documentElement.dataset.theme = value` 或现有等价方式。
- 保持共享 DOM、共享 Vue 状态机和共享业务组件；不要复制三套页面。

### 2. Memphis 设计系统

先建立集中式 CSS tokens，再做组件覆盖。推荐起点：

- 背景：`#fff8e8`
- 纸张：`#ffffff`
- 奶油：`#fff3cf`
- 墨色：`#12121a`
- 线条：`#08080d`
- 黄色：`#ffe600`
- 粉色：`#ff3d8b`
- 青色：`#12cfe3`
- 薄荷绿：`#25f0b0`
- 橙色：`#ff6b35`
- 紫色：`#8b5cf6`

必须达到：

- 卡片、主要按钮与选中态使用 2–3px 黑色描边。
- 使用受控的彩色错位阴影，不使用玻璃拟态和泛滥渐变。
- 标题可以更粗、更有节奏，但正文、表单、稿件编辑和提词仍保持高可读性。
- 每个页面最多 1–2 组几何装饰：圆点、三角、波浪、锯齿或角标；不能把页面做成贴纸墙。
- 小月宠物应自然融入 Memphis 主题，可强化其气泡描边和贴纸感，但不得改变现有宠物状态机与触摸开心值逻辑。
- 处理进度、视频预览、聊天、TextEditor 和提词录制优先保证效率，装饰不能压住文字和操作区。
- 保留现有品牌月亮标识，不要用 Memphis 元素替换品牌本身。

### 3. 图标使用

先用 Skill 脚本按语义选图，不要手工浏览后随意挑选：

```bash
cd /Users/baihe/.codex/skills/memphisify-website
python scripts/select_icons.py --query "upload file video" --limit 8 --format json
python scripts/select_icons.py --query "scissors edit captions" --limit 8 --format json
python scripts/select_icons.py --query "chat robot magic" --limit 8 --format json
python scripts/select_icons.py --query "camera record microphone" --limit 8 --format json
python scripts/select_icons.py --query "success download refresh" --limit 8 --format json
```

已确认可用的候选包括：

- `upload-file-line`
- `camera-line`
- `chat-line`

只复制实际采用的图标：

```bash
python scripts/copy_icons.py \
  --slugs <最终确认的-slugs> \
  --out /Users/baihe/Documents/moonbot/mooncut-web/public/memphis-icons
```

Memphis PNG 用于空状态、功能卡、章节提示和关键成功状态。小尺寸功能按钮仍可保留 Lucide，避免机械替换所有图标。

### 4. 页面覆盖范围

以下状态都必须有完成度，不能只改首页：

- 剪辑台空状态、素材就绪、处理中、成片结果。
- 助手聊天初始态、发送后、建议选择态。
- 口播稿编辑与三类润色按钮。
- 提词录制沉浸页、倒计时、录制/暂停/完成按钮。
- 录制 Review 与一键交给剪辑台。
- 小月宠物的气泡、开心值、爱心反馈与底部导航中央停靠。
- 浅色、深色、Memphis 三种主题在刷新后的恢复。

### 5. 响应式与无障碍

至少实测：

- 桌面：1440×900
- 标准 iPhone Web：390×844
- 小屏：320×568

验收要求：

- 所有触控目标不少于 44px。
- 320×568 下选择视频 CTA 不得被宠物、气泡或底部导航遮挡。
- 宠物继续停靠在移动底部导航的中央预留位；小屏可以隐藏陪伴气泡，但必须保留宠物和触摸反馈。
- 键盘出现时聊天输入与稿件操作仍可用。
- 深色与浅色主题不能被 Memphis CSS 串色。
- 支持 `prefers-reduced-motion`，减少动态时停止装饰性循环动画，但不影响状态表达。
- 黑字/白字在黄色、粉色、青色等背景上的对比度必须逐项检查。

## 推荐工作顺序

1. 只读盘点现有主题、组件和工作树修改。
2. 写一个简短的布局/主题/动效方案后再编码。
3. 扩展主题模型和三态选择器。
4. 完成 Memphis 全局 tokens、背景、导航、按钮、表单和卡片。
5. 逐状态覆盖剪辑台、录制间、提词页和 Review。
6. 用 Skill 选择并复制少量语义图标。
7. 运行生产构建和浏览器全流程巡检。
8. 修复桌面、390px、320px 截图中所有遮挡与溢出。

## 验证与交付

必须运行：

```bash
cd /Users/baihe/Documents/moonbot/mooncut-web
npm run build
```

用 Playwright 或等价真实浏览器流程验证，并将最终截图放到：

- `output/playwright/mooncut-memphis-edit-desktop.png`
- `output/playwright/mooncut-memphis-edit-mobile.png`
- `output/playwright/mooncut-memphis-record-mobile.png`
- `output/playwright/mooncut-memphis-script-mobile.png`
- `output/playwright/mooncut-memphis-teleprompter-mobile.png`

至少交互验证：

- 三主题选择与刷新持久化。
- 视频选择入口可点击。
- 聊天快捷主题、发送、建议选择和生成稿件。
- 稿件润色与进入提词。
- 提词无权限时的演示降级。
- 小月点击后开心值增加。

最终回复需要说明：

- 修改了哪些文件。
- 复制了哪些 Memphis 图标及其用途。
- 三套主题如何切换和持久化。
- 构建与浏览器验收结果。
- 尚存的 Demo 边界。

不要创建 iOS Memphis 主题，不要扩展到后端，也不要提交、推送或重置 Git，除非用户在新任务中另行明确授权。
```

## Skill 状态确认

交接文件生成时已验证：

- `memphisify-website/SKILL.md` 存在。
- 三份 references 存在并可读。
- `select_icons.py`、`copy_icons.py` 存在。
- 图标库包含 160 个透明 PNG。
- Wiki 共 161 行（表头 + 160 个图标）。

仓库本身没有 Memphis Skill 的第二份本地副本；新任务应使用上面绑定的全局 Skill 绝对目录，避免复制 32MB 资源库进项目。
