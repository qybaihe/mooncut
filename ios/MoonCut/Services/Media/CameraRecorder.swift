@preconcurrency import AVFoundation
import Foundation

enum CameraAvailability: Equatable {
    case preparing
    case ready
    case denied(String)
    case unavailable(String)
}

enum CameraRecordingState: Equatable {
    case idle
    case recording
    case paused
    case finishing
}

/// 真实前摄录制。无权限时不会进入“演示录制”，也不生成假成片。
@MainActor
final class CameraRecorder: NSObject, ObservableObject {
    @Published private(set) var availability: CameraAvailability = .preparing
    @Published private(set) var recordingState: CameraRecordingState = .idle
    @Published private(set) var elapsedTime = 0
    @Published private(set) var outputURL: URL?
    @Published var isMirrored = true {
        didSet { updateMirroring() }
    }

    let captureSession = AVCaptureSession()

    private let movieOutput = AVCaptureMovieFileOutput()
    private let sessionQueue = DispatchQueue(label: "com.mooncut.camera.session", qos: .userInitiated)
    private var segmentURLs: [URL] = []
    private var elapsedTimer: Timer?
    private var finishContinuation: CheckedContinuation<URL?, Never>?
    private var pendingAction: PendingAction = .none
    private var isConfigured = false

    private enum PendingAction {
        case none
        case pause
        case finish
        case cancel
    }

    var canRecord: Bool {
        if case .ready = availability { return true }
        return false
    }

    func prepare() async {
        guard !isConfigured else {
            startSession()
            return
        }

        availability = .preparing
        let cameraAllowed = await requestPermission(for: .video)
        let microphoneAllowed = await requestPermission(for: .audio)

        guard cameraAllowed, microphoneAllowed else {
            let missing: String
            if !cameraAllowed && !microphoneAllowed {
                missing = "相机与麦克风权限未开启。请在系统设置中允许后返回 App。"
            } else if !cameraAllowed {
                missing = "相机权限未开启。请在系统设置中允许后返回 App。"
            } else {
                missing = "麦克风权限未开启。请在系统设置中允许后返回 App。"
            }
            availability = .denied(missing)
            return
        }

        do {
            try configureSession()
            isConfigured = true
            availability = .ready
            startSession()
        } catch {
            availability = .unavailable("镜头暂时不可用，无法进行真实录制。")
        }
    }

    func startRecording() {
        guard recordingState == .idle else { return }
        guard canRecord else { return }
        cleanupSegments()
        outputURL = nil
        elapsedTime = 0
        startNewSegment()
    }

    func pauseRecording() {
        guard recordingState == .recording else { return }
        stopTimer()
        guard canRecord else { return }
        pendingAction = .pause
        recordingState = .paused
        if movieOutput.isRecording { movieOutput.stopRecording() }
    }

    func resumeRecording() {
        guard recordingState == .paused else { return }
        guard canRecord else { return }
        startNewSegment()
    }

    func finishRecording() async -> URL? {
        stopTimer()
        guard canRecord else {
            recordingState = .idle
            return nil
        }

        recordingState = .finishing
        if movieOutput.isRecording {
            pendingAction = .finish
            return await withCheckedContinuation { continuation in
                finishContinuation = continuation
                movieOutput.stopRecording()
            }
        }

        let result = await mergeSegmentsIfNeeded()
        outputURL = result
        recordingState = .idle
        return result
    }

    func cancelRecording() {
        stopTimer()
        finishContinuation?.resume(returning: nil)
        finishContinuation = nil

        if movieOutput.isRecording {
            pendingAction = .cancel
            movieOutput.stopRecording()
        } else {
            cleanupSegments()
        }
        recordingState = .idle
        elapsedTime = 0
        outputURL = nil
    }

    func toggleMirroring() {
        guard recordingState == .idle else { return }
        isMirrored.toggle()
    }

    func stopPreview() {
        guard captureSession.isRunning else { return }
        let session = captureSession
        sessionQueue.async { session.stopRunning() }
    }

    private func requestPermission(for mediaType: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: mediaType) { granted in
                    continuation.resume(returning: granted)
                }
            }
        default:
            return false
        }
    }

    private func configureSession() throws {
        captureSession.beginConfiguration()
        defer { captureSession.commitConfiguration() }
        captureSession.sessionPreset = .high

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
            throw RecorderError.noCamera
        }
        let videoInput = try AVCaptureDeviceInput(device: camera)
        guard captureSession.canAddInput(videoInput) else { throw RecorderError.cannotAddInput }
        captureSession.addInput(videoInput)

        if let microphone = AVCaptureDevice.default(for: .audio) {
            let audioInput = try AVCaptureDeviceInput(device: microphone)
            if captureSession.canAddInput(audioInput) { captureSession.addInput(audioInput) }
        }

        guard captureSession.canAddOutput(movieOutput) else { throw RecorderError.cannotAddOutput }
        captureSession.addOutput(movieOutput)
        movieOutput.movieFragmentInterval = .invalid
        updateMirroring()
    }

    private func startSession() {
        guard isConfigured, !captureSession.isRunning else { return }
        let session = captureSession
        sessionQueue.async { session.startRunning() }
    }

    private func startNewSegment() {
        guard !movieOutput.isRecording else { return }
        pendingAction = .none
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("mooncut-segment-\(UUID().uuidString)")
            .appendingPathExtension("mov")

        if let connection = movieOutput.connection(with: .video) {
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = isMirrored
            }
        }

        movieOutput.startRecording(to: url, recordingDelegate: self)
        recordingState = .recording
        startTimer()
    }

    private func updateMirroring() {
        guard let connection = movieOutput.connection(with: .video), connection.isVideoMirroringSupported else { return }
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = isMirrored
    }

    private func startTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.elapsedTime += 1 }
        }
    }

    private func stopTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
    }

    private func handleFinishedSegment(url: URL, error: Error?) {
        if error == nil, FileManager.default.fileExists(atPath: url.path) {
            segmentURLs.append(url)
        } else {
            try? FileManager.default.removeItem(at: url)
        }

        let action = pendingAction
        pendingAction = .none
        switch action {
        case .pause:
            recordingState = .paused
        case .finish:
            Task { [weak self] in
                guard let self else { return }
                let result = await self.mergeSegmentsIfNeeded()
                self.outputURL = result
                self.recordingState = .idle
                self.finishContinuation?.resume(returning: result)
                self.finishContinuation = nil
            }
        case .cancel:
            cleanupSegments()
            recordingState = .idle
            outputURL = nil
        case .none:
            if recordingState == .recording { recordingState = .idle }
        }
    }

    private func mergeSegmentsIfNeeded() async -> URL? {
        guard !segmentURLs.isEmpty else { return nil }
        if segmentURLs.count == 1 { return segmentURLs[0] }

        let composition = AVMutableComposition()
        guard let compositionVideo = composition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else { return segmentURLs[0] }
        let compositionAudio = composition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
        )

        var cursor = CMTime.zero
        for url in segmentURLs {
            let asset = AVURLAsset(url: url)
            do {
                let duration = try await asset.load(.duration)
                if let video = try await asset.loadTracks(withMediaType: .video).first {
                    try compositionVideo.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: video, at: cursor)
                    if cursor == .zero { compositionVideo.preferredTransform = try await video.load(.preferredTransform) }
                }
                if let audio = try await asset.loadTracks(withMediaType: .audio).first {
                    try compositionAudio?.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: audio, at: cursor)
                }
                cursor = CMTimeAdd(cursor, duration)
            } catch {
                continue
            }
        }

        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("mooncut-recording-\(UUID().uuidString)")
            .appendingPathExtension("mov")
        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            return segmentURLs[0]
        }
        exporter.outputURL = destination
        exporter.outputFileType = .mov
        exporter.shouldOptimizeForNetworkUse = true

        await withCheckedContinuation { continuation in
            exporter.exportAsynchronously { continuation.resume() }
        }
        guard exporter.status == .completed else { return segmentURLs[0] }

        segmentURLs.forEach { try? FileManager.default.removeItem(at: $0) }
        segmentURLs = [destination]
        return destination
    }

    private func cleanupSegments() {
        segmentURLs.forEach { try? FileManager.default.removeItem(at: $0) }
        segmentURLs.removeAll()
    }

    private enum RecorderError: Error {
        case noCamera
        case cannotAddInput
        case cannotAddOutput
    }

    deinit {
        elapsedTimer?.invalidate()
    }
}

extension CameraRecorder: AVCaptureFileOutputRecordingDelegate {
    nonisolated func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            self?.handleFinishedSegment(url: outputFileURL, error: error)
        }
    }
}
