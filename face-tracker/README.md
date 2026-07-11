# MoonCut Face Tracker

面向口播视频的 YOLO 人脸跟踪与自动重构模块。它把检测结果整理成稳定、与源视频时间轴绑定的轨迹 JSON，供 Remotion、Web 预览或其他渲染器复用。

## 能力

- 使用仓库内置的 `face_tracker/weights/yolov8n-face.pt` 检测并跟踪人脸
- 锁定主讲人，避免多人画面中逐帧跳脸
- 保留眼睛、鼻尖、嘴角等 5 点关键点，生成更稳定的人脸锚点
- 对短时丢检做保持和插值，对中心与缩放分别做平滑
- 输出 `mooncut.face-track.v1` JSON，坐标全部归一化
- 同一份轨迹可渲染为 9:16、1:1、16:9 或圆形头像

## 安装

推荐在模块目录建立独立环境：

```bash
cd face-tracker
uv sync --frozen --python 3.12
```

`uv.lock` 固定了本次通过回归的依赖版本；只在需要升级并重新跑完整测试时更新 lock。

Apple Silicon 建议使用 `--device mps`；其他环境可使用 `--device cpu` 或默认的 `auto`。

## 一条命令分析并生成圆形预览

```bash
.venv/bin/python -m face_tracker run \
  ../remotion-studio/public/media/talking-head.mp4 \
  --track-output ../output/face-tracker/talking-head.json \
  --output ../output/face-tracker/talking-head-circle.mp4 \
  --preset circle \
  --device mps
```

只生成轨迹：

```bash
.venv/bin/python -m face_tracker analyze input.mp4 --output face-track.json
```

使用已有轨迹重构不同画幅：

```bash
.venv/bin/python -m face_tracker render input.mp4 \
  --track face-track.json --output portrait.mp4 --preset portrait

.venv/bin/python -m face_tracker render input.mp4 \
  --track face-track.json --output avatar.mp4 --preset circle
```

可用预设：`portrait`、`square`、`circle`、`landscape`。圆形 MP4 会在方形成片中绘制圆形人物蒙版；在 Remotion 中则使用真正的圆形容器裁切。源画面保留完整人脸时，两端都使用强模糊背景补边来维持居中；如果原素材已经把部分人脸裁出画面，则安全夹紧到真实边界，避免伪造或镜像复制第二张脸。

## 在口播剪辑中的使用边界

人脸轨迹只用于网页、截图、演示或文字卡上方的圆形人物小窗。人物主镜头、放大镜头和情绪特写必须保留原素材构图，不要把轨迹当成持续运镜使用。相邻的小窗分镜复用同一个圆圈位置和进场状态，只在人物真正缩入或退出圆圈的语义切点切换。完整规则见 [`../docs/TALKING_HEAD_VISUAL_TRACKING_SPEC.md`](../docs/TALKING_HEAD_VISUAL_TRACKING_SPEC.md)。

圆圈镜头内置 650 ms 缓入居中、前后对称的 720 ms / 13 采样裁切平滑，以及连续的贴边安全权重。调用方不需要再自行插值；不要在业务层叠加第二套逐帧跟随动画。

## Python API

```python
from face_tracker import FaceTracker, ReframeConfig, analyze_video

tracker = FaceTracker(show=False, verbose=False, device="mps")
manifest = analyze_video(
    "input.mp4",
    tracker=tracker,
    config=ReframeConfig(sample_fps=15, smoothing_ms=420),
)
manifest.write_json("face-track.json")
```

底层逐帧接口：

```python
result = tracker.process(frame, timestamp_ms=1000)
speaker = result.primary_face

if speaker:
    print(speaker.track_id, speaker.bbox, speaker.anchor, speaker.keypoints)
```

处理新视频或新剪辑段前调用 `tracker.reset()`，避免跨素材沿用旧的跟踪状态。

## 轨迹契约

轨迹按源视频的 `t_ms` 索引，而不是按最终成片帧号索引。以后删除停顿或重排片段时，渲染层应先把“成片时间”映射回“源视频时间”，再查询该轨迹。

Remotion 的 `FaceTrackedVideo` 同时提供 `sourceTimeMs` 和 `trimBefore`：前者查轨迹，后者让实际媒体从同一源帧开始播放。`TalkingHeadDemo` 的 `sourceSegments` 会用同一份 output→source 映射驱动人物视频、模糊底层、跟踪查询和字幕；更复杂的重排也应按源片段复用这一契约。

每个 sample 包含：

- `frame_idx` / `t_ms`
- `track_id`
- `bbox_norm` / `center_norm` / `face_size_norm`
- `keypoints_norm`
- `confidence`
- `state`: `detected`、`interpolated`、`held` 或 `fallback`

## 模型说明与许可

- 权重文件：`face_tracker/weights/yolov8n-face.pt`
- SHA-256：`d545bf1add5aa736a4febac4f4f9245a6d596cd0fe70d5d57989fe0cb9e626ca`
- 模型类型：YOLOv8 face pose，1 个 face 类别，5 个人脸关键点

本模块所依赖的 Ultralytics 代码和模型涉及 AGPL-3.0/Ultralytics 许可。用于闭源或商业产品前，请完成模型来源与商业授权核验；本仓库中的这份权重尚缺独立模型卡和上游来源记录。
