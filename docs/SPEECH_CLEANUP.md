# MoonCut 口播净化模块

`mooncut-pi-agent/src/speech-cleanup.ts` 是一个本地、非破坏性的口播预处理模块。它在转写之后、跟脸和分镜之前运行，产出可审计的 EDL，而不是在成片阶段单独静音。

流程如下：

1. 从逐词时间戳识别独立填充词：`嗯`、`啊`、`呃` 及少量等价变体。
2. 用本地 FFmpeg `silencedetect` 找出长静音，并以逐词时间轴作为边界保护，避免切到相邻语音。
3. 仅删除超过阈值的死气，保留约 190 ms 的自然停顿；填充词前后也保留保护量。
4. 将删减范围变成 `speech-cleanup.json`，本地 FFmpeg 根据 EDL 生成 `speech-clean.mp4`。
5. 将字幕、逐词时间、跟脸、分镜和渲染全部切换到这条缩短后的时间轴；原始上传视频和 `subtitles-source.json` 保留不动。

默认策略是保守的：`minSilenceMs=750`、`retainedSilenceMs=190`、`fillerPaddingMs=80`、`wordGuardMs=55`。可用以下环境变量调整：

- `MOONCUT_SPEECH_CLEANUP_ENABLED`
- `MOONCUT_SPEECH_CLEANUP_MIN_SILENCE_MS`
- `MOONCUT_SPEECH_CLEANUP_RETAINED_SILENCE_MS`
- `MOONCUT_SPEECH_CLEANUP_FILLER_PADDING_MS`
- `MOONCUT_SPEECH_CLEANUP_WORD_GUARD_MS`

若没有逐词时间戳，模块会安全跳过，不会猜测口型或剪断说话中的词。
