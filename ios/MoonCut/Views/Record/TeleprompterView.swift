import SwiftUI

struct TeleprompterView: View {
    @ObservedObject var model: RecordStudioViewModel
    @StateObject private var recorder = CameraRecorder()
    @AppStorage("mooncut:promptFontSize") private var fontSize = 34.0
    @AppStorage("mooncut:promptSpeed") private var scrollSpeed = 3.0
    @State private var countdown: Int?
    @State private var countdownTask: Task<Void, Never>?
    @State private var showsSettings = false

    private var currentSentence: Int {
        let count = max(1, model.sentences.count)
        let interval = max(3, 9 - Int(scrollSpeed.rounded()))
        return min(count - 1, recorder.elapsedTime / interval)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if recorder.availability == .ready {
                CameraPreview(recorder: recorder)
                    .ignoresSafeArea()
            } else {
                EmptyPersonArtwork(large: true)
                    .ignoresSafeArea()
                    .background(
                        LinearGradient(
                            colors: [Color(red: 0.03, green: 0.05, blue: 0.09), Color.black],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }

            LinearGradient(
                colors: [.black.opacity(0.34), .clear, .black.opacity(0.76)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 24)
                promptCopy
                Spacer(minLength: 18)
                controls
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)

            if let countdown {
                ZStack {
                    Color.black.opacity(0.46).ignoresSafeArea()
                    Text(countdown == 0 ? "开始" : "\(countdown)")
                        .font(.system(size: countdown == 0 ? 54 : 86, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .contentTransition(.numericText())
                        .transition(.scale.combined(with: .opacity))
                }
                .accessibilityLabel(countdown == 0 ? "开始" : "倒计时 \(countdown)")
            }
        }
        .statusBarHidden(true)
        .task { await recorder.prepare() }
        .onDisappear {
            countdownTask?.cancel()
            recorder.cancelRecording()
            recorder.stopPreview()
        }
        .sheet(isPresented: $showsSettings) {
            settingsSheet
                .presentationDetents([.height(350)])
                .presentationDragIndicator(.visible)
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button {
                countdownTask?.cancel()
                recorder.cancelRecording()
                recorder.stopPreview()
                model.leaveTeleprompter()
            } label: {
                Label("返回", systemImage: "chevron.left")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(minWidth: 74, minHeight: 44)
                    .background(.black.opacity(0.36), in: Capsule())
            }
            .buttonStyle(.plain)

            Spacer()

            HStack(spacing: 7) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 7, height: 7)
                Text(statusText)
                    .font(.caption.weight(.semibold))
                    .contentTransition(.numericText())
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(minHeight: 38)
            .background(.black.opacity(0.36), in: Capsule())

            Button { showsSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.36), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("提词设置")
        }
        .padding(.top, 6)
    }

    private var promptCopy: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 18) {
                    ForEach(Array(model.sentences.enumerated()), id: \.offset) { index, sentence in
                        Text(sentence)
                            .font(.system(size: fontSize, weight: index == currentSentence ? .bold : .semibold, design: .rounded))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white.opacity(index == currentSentence ? 1 : index < currentSentence ? 0.24 : 0.42))
                            .scaleEffect(index == currentSentence ? 1 : 0.94)
                            .id(index)
                            .accessibilityAddTraits(index == currentSentence ? .isSelected : [])
                    }
                }
                .padding(.vertical, 110)
            }
            .scrollDisabled(true)
            .frame(maxHeight: 410)
            .mask(
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .white, location: 0.18),
                        .init(color: .white, location: 0.82),
                        .init(color: .clear, location: 1)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .onChange(of: currentSentence) { _, index in
                withAnimation(.easeInOut(duration: 0.38)) { proxy.scrollTo(index, anchor: .center) }
            }
        }
    }

    @ViewBuilder
    private var controls: some View {
        VStack(spacing: 10) {
            if case .fallback(let reason) = recorder.availability {
                Label("\(reason)，已进入演示录制", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.76))
                    .multilineTextAlignment(.center)
            }

            switch recorder.recordingState {
            case .idle:
                Button { startCountdown() } label: {
                    HStack(spacing: 10) {
                        ZStack {
                            Circle().fill(.white).frame(width: 30, height: 30)
                            Circle().fill(Color.red).frame(width: 20, height: 20)
                        }
                        Text(recorder.availability == .preparing ? "镜头连接中…" : "3 秒后开始录制")
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .background(.black.opacity(0.70), in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.12)))
                }
                .buttonStyle(.plain)
                .disabled(recorder.availability == .preparing || countdown != nil)
            case .recording, .paused:
                HStack(spacing: 10) {
                    Button {
                        recorder.recordingState == .recording ? recorder.pauseRecording() : recorder.resumeRecording()
                    } label: {
                        Label(
                            recorder.recordingState == .paused ? "继续" : "暂停",
                            systemImage: recorder.recordingState == .paused ? "play.fill" : "pause.fill"
                        )
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 18))
                    }
                    .buttonStyle(.plain)

                    Button { finish() } label: {
                        Label("完成", systemImage: "stop.fill")
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 58)
                            .background(Color.red.opacity(0.86), in: RoundedRectangle(cornerRadius: 18))
                    }
                    .buttonStyle(.plain)
                }
            case .finishing:
                HStack(spacing: 10) {
                    ProgressView().tint(.white)
                    Text("正在保存录制…").font(.headline)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 58)
                .background(.black.opacity(0.70), in: RoundedRectangle(cornerRadius: 18))
            }
        }
        .padding(12)
        .background(.ultraThinMaterial.opacity(0.72), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var settingsSheet: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VStack(spacing: 10) {
                    SettingRow(symbol: "textformat.size", title: "字号") {
                        Text("\(Int(fontSize))").font(.subheadline.monospacedDigit())
                    }
                    Slider(value: $fontSize, in: 26...46, step: 1).tint(MoonColor.accent)
                }
                .padding(.vertical, 12)
                Divider()
                VStack(spacing: 10) {
                    SettingRow(symbol: "gauge.medium", title: "滚动速度") {
                        Text("\(Int(scrollSpeed))").font(.subheadline.monospacedDigit())
                    }
                    Slider(value: $scrollSpeed, in: 1...5, step: 1).tint(MoonColor.accent)
                }
                .padding(.vertical, 12)
                Divider()
                Toggle(isOn: Binding(get: { recorder.isMirrored }, set: { _ in recorder.toggleMirroring() })) {
                    Label("镜像画面", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right")
                        .font(.subheadline.weight(.medium))
                }
                .tint(MoonColor.accent)
                .frame(minHeight: 54)
                .disabled(recorder.recordingState != .idle)
                Spacer()
            }
            .padding(.horizontal, 20)
            .navigationTitle("提词设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { showsSettings = false }
                }
            }
        }
    }

    private var statusText: String {
        switch recorder.recordingState {
        case .recording: "录制中 · \(clock(recorder.elapsedTime))"
        case .paused: "已暂停 · \(clock(recorder.elapsedTime))"
        case .finishing: "正在保存"
        case .idle:
            switch recorder.availability {
            case .preparing: "正在连接镜头"
            case .ready: "镜头已就绪"
            case .fallback: "演示镜头"
            }
        }
    }

    private var statusColor: Color {
        switch recorder.recordingState {
        case .recording: .red
        case .paused: MoonColor.warning
        case .finishing: MoonColor.accent
        case .idle: recorder.availability == .ready ? MoonColor.success : MoonColor.warning
        }
    }

    private func startCountdown() {
        countdownTask?.cancel()
        countdownTask = Task { @MainActor in
            for value in stride(from: 3, through: 0, by: -1) {
                guard !Task.isCancelled else { return }
                withAnimation(.spring(response: 0.34, dampingFraction: 0.76)) { countdown = value }
                try? await Task.sleep(nanoseconds: value == 0 ? 420_000_000 : 850_000_000)
            }
            guard !Task.isCancelled else { return }
            countdown = nil
            recorder.startRecording()
        }
    }

    private func finish() {
        let duration = recorder.elapsedTime
        Task {
            let url = await recorder.finishRecording()
            recorder.stopPreview()
            model.beginReview(url: url, duration: duration)
        }
    }

    private func clock(_ seconds: Int) -> String {
        String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

#Preview {
    TeleprompterView(model: RecordStudioViewModel())
}
