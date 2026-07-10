"use client";

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Phase = "idle" | "preparing" | "recording" | "complete" | "error";

type CoachSuggestion = {
  id: string;
  text: string;
  eyebrow: string;
  priority: number;
};

type CoachEvent = CoachSuggestion & {
  at: number;
};

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
};

const countSpeakableCharacters = (value: string) =>
  Array.from(value).filter((character) => /[\u3400-\u9fffA-Za-z0-9]/.test(character))
    .length;

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pace, setPace] = useState(0);
  const [volume, setVolume] = useState(0);
  const [eyeContact, setEyeContact] = useState(0);
  const [pauseCount, setPauseCount] = useState(0);
  const [suggestion, setSuggestion] = useState<CoachSuggestion | null>(null);
  const [coachEvents, setCoachEvents] = useState<CoachEvent[]>([]);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [visionStatus, setVisionStatus] = useState("等待启动");
  const [speechStatus, setSpeechStatus] = useState("声学估算");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnimationRef = useRef<number | null>(null);
  const visionAnimationRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const isRecordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const lastAudioFrameRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const speechActiveMsRef = useRef(0);
  const uninterruptedSpeechMsRef = useRef(0);
  const silenceStartedAtRef = useRef(0);
  const wasSpeakingRef = useRef(false);
  const hasSpokenRef = useRef(false);
  const noiseFloorRef = useRef(0.008);
  const smoothedRmsRef = useRef(0);
  const lowVolumeSinceRef = useRef(0);
  const syllablePeaksRef = useRef(0);
  const peakArmedRef = useRef(true);
  const lastPeakAtRef = useRef(0);
  const transcriptFinalRef = useRef("");
  const transcriptInterimRef = useRef("");
  const gazeWindowRef = useRef<boolean[]>([]);
  const noFaceSinceRef = useRef(0);
  const offCameraSinceRef = useRef(0);
  const lastVisionRunRef = useRef(0);
  const activeSuggestionRef = useRef<CoachSuggestion | null>(null);
  const lastGlobalSuggestionAtRef = useRef(0);
  const cooldownsRef = useRef<Record<string, number>>({});

  const emitSuggestion = useCallback((candidate: CoachSuggestion) => {
    const now = Date.now();
    const current = activeSuggestionRef.current;
    const coolingUntil = cooldownsRef.current[candidate.id] ?? 0;

    if (now < coolingUntil) return;
    if (now - lastGlobalSuggestionAtRef.current < 7000) return;
    if (current && current.priority > candidate.priority) return;

    activeSuggestionRef.current = candidate;
    lastGlobalSuggestionAtRef.current = now;
    cooldownsRef.current[candidate.id] = now + 22000;
    setSuggestion(candidate);
    setCoachEvents((events) => [{ ...candidate, at: now }, ...events].slice(0, 6));

    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    suggestionTimerRef.current = setTimeout(() => {
      activeSuggestionRef.current = null;
      setSuggestion(null);
    }, 4400);
  }, []);

  const resetMetrics = useCallback(() => {
    setElapsedSeconds(0);
    setPace(0);
    setVolume(0);
    setEyeContact(0);
    setPauseCount(0);
    setSuggestion(null);
    setCoachEvents([]);
    setErrorMessage("");
    setVisionStatus("正在加载视觉分析");
    setSpeechStatus("声学估算");
    activeSuggestionRef.current = null;
    lastGlobalSuggestionAtRef.current = 0;
    cooldownsRef.current = {};
    speechActiveMsRef.current = 0;
    uninterruptedSpeechMsRef.current = 0;
    silenceStartedAtRef.current = 0;
    wasSpeakingRef.current = false;
    hasSpokenRef.current = false;
    noiseFloorRef.current = 0.008;
    smoothedRmsRef.current = 0;
    lowVolumeSinceRef.current = 0;
    syllablePeaksRef.current = 0;
    peakArmedRef.current = true;
    lastPeakAtRef.current = 0;
    transcriptFinalRef.current = "";
    transcriptInterimRef.current = "";
    gazeWindowRef.current = [];
    noFaceSinceRef.current = 0;
    offCameraSinceRef.current = 0;
    lastVisionRunRef.current = 0;
  }, []);

  const startSpeechRecognition = useCallback(() => {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechStatus("声学估算");
      return;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) transcriptFinalRef.current += text;
          else interim += text;
        }
        transcriptInterimRef.current = interim;
        setSpeechStatus("浏览器实时转写");
      };
      recognition.onerror = () => setSpeechStatus("声学估算");
      recognition.onend = () => {
        if (!isRecordingRef.current) return;
        try {
          recognition.start();
        } catch {
          setSpeechStatus("声学估算");
        }
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setSpeechStatus("声学估算");
    }
  }, []);

  const startAudioAnalysis = useCallback(
    async (stream: MediaStream) => {
      const AudioContextClass = window.AudioContext;
      const audioContext = new AudioContextClass();
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      audioContextRef.current = audioContext;

      const samples = new Float32Array(analyser.fftSize);
      lastAudioFrameRef.current = performance.now();

      const analyse = () => {
        if (!isRecordingRef.current) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        const now = performance.now();
        const delta = clamp(now - lastAudioFrameRef.current, 0, 100);
        lastAudioFrameRef.current = now;

        const threshold = Math.max(0.012, noiseFloorRef.current * 2.35);
        const speaking = rms > threshold;
        const previousSilenceStartedAt = silenceStartedAtRef.current;
        smoothedRmsRef.current = smoothedRmsRef.current * 0.76 + rms * 0.24;

        if (!speaking) {
          noiseFloorRef.current = noiseFloorRef.current * 0.995 + rms * 0.005;
        }

        if (speaking) {
          speechActiveMsRef.current += delta;
          uninterruptedSpeechMsRef.current += delta;
          hasSpokenRef.current = true;
          silenceStartedAtRef.current = 0;

          if (
            smoothedRmsRef.current > threshold * 1.55 &&
            peakArmedRef.current &&
            now - lastPeakAtRef.current > 170
          ) {
            syllablePeaksRef.current += 1;
            peakArmedRef.current = false;
            lastPeakAtRef.current = now;
          }
          if (smoothedRmsRef.current < threshold * 1.22) {
            peakArmedRef.current = true;
          }
        } else {
          if (!silenceStartedAtRef.current) silenceStartedAtRef.current = now;
          if (now - silenceStartedAtRef.current > 420) {
            uninterruptedSpeechMsRef.current = 0;
          }
        }

        if (speaking && !wasSpeakingRef.current && hasSpokenRef.current) {
          const lastSilence = previousSilenceStartedAt
            ? now - previousSilenceStartedAt
            : 0;
          if (lastSilence > 420) setPauseCount((count) => count + 1);
        }
        wasSpeakingRef.current = speaking;

        const volumePercent = clamp(
          Math.round((rms - noiseFloorRef.current) * 780),
          0,
          100,
        );

        if (speaking && volumePercent < 16) {
          if (!lowVolumeSinceRef.current) lowVolumeSinceRef.current = now;
          if (now - lowVolumeSinceRef.current > 4500) {
            emitSuggestion({
              id: "volume-low",
              eyebrow: "声音",
              text: "声音可以再有力量一些",
              priority: 55,
            });
          }
        } else {
          lowVolumeSinceRef.current = 0;
        }

        const transcriptCharacters = countSpeakableCharacters(
          transcriptFinalRef.current + transcriptInterimRef.current,
        );
        const speechMinutes = speechActiveMsRef.current / 60000;
        const transcriptPace =
          transcriptCharacters > 3 && speechMinutes > 0.04
            ? transcriptCharacters / speechMinutes
            : 0;
        const acousticPace =
          speechMinutes > 0.04 ? syllablePeaksRef.current / speechMinutes : 0;
        const currentPace = clamp(
          Math.round(transcriptPace || acousticPace),
          0,
          420,
        );

        if (currentPace > 295 && speechActiveMsRef.current > 6000) {
          emitSuggestion({
            id: "pace-fast",
            eyebrow: "语速",
            text: "语速稍快，试着放慢一点",
            priority: 80,
          });
        }

        if (uninterruptedSpeechMsRef.current > 18000) {
          emitSuggestion({
            id: "pause-needed",
            eyebrow: "节奏",
            text: "在下一句话前，留一个短停顿",
            priority: 60,
          });
          uninterruptedSpeechMsRef.current = 0;
        }

        if (now - lastUiUpdateRef.current > 180) {
          setVolume(volumePercent);
          setPace(currentPace);
          lastUiUpdateRef.current = now;
        }

        audioAnimationRef.current = requestAnimationFrame(analyse);
      };

      audioAnimationRef.current = requestAnimationFrame(analyse);
    },
    [emitSuggestion],
  );

  const createFaceLandmarker = useCallback(async () => {
    const vision = await FilesetResolver.forVisionTasks("/mediapipe");
    const options = {
      baseOptions: {
        modelAssetPath: "/models/face_landmarker.task",
        delegate: "GPU" as const,
      },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    };

    try {
      return await FaceLandmarker.createFromOptions(vision, options);
    } catch {
      return FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: "/models/face_landmarker.task",
          delegate: "CPU",
        },
      });
    }
  }, []);

  const startVisionAnalysis = useCallback(async () => {
    try {
      const landmarker = await createFaceLandmarker();
      if (!isRecordingRef.current) {
        landmarker.close();
        return;
      }
      faceLandmarkerRef.current = landmarker;
      setVisionStatus("视觉分析已就绪");

      const analyseVision = () => {
        if (!isRecordingRef.current) return;
        const video = videoRef.current;
        const now = performance.now();

        if (
          video &&
          video.readyState >= 2 &&
          now - lastVisionRunRef.current > 110
        ) {
          lastVisionRunRef.current = now;
          const result = landmarker.detectForVideo(video, now);
          const landmarks = result.faceLandmarks[0];

          if (!landmarks) {
            if (!noFaceSinceRef.current) noFaceSinceRef.current = now;
            if (now - noFaceSinceRef.current > 1800) {
              emitSuggestion({
                id: "face-missing",
                eyebrow: "构图",
                text: "回到画面中央，我在这里等你",
                priority: 100,
              });
            }
            setVisionStatus("未检测到人脸");
          } else {
            noFaceSinceRef.current = 0;
            setVisionStatus("视觉分析已就绪");

            const xs = landmarks.map((landmark) => landmark.x);
            const ys = landmarks.map((landmark) => landmark.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const faceWidth = Math.max(0.001, maxX - minX);
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const nose = landmarks[1];
            const leftCheek = landmarks[234];
            const rightCheek = landmarks[454];
            const cheekMid = (leftCheek.x + rightCheek.x) / 2;
            const yawProxy = Math.abs((nose.x - cheekMid) / faceWidth);
            const centered =
              centerX > 0.31 && centerX < 0.69 && centerY > 0.28 && centerY < 0.67;
            const closeEnough = faceWidth > 0.18;
            const facingCamera = yawProxy < 0.055;
            const aligned = centered && closeEnough && facingCamera;

            const gazeWindow = gazeWindowRef.current;
            gazeWindow.push(aligned);
            if (gazeWindow.length > 45) gazeWindow.shift();
            const alignedFrames = gazeWindow.filter(Boolean).length;
            setEyeContact(Math.round((alignedFrames / gazeWindow.length) * 100));

            if (!centered || !closeEnough) {
              if (!offCameraSinceRef.current) offCameraSinceRef.current = now;
              if (now - offCameraSinceRef.current > 2500) {
                emitSuggestion({
                  id: "framing",
                  eyebrow: "构图",
                  text: closeEnough ? "把自己放回画面中央" : "稍微靠近镜头一些",
                  priority: 90,
                });
              }
            } else if (!facingCamera) {
              if (!offCameraSinceRef.current) offCameraSinceRef.current = now;
              if (now - offCameraSinceRef.current > 2600) {
                emitSuggestion({
                  id: "eye-contact",
                  eyebrow: "互动感",
                  text: "请注视镜头，和观众建立连接",
                  priority: 72,
                });
              }
            } else {
              offCameraSinceRef.current = 0;
            }
          }
        }

        visionAnimationRef.current = requestAnimationFrame(analyseVision);
      };

      visionAnimationRef.current = requestAnimationFrame(analyseVision);
    } catch {
      setVisionStatus("视觉分析不可用");
    }
  }, [createFaceLandmarker, emitSuggestion]);

  const cleanupLiveResources = useCallback(() => {
    isRecordingRef.current = false;
    if (audioAnimationRef.current) cancelAnimationFrame(audioAnimationRef.current);
    if (visionAnimationRef.current) cancelAnimationFrame(visionAnimationRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    faceLandmarkerRef.current?.close();
    faceLandmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("当前浏览器不支持摄像头录制，请使用最新版 Chrome 或 Edge。");
      setPhase("error");
      return;
    }

    setPhase("preparing");
    resetMetrics();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      const preferredMimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mimeType = preferredMimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        setRecordingUrl(URL.createObjectURL(blob));
      };
      recorder.start(1000);
      recorderRef.current = recorder;

      isRecordingRef.current = true;
      startedAtRef.current = Date.now();
      setPhase("recording");
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);

      void startAudioAnalysis(stream);
      void startVisionAnalysis();
      startSpeechRecognition();
    } catch (error) {
      cleanupLiveResources();
      const permissionDenied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      setErrorMessage(
        permissionDenied
          ? "需要摄像头和麦克风权限才能开始训练。你可以在浏览器地址栏重新授权。"
          : "设备连接失败，请确认摄像头和麦克风没有被其他应用占用。",
      );
      setPhase("error");
    }
  }, [
    cleanupLiveResources,
    recordingUrl,
    resetMetrics,
    startAudioAnalysis,
    startSpeechRecognition,
    startVisionAnalysis,
  ]);

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    cleanupLiveResources();
    setPhase("complete");
  }, [cleanupLiveResources]);

  useEffect(() => {
    return () => {
      cleanupLiveResources();
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [cleanupLiveResources, recordingUrl]);

  const volumeLabel =
    volume >= 58 ? "清晰有力" : volume >= 20 ? "音量良好" : volume > 0 ? "偏轻" : "等待声音";
  const paceLabel = pace > 0 ? `${pace}` : "—";
  const eyeContactLabel = visionStatus === "视觉分析已就绪" ? `${eyeContact}%` : "—";
  const activePrompt = suggestion ?? {
    id: "steady",
    eyebrow: phase === "recording" ? "状态稳定" : "准备就绪",
    text: phase === "recording" ? "继续保持，自然表达" : "实时看见，更好表达",
    priority: 0,
  };

  const sessionScore = useMemo(() => {
    if (!elapsedSeconds) return 0;
    const pacePenalty = pace > 310 ? 18 : pace > 285 ? 8 : pace > 0 && pace < 150 ? 8 : 0;
    const eyePenalty = eyeContact > 0 ? Math.max(0, Math.round((70 - eyeContact) * 0.35)) : 8;
    const pauseBonus = Math.min(6, pauseCount * 2);
    return clamp(88 - pacePenalty - eyePenalty + pauseBonus, 55, 98);
  }, [elapsedSeconds, eyeContact, pace, pauseCount]);

  const summaryTip =
    eyeContact > 0 && eyeContact < 65
      ? "下一次把目光落在镜头附近，每句话结束时停留一秒。"
      : pace > 290
        ? "下一次把重点句放慢，并在观点之间留半秒空白。"
        : pauseCount < Math.max(1, Math.floor(elapsedSeconds / 40))
          ? "表达已经很稳定，再增加两三个有意识的停顿会更有力量。"
          : "节奏和镜头感都很稳定，可以继续练习更丰富的语气变化。";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="镜语首页">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>镜语</strong>
            <small>REAL-TIME SPEAKING COACH</small>
          </span>
        </a>
        <div className="privacy-note">
          <span className="privacy-dot" aria-hidden="true" />
          本地录制 · 不上传视频
        </div>
      </header>

      <section className="workspace" id="top" aria-live="polite">
        {phase !== "complete" ? (
          <>
            <div className={`camera-stage ${phase === "recording" ? "is-live" : ""}`}>
              <video
                ref={videoRef}
                className="camera-feed"
                muted
                playsInline
                aria-label="摄像头实时画面"
              />
              <div className="ambient-light" aria-hidden="true" />
              <div className="frame-guide" aria-hidden="true">
                <i className="corner corner-tl" />
                <i className="corner corner-tr" />
                <i className="corner corner-bl" />
                <i className="corner corner-br" />
              </div>

              {phase === "recording" && (
                <>
                  <div className="recording-status">
                    <span className="recording-dot" aria-hidden="true" />
                    REC
                    <time>{formatTime(elapsedSeconds)}</time>
                  </div>
                  <div className="lens-anchor" aria-hidden="true">
                    <span />
                  </div>
                  <div className={`coach-prompt ${suggestion ? "is-alert" : ""}`}>
                    <span className="coach-icon" aria-hidden="true">
                      {suggestion?.id === "pace-fast" ? "↘" : "•"}
                    </span>
                    <span>
                      <small>{activePrompt.eyebrow}</small>
                      <strong>{activePrompt.text}</strong>
                    </span>
                  </div>
                </>
              )}

              {(phase === "idle" || phase === "preparing" || phase === "error") && (
                <div className="welcome-panel">
                  <span className="welcome-kicker">PRIVATE PRACTICE STUDIO</span>
                  <h1>让每一次表达<br />都更有分量</h1>
                  <p>开启摄像头后，镜语会在录制过程中观察节奏、音量和镜头感，只在真正需要时给出一条建议。</p>
                  {phase === "error" && <div className="error-message">{errorMessage}</div>}
                  <button
                    className="primary-button"
                    type="button"
                    onClick={startRecording}
                    disabled={phase === "preparing"}
                  >
                    <span className="button-record-icon" aria-hidden="true" />
                    {phase === "preparing" ? "正在连接设备…" : phase === "error" ? "重新连接" : "开始练习"}
                  </button>
                  <small className="permission-copy">点击后将请求摄像头和麦克风权限</small>
                </div>
              )}

              {phase === "recording" && (
                <div className="metrics-hud">
                  <div className="metric-card">
                    <span>语速 <em>{speechStatus === "声学估算" ? "估算" : "实时"}</em></span>
                    <strong>{paceLabel}<small>字/分</small></strong>
                    <i className={`metric-signal ${pace > 295 ? "warn" : "good"}`} />
                  </div>
                  <div className="metric-card">
                    <span>镜头注视</span>
                    <strong>{eyeContactLabel}</strong>
                    <i className={`metric-signal ${eyeContact > 68 ? "good" : "warn"}`} />
                  </div>
                  <div className="metric-card volume-card">
                    <span>声音</span>
                    <strong>{volumeLabel}</strong>
                    <div className="volume-bars" aria-label={`当前音量 ${volume}%`}>
                      {Array.from({ length: 8 }, (_, index) => (
                        <i key={index} className={volume >= (index + 1) * 11 ? "active" : ""} />
                      ))}
                    </div>
                  </div>
                  <div className="metric-card">
                    <span>有效停顿</span>
                    <strong>{pauseCount}<small>次</small></strong>
                    <i className="metric-signal good" />
                  </div>
                </div>
              )}
            </div>

            {phase === "recording" ? (
              <div className="session-controls">
                <div className="analysis-status">
                  <span>{visionStatus}</span>
                  <span>{speechStatus}</span>
                </div>
                <button className="stop-button" type="button" onClick={stopRecording}>
                  <span aria-hidden="true" />
                  结束录制
                </button>
                <p>最多同时显示一条建议，同类建议 22 秒内不会重复。</p>
              </div>
            ) : (
              <div className="feature-strip" aria-label="实时分析能力">
                <span>语速与停顿</span>
                <span>音量状态</span>
                <span>镜头注视</span>
                <span>画面构图</span>
              </div>
            )}
          </>
        ) : (
          <section className="summary-panel">
            <div className="summary-heading">
              <span className="welcome-kicker">SESSION COMPLETE</span>
              <h1>这次表达，<br />已经被你稳稳接住。</h1>
              <p>{summaryTip}</p>
            </div>
            <div className="score-card">
              <div className="score-ring" style={{ "--score": `${sessionScore * 3.6}deg` } as React.CSSProperties}>
                <span>{sessionScore}</span>
                <small>综合表现</small>
              </div>
              <div className="summary-metrics">
                <div><span>练习时长</span><strong>{formatTime(elapsedSeconds)}</strong></div>
                <div><span>平均语速</span><strong>{pace || "—"}<small> 字/分</small></strong></div>
                <div><span>镜头注视</span><strong>{eyeContact || "—"}{eyeContact ? "%" : ""}</strong></div>
                <div><span>有效停顿</span><strong>{pauseCount}<small> 次</small></strong></div>
              </div>
            </div>
            <div className="event-review">
              <span>本次实时提醒</span>
              {coachEvents.length ? (
                <ul>
                  {coachEvents.slice().reverse().map((event, index) => (
                    <li key={`${event.id}-${event.at}`}>
                      <time>{formatTime(Math.max(0, Math.round((event.at - startedAtRef.current) / 1000)))}</time>
                      <strong>{event.text}</strong>
                      <span>{index === coachEvents.length - 1 ? "最后一次" : event.eyebrow}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>这一轮没有触发明显问题，整体状态很稳定。</p>
              )}
            </div>
            <div className="summary-actions">
              {recordingUrl && (
                <a className="secondary-button" href={recordingUrl} download={`镜语练习-${Date.now()}.webm`}>
                  下载本次录制
                </a>
              )}
              <button className="primary-button" type="button" onClick={startRecording}>
                再练一次
              </button>
            </div>
          </section>
        )}
      </section>

      <footer>
        <span>镜语 Speaking Coach · MVP</span>
        <span>录制文件仅保留在当前浏览器会话</span>
      </footer>
    </main>
  );
}
