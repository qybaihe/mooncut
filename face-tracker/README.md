# Face Tracker for 口播 (spoken-word) video editing

人脸检测与追踪模块，用于 AI 口播剪辑系统。

## 依赖

```bash
pip install -r requirements.txt
```

## 模型

已包含在 `weights/yolov8n-face.pt`。

## 使用

```python
from face_tracker import FaceTracker

tracker = FaceTracker(model="weights/yolov8n-face.pt", show=False, verbose=False)
result = tracker.process(frame)

speaker = result.primary_face    # FaceData | None
# speaker.track_id, speaker.bbox, speaker.conf, speaker.center, speaker.is_new

for face in result.faces:
    print(f"ID={face.track_id} 新出现={face.is_new}")
```