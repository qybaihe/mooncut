import SwiftUI

/// 沉浸口播台：中间真实前摄画面 + 底部提词 + 顶部/中部实时指标 HUD（对齐 Web coach-metrics-hud）。
/// 指标仅来自 Speech / 麦克风 RMS / Vision 面部估算；不可用时诚实标注。
struct TeleprompterView: View {
    @Bindable var model: RecordStudioViewModel
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @StateObject private var recorder = CameraRecorder()
    @StateObject private var speech = SpeechCoachEngine()
    @StateObject private var vision = VisionFaceMetrics()
    @AppStorage("mooncut:promptFontSize") private var fontSize = 30.0
    @AppStorage("mooncut:promptSpeed") private var scrollSpeed = 3.0
    @State private var countdown: Int?
    @State private var countdownTask: Task<Void, Never>?
    @State private var showsSettings = false
    @State private var coachAdvice: String = "看镜头，按自己的节奏开始。"
    @State private var coachCategory: String? = "steady"
    @State private var coachPositive = true
    @State private var coachModel: String?
    @State private var coachConnected = true
    @State private var coachAnalyzing = false
    @State private var lastAdvice: String?
    @State private var coachTask: Task<Void, Never>?
    @State private var lastCoachFingerprint = ""
    @State private var isPracticeOnly = false
    @State private var coachingActive = false

    private var currentSentence: Int {
        // 优先用转写字数推进；否则按时间节奏
        let sentences = model.sentences
        guard !sentences.isEmpty else { return 0 }
        if speech.metrics.wordCount > 0 {
            var cumulative = 0
            let spoken = speech.metrics.wordCount
            for (index, sentence) in sentences.enumerated() {
                cumulative += max(1, sentence.filter { !$0.isWhitespace }.count / 2)
                if spoken < cumulative { return index }
            }
            return sentences.count - 1
        }
        let interval = max(3, 9 - Int(scrollSpeed.rounded()))
        return min(sentences.count - 1, recorder.elapsedTime / interval)
    }

    private var metricItems: [CoachMetricDisplay] {
        var m = speech.metrics
        m.faceOrientationScore = vision.faceOrientationScore
        m.isVisionAvailable = vision.isAvailable
        m.facePresent = vision.facePresent
        m.visionStatus = vision.statusMessage
        return CoachMetricDisplay.build(
            from: m,
            faceScore: vision.faceOrientationScore,
            faceAvailable: vision.isAvailable
        )
    }

    private var previousSentence: String? {
        let i = currentSentence
        guard i > 0, model.sentences.indices.contains(i - 1) else { return nil }
        return model.sentences[i - 1]
    }

    private var currentSentenceText: String {
        model.sentences.indices.contains(currentSentence) ? model.sentences[currentSentence] : model.draft
    }

    private var nextSentence: String? {
        let i = currentSentence + 1
        guard model.sentences.indices.contains(i) else { return nil }
        return model.sentences[i]
    }

    var body: some View {
        ZStack {
            cameraLayer
            vignette
            contentStack

            if let countdown {
                countdownOverlay(countdown)
            }

            if !recorder.canRecord && recorder.availability != .preparing {
                permissionOverlay
            }
        }
        .statusBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .task {
            env.isImmersiveTeleprompter = true
            await recorder.prepare()
            await speech.prepare()
            if recorder.canRecord {
                vision.attach(to: recorder.captureSession)
            }
            env.pet.apply(.coachListening)
            env.pet.apply(.petMessage("准备好了就开口，我在旁边听着。"))
        }
        .onDisappear {
            teardown()
        }
        .onChange(of: vision.facePresent) { _, present in
            guard coachingActive else { return }
            if !present {
                env.pet.apply(.coachOffCamera)
            } else if speech.metrics.volume < 0.12, speech.metrics.wordCount > 0 {
                env.pet.apply(.coachLowVolume)
            } else {
                env.pet.apply(.coachListening)
            }
        }
        .onChange(of: speech.metrics.volume) { _, vol in
            guard coachingActive, speech.metrics.wordCount > 0 else { return }
            if vol < 0.10 {
                env.pet.apply(.coachLowVolume)
            }
        }
        .sheet(isPresented: $showsSettings) {
            settingsSheet
                .presentationDetents([.height(380)])
        }
        .accessibilityIdentifier("teleprompter-screen")
    }

    // MARK: - Layers

    private var cameraLayer: some View {
        Group {
            if recorder.canRecord {
                CameraPreview(recorder: recorder)
                    .ignoresSafeArea()
            } else {
                ZStack {
                    Color.black
                    EmptyPersonArtwork(large: true)
                }
                .ignoresSafeArea()
            }
        }
    }

    private var vignette: some View {
        LinearGradient(
            colors: [.black.opacity(0.55), .clear, .clear, .black.opacity(0.78)],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private var contentStack: some View {
        VStack(spacing: 0) {
            topBar
            if coachingActive {
                CoachMetricsHUD(items: metricItems, compact: true)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            } else {
                idleHintBar
                    .padding(.top, 8)
            }

            Spacer(minLength: 8)

            if coachingActive {
                CoachScriptRibbon(
                    previous: previousSentence,
                    current: currentSentenceText,
                    next: nextSentence,
                    speechStatus: speech.metrics.speechStatus
                )
                .padding(.bottom, 8)

                CoachASRCaption(text: speech.metrics.partialTranscript)
                    .padding(.bottom, 8)

                HStack(alignment: .bottom, spacing: 10) {
                    CoachAdviceBanner(
                        advice: coachAdvice,
                        category: coachCategory,
                        positive: coachPositive,
                        model: coachModel,
                        analyzing: coachAnalyzing,
                        disconnected: !coachConnected
                    )
                    PetCompanionView(
                        store: env.pet,
                        compact: true,
                        showsBubble: false,
                        forceHideBubble: true
                    )
                    .frame(width: 56, height: 64)
                }
                .padding(.bottom, 8)
            } else {
                idleScriptPreview
                    .padding(.bottom, 12)
            }

            controls
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 10)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.28), value: coachingActive)
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button {
                teardown()
                model.leaveTeleprompter()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(.white.opacity(0.12)))
            }
            .accessibilityLabel("退出提词")
            .accessibilityIdentifier("teleprompter-exit")

            VStack(alignment: .leading, spacing: 2) {
                Text(coachingActive ? "实时陪练" : "提词录制")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                Text(statusLine)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.55))
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if recorder.recordingState == .recording || recorder.recordingState == .paused {
                StatusPill(
                    text: "REC \(MediaFormatters.duration(Double(recorder.elapsedTime)))",
                    symbol: "record.circle.fill",
                    tint: .red
                )
            }

            Button {
                showsSettings = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(.white.opacity(0.12)))
            }
            .accessibilityLabel("提词设置")
        }
        .padding(.top, 6)
    }

    private var statusLine: String {
        if coachingActive {
            return "\(vision.statusMessage) · \(speech.metrics.speechStatus)"
        }
        if case .preparing = recorder.availability { return "正在连接相机…" }
        if recorder.canRecord { return "看镜头，慢慢说。准备好后开始。" }
        return "需要相机与麦克风权限"
    }

    private var idleHintBar: some View {
        HStack(spacing: 8) {
            Label("Speech", systemImage: speech.metrics.isSpeechAvailable ? "checkmark.circle.fill" : "xmark.circle")
            Label("Vision", systemImage: vision.isAvailable ? "checkmark.circle.fill" : "xmark.circle")
            Label("Camera", systemImage: recorder.canRecord ? "checkmark.circle.fill" : "xmark.circle")
            Spacer()
            Text("开始后显示实时指标")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.5))
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.white.opacity(0.7))
        .padding(10)
        .background(.ultraThinMaterial.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
        .environment(\.colorScheme, .dark)
    }

    private var idleScriptPreview: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("提词预览")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white.opacity(0.55))
            ScrollView {
                Text(model.draft)
                    .font(.system(size: fontSize * 0.85, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 160)
        }
        .padding(14)
        .background(.black.opacity(0.4), in: RoundedRectangle(cornerRadius: 16))
    }

    private var controls: some View {
        HStack(spacing: 16) {
            Button {
                recorder.toggleMirroring()
            } label: {
                Image(systemName: "arrow.left.and.right.righttriangle.left.righttriangle.right")
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(.white.opacity(0.12)))
            }
            .accessibilityLabel("镜像")
            .disabled(!recorder.canRecord || recorder.recordingState != .idle)

            if coachingActive {
                // 停止
                Button {
                    Task { await stopSession() }
                } label: {
                    Circle()
                        .stroke(.white, lineWidth: 4)
                        .frame(width: 74, height: 74)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.red)
                                .frame(width: 28, height: 28)
                        )
                }
                .accessibilityLabel("结束")
                .accessibilityIdentifier("teleprompter-record")

                Button {
                    togglePause()
                } label: {
                    Image(systemName: recorder.recordingState == .paused || (isPracticeOnly && !speech.isRunning)
                          ? "play.fill" : "pause.fill")
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(Circle().fill(.white.opacity(0.12)))
                }
                .accessibilityLabel("暂停或继续")
            } else {
                // 只陪练
                Button {
                    Task { await startPractice() }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "ear")
                            .font(.system(size: 18, weight: .semibold))
                        Text("只陪练")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 56)
                }
                .accessibilityLabel("只陪练不录制")
                .disabled(!speech.metrics.isSpeechAvailable && !recorder.canRecord)

                // 录制 + 陪练
                Button {
                    Task { await startRecordingSession() }
                } label: {
                    Circle()
                        .stroke(.white, lineWidth: 4)
                        .frame(width: 74, height: 74)
                        .overlay(Circle().fill(.white).frame(width: 58, height: 58))
                }
                .disabled(!recorder.canRecord)
                .accessibilityLabel("开始录制并陪练")
                .accessibilityIdentifier("teleprompter-record")

                Color.clear.frame(width: 48, height: 48)
            }
        }
        .padding(.vertical, 6)
    }

    private func countdownOverlay(_ value: Int) -> some View {
        ZStack {
            Color.black.opacity(0.46).ignoresSafeArea()
            Text(value == 0 ? "开始" : "\(value)")
                .font(.system(size: value == 0 ? 54 : 86, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .contentTransition(.numericText())
        }
    }

    private var permissionOverlay: some View {
        VStack(spacing: 14) {
            Image(systemName: "camera.fill")
                .font(.largeTitle)
                .foregroundStyle(.white)
            Text(permissionMessage)
                .font(.subheadline)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text("实时语速依赖 Speech；镜头朝向依赖 Vision 面部检测。未授权时不会伪造指标。")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.65))
                .multilineTextAlignment(.center)
            Button("打开系统设置") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            Button("退出") {
                teardown()
                model.leaveTeleprompter()
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(24)
        .accessibilityIdentifier("teleprompter-permission")
    }

    private var permissionMessage: String {
        switch recorder.availability {
        case .denied(let message), .unavailable(let message):
            return message
        case .preparing:
            return "正在准备相机…"
        case .ready:
            return ""
        }
    }

    private var settingsSheet: some View {
        NavigationStack {
            Form {
                Section("提词") {
                    Slider(value: $fontSize, in: 22...44, step: 1) { Text("字号") }
                    Slider(value: $scrollSpeed, in: 1...6, step: 1) { Text("节奏") }
                }
                Section("系统能力") {
                    LabeledContent("Speech") {
                        Text(speech.metrics.isSpeechAvailable ? "可用" : "不可用")
                    }
                    LabeledContent("Vision 面部") {
                        Text(vision.isAvailable ? "可用" : "不可用")
                    }
                    LabeledContent("前摄录制") {
                        Text(recorder.canRecord ? "可用" : "不可用")
                    }
                }
                Section("说明") {
                    Text("语速/词量/停顿来自 SFSpeechRecognizer 与时间线；音量来自麦克风 RMS；镜头朝向来自 VNDetectFaceLandmarksRequest 的 yaw/roll/框位置估算，不是精确眼神接触率。")
                        .font(.caption)
                }
            }
            .navigationTitle("陪练设置")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Session

    private func startPractice() async {
        isPracticeOnly = true
        coachingActive = true
        env.pet.apply(.coachListening)
        do {
            try speech.start()
        } catch {
            coachAdvice = "语音识别未能启动：\(error.localizedDescription)"
            coachPositive = false
            coachConnected = false
        }
        scheduleCoachLoop()
    }

    private func startRecordingSession() async {
        isPracticeOnly = false
        countdownTask?.cancel()
        for value in [3, 2, 1, 0] {
            countdown = value
            try? await Task.sleep(nanoseconds: 450_000_000)
        }
        countdown = nil
        guard recorder.canRecord else { return }
        recorder.startRecording()
        coachingActive = true
        env.pet.apply(.recording)
        do {
            try speech.start()
        } catch {
            coachAdvice = "已开始录像。语音识别未能启动，指标将标为不可用。"
            coachPositive = false
        }
        scheduleCoachLoop()
    }

    private func togglePause() {
        if isPracticeOnly {
            if speech.isRunning {
                speech.stop()
                env.pet.apply(.coachReview)
            } else {
                try? speech.start()
                env.pet.apply(.coachListening)
            }
            return
        }
        if recorder.recordingState == .recording {
            recorder.pauseRecording()
            speech.stop()
            env.pet.apply(.coachReview)
        } else if recorder.recordingState == .paused {
            recorder.resumeRecording()
            try? speech.start()
            env.pet.apply(.recording)
        }
    }

    private func stopSession() async {
        coachTask?.cancel()
        speech.stop()
        coachingActive = false
        if isPracticeOnly {
            env.pet.apply(.coachReview)
            env.pet.apply(.petMessage("陪练先告一段落，需要的话我们再来一轮。"))
            isPracticeOnly = false
            return
        }
        let url = await recorder.finishRecording()
        model.beginReview(url: url, duration: recorder.elapsedTime)
    }

    private func scheduleCoachLoop() {
        coachTask?.cancel()
        coachTask = Task {
            while !Task.isCancelled, coachingActive {
                await requestCoachIfNeeded()
                syncPetFromMetrics()
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }

    private func syncPetFromMetrics() {
        if vision.isAvailable && !vision.facePresent {
            env.pet.apply(.coachOffCamera)
            return
        }
        if speech.metrics.isMicrophoneActive && speech.metrics.volume < 0.1 && speech.metrics.wordCount > 3 {
            env.pet.apply(.coachLowVolume)
            return
        }
        if coachAnalyzing {
            env.pet.apply(.coachAnalyzing)
            return
        }
        env.pet.apply(isPracticeOnly ? .coachListening : .recording)
    }

    private func requestCoachIfNeeded() async {
        let m = speech.metrics
        guard m.isSpeechAvailable || m.wordCount > 0 else { return }
        let fingerprint = "\(m.wordCount)-\(Int(m.pace))-\(m.pauseCount)-\(currentSentence)-\(vision.facePresent)"
        guard fingerprint != lastCoachFingerprint else { return }
        lastCoachFingerprint = fingerprint

        coachAnalyzing = true
        env.pet.apply(.coachAnalyzing)
        defer { coachAnalyzing = false }

        let payload = CoachAdviceRequest(
            transcript: m.partialTranscript,
            currentScript: model.draft,
            currentSentence: currentSentenceText,
            lastAdvice: lastAdvice,
            metrics: CoachMetricsDTO(
                pace: m.pace,
                wordCount: m.wordCount,
                volume: m.volume,
                pauseCount: m.pauseCount,
                eyeContact: vision.faceOrientationScore,
                elapsedSeconds: m.elapsedSeconds
            )
        )
        do {
            let response = try await env.api.coachAdvice(payload)
            coachAdvice = response.advice
            coachCategory = response.category
            coachPositive = response.positive ?? false
            coachModel = response.model
            lastAdvice = response.advice
            coachConnected = true
            if let pet = response.petMessage, !pet.isEmpty {
                env.pet.apply(.petMessage(pet))
            }
            if response.positive == true {
                env.pet.apply(.coachPositive)
            } else {
                env.pet.apply(.coachReview)
            }
        } catch {
            coachConnected = false
            // 保留本地事实指标；建议区标明教练未连接
            if coachAdvice.isEmpty || coachAdvice == "看镜头，按自己的节奏开始。" {
                coachAdvice = "教练暂时未连接。本地语速/音量/镜头指标仍来自真实采集。"
            }
            env.pet.apply(.permissionOrNetworkFailure)
        }
    }

    private func teardown() {
        countdownTask?.cancel()
        coachTask?.cancel()
        speech.stop()
        vision.detach()
        recorder.cancelRecording()
        recorder.stopPreview()
        coachingActive = false
        env.isImmersiveTeleprompter = false
    }
}
