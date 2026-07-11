@preconcurrency import AVFoundation
import Foundation
import Speech

/// 基于系统 Speech + 麦克风电平的真实口播指标。不得用计时器/随机数伪造。
@MainActor
final class SpeechCoachEngine: ObservableObject {
    @Published private(set) var metrics = LiveCoachMetrics()
    @Published private(set) var availabilityMessage: String?
    @Published private(set) var isRunning = false

    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var startDate: Date?
    private var lastSpeechDate: Date?
    private var lastWordCount = 0
    private var rmsSamples: [Float] = []
    private var recognizedTimeline: [(at: Date, count: Int)] = []

    func prepare() async {
        let speechStatus = await requestSpeechAuth()
        guard speechStatus else {
            metrics.isSpeechAvailable = false
            metrics.speechStatus = "语音识别权限不可用"
            availabilityMessage = "语音识别权限不可用。实时转写与语速将标记为不可用。"
            return
        }

        let locale = Locale(identifier: "zh-CN")
        recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer()
        guard let recognizer, recognizer.isAvailable else {
            metrics.isSpeechAvailable = false
            metrics.speechStatus = "当前设备不支持中文语音识别"
            availabilityMessage = "当前设备不支持中文语音识别。"
            return
        }
        metrics.isSpeechAvailable = true
        metrics.speechStatus = "语音识别已就绪"
        availabilityMessage = nil
    }

    /// 开始采集。注意：与 AVCapture 同时占用麦克风时，部分设备可能抢麦；失败时如实标不可用。
    func start() throws {
        stop()
        guard metrics.isSpeechAvailable, let recognizer else {
            throw CoachEngineError.speechUnavailable
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .videoRecording,
            options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers]
        )
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if #available(iOS 16, *), recognizer.supportsOnDeviceRecognition {
            // 优先可用即可，不强制 on-device（中文 on-device 可能不可用）
        }
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw CoachEngineError.speechUnavailable
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
            self?.consumeAudio(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()

        startDate = Date()
        lastSpeechDate = Date()
        lastWordCount = 0
        recognizedTimeline = []
        isRunning = true
        metrics.isMicrophoneActive = true
        metrics.elapsedSeconds = 0
        metrics.partialTranscript = ""
        metrics.pauseCount = 0
        metrics.wordCount = 0
        metrics.pace = 0
        metrics.volume = 0
        metrics.speechStatus = "实时识别中"

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.ingestTranscript(result.bestTranscription.formattedString, isFinal: result.isFinal)
                }
                if let error, self.isRunning {
                    self.metrics.speechStatus = "识别中断：\(error.localizedDescription)"
                }
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        isRunning = false
        metrics.isMicrophoneActive = false
        if metrics.isSpeechAvailable {
            metrics.speechStatus = "语音识别已暂停"
        }
    }

    private func ingestTranscript(_ text: String, isFinal: Bool) {
        metrics.partialTranscript = text
        // 中文按汉字近似「字」；英文按词
        let han = text.unicodeScalars.filter { (0x4E00...0x9FFF).contains($0.value) }.count
        let latinWords = text.split { $0.isWhitespace || $0.isNewline }.filter { word in
            word.unicodeScalars.contains { CharacterSet.letters.contains($0) }
        }.count
        let count = max(han, latinWords > 0 ? latinWords : text.filter { !$0.isWhitespace }.count / 2)
        metrics.wordCount = count

        let now = Date()
        let elapsed = max(0.5, now.timeIntervalSince(startDate ?? now))
        metrics.elapsedSeconds = elapsed

        recognizedTimeline.append((now, count))
        recognizedTimeline.removeAll { now.timeIntervalSince($0.at) > 12 }
        if let first = recognizedTimeline.first, recognizedTimeline.count >= 2 {
            let dt = max(0.8, now.timeIntervalSince(first.at))
            let dc = max(0, count - first.count)
            let instant = (Double(dc) / dt) * 60.0
            // 平滑
            metrics.pace = metrics.pace == 0 ? instant : metrics.pace * 0.65 + instant * 0.35
        } else {
            metrics.pace = (Double(count) / elapsed) * 60.0
        }

        if count > lastWordCount {
            lastSpeechDate = now
            lastWordCount = count
            metrics.speechStatus = isFinal ? "已确认一段话" : "正在听你说…"
        } else if let last = lastSpeechDate, now.timeIntervalSince(last) > 1.35, count > 0 {
            metrics.pauseCount += 1
            lastSpeechDate = now
            metrics.speechStatus = "检测到停顿"
        }

        if !rmsSamples.isEmpty {
            let avg = rmsSamples.reduce(0, +) / Float(rmsSamples.count)
            metrics.volume = Double(min(1, max(0, avg * 9)))
            rmsSamples.removeAll(keepingCapacity: true)
        }
    }

    private func consumeAudio(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return }
        var sum: Float = 0
        for i in 0..<frameCount {
            let s = channel[i]
            sum += s * s
        }
        let rms = sqrt(sum / Float(frameCount))
        Task { @MainActor in
            self.rmsSamples.append(rms)
            if self.rmsSamples.count > 24 { self.rmsSamples.removeFirst(self.rmsSamples.count - 24) }
            if self.isRunning, !self.rmsSamples.isEmpty {
                let avg = self.rmsSamples.reduce(0, +) / Float(self.rmsSamples.count)
                self.metrics.volume = Double(min(1, max(0, avg * 9)))
            }
        }
    }

    private func requestSpeechAuth() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    enum CoachEngineError: LocalizedError {
        case speechUnavailable
        var errorDescription: String? {
            "语音识别不可用，无法采集真实转写指标"
        }
    }
}
