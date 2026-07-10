# wc26

`wc26` 是一个 TypeScript / Node.js CLI。比赛、集锦和中文赛况页匹配使用**纯 HTTP 请求**；结果可以直接在官方 FIFA 页面或百度体育中文详情页打开。可选的截图使用无头浏览器，可选的视频下载还需要 ffmpeg，因为 FIFA 的媒体分片使用浏览器会话授权。

它只负责搜索、整理、打开官方链接，并按官方播放器同等的授权方式保存你本就有权观看的官方集锦；**不提供第三方转载地址，也不绕开任何你本无权访问的限制**。

## 安装与运行

需要 Node.js（≥ 20）和 npm。在项目目录中安装依赖：

```bash
npm install
```

开发模式查询比赛：

```bash
npm run dev -- highlight "阿根廷 vs 埃及"
```

要安装成当前机器可直接调用的 `wc26` 命令：

```bash
npm run build
npm install -g .

wc26 "阿根廷对埃及" --open
wc26 team 阿根廷 --limit 3
wc26 match M95 --json
```

按球队查询并打开官方结果：

```bash
npm run dev -- team 阿根廷 --open
```

构建：

```bash
npm run build
```

## 命令

```bash
wc26 highlight QUERY  # 按球队、对阵或比赛编号查询
wc26 team TEAM        # 查看某支球队相关比赛与已发布集锦
wc26 match ID         # 用比赛编号查看该场比赛的官方集锦
wc26 download QUERY   # 等同 highlight + --download，解析后直接下载
```

全部查询命令支持：

```bash
--json     # 输出机器可读 JSON
--open     # 在默认浏览器打开已解析的官方集锦页
--download # 解析到官方集锦后，用无头浏览器 + ffmpeg 下载为 MP4
--out PATH # 指定输出文件或目录（默认当前目录，按对阵自动命名）
--force    # 允许覆盖已有文件；默认拒绝覆盖
--cn       # 查找百度体育中文比赛详情页
--open-cn  # 打开中文详情页；默认停留在“球员评分”
--screenshot PATH # 将中文详情页主体保存为无白边 PNG
--view ratings|match|chat # 选择球员评分、赛况或聊天视图
```

`--out` 指向已存在目录、以 `/` 结尾的路径，或尚不存在且没有扩展名的路径时，会按目录处理并自动生成 `.mp4` 文件名。`--json` 在成功和失败时都只向标准输出写一个 JSON 文档；失败详情位于顶层 `error` 字段，进度和诊断信息写入标准错误。

默认结果包含比赛名称、比赛编号、集锦标题和官方链接。查询不唯一时会返回候选项，不会猜测并打开无关视频；未发布官方集锦时会明确提示暂无可用视频。

## 中文比分、球员评分与截图

中文页面以 FIFA 比赛时间和双方球队为基准，通过百度体育公开网页数据进行匹配。默认视图是更适合截图的“球员评分”：

```bash
# 输出中文比分、摘要和三个可切换页面地址
wc26 match M95 --cn
wc26 match M95 --cn --json

# 在浏览器打开球员评分页（默认）
wc26 match M95 --open-cn

# 截图默认为球员评分；按百度桌面主体裁成约 890×720，无左右白边
wc26 match M95 --screenshot ./m95-ratings.png

# 也可切换到赛况或聊天
wc26 match M95 --open-cn --view match
wc26 match M95 --screenshot ./m95-chat.png --view chat
```

`--open-cn` 和 `--screenshot` 会自动启用 `--cn`。截图依赖 Playwright Chromium，先运行 `npx playwright install chromium`。百度体育属于补充展示源；若页面或内部数据结构变化，CLI 会保留 FIFA 核心查询结果并明确报告中文页错误。

## 下载官方集锦

FIFA 的集锦通过 THEOplayer / Verizon / Uplynk 分发，播放器会在**你的浏览器会话内**对视频分片做一次性授权。因此下载需要一个真实浏览器会话把授权后的播放地址交给 ffmpeg：

```bash
# 最简：解析后自动下载到当前目录（按 "主队 vs 客队" 命名）
wc26 "阿根廷 vs 埃及" --download
wc26 download "阿根廷 vs 埃及"

# 指定输出路径 / 目录
wc26 team 阿根廷 --download --out ~/Movies
wc26 match M95 --download --out /tmp/arg-vs-egy.mp4
wc26 match M95 --download --out /tmp/arg-vs-egy.mp4 --force
```

### 前置依赖

```bash
# 1) npm install 已包含 Playwright；再安装 Chromium（仅需一次）
npx playwright install chromium

# 2) 安装 ffmpeg（下载与封装用它完成）
# macOS:
brew install ffmpeg
# 其它平台见 https://ffmpeg.org/download.html
```

工作机制：CLI 在本地启动无头 Chromium 打开官方观看页 → THEOplayer 解析出已授权的 HLS 播放清单 → 捕获该地址 → 交由 ffmpeg 以「流拷贝」方式下载并封装为 MP4。视频会先写入同目录临时文件，经过 ffprobe 的 95% 兼容性时长校验后才安全替换最终文件；ffmpeg 失败或明显不完整时会重新获取授权并整段重试一次，最终失败则清理残片并保留原有文件。FIFA 的 HLS/AAC 时间轴偶尔含不连续间隔，因此 95%–99% 会提示但不误判为画面缺失。过程中**不会**修改、破解或绕开任何授权；下载的即是你在浏览器里本就能播放的同一段官方集锦。

> 说明：下载的是官方 HLS 视频流。若 FIFA 未对某场比赛发布官方集锦，或该集锦在你所在地区/账户下不可播放，CLI 会如实报错，不会产出视频。

## 使用边界

- 视频仅使用 FIFA 官方可访问页面和官方流；百度体育只用于中文比分、赛况、公开评分与页面截图，不作为视频下载源。
- 下载行为与在浏览器中观看官方集锦同等：依赖你本就有权访问的官方授权，不绕开任何限制。
- 视频可用性仍受 FIFA 发布状态、地区及账户／播放器限制影响。
