@preconcurrency import AVFoundation
import Foundation
import QuartzCore
import Vision

/// 基于 Vision 的镜头朝向 / 面部在画估算。
/// - 使用 `VNDetectFaceLandmarksRequest`（系统内置，无需 MediaPipe）
/// - 产品文案必须是「镜头朝向（估算）」，不得声称精确「眼神接触率」
/// - 不可用时保持 nil / isAvailable=false，绝不捏造漂亮数字
/// - **节流在检测之前**：避免每帧跑 landmarks（耗电/发热）
@MainActor
final class VisionFaceMetrics: NSObject, ObservableObject {
    @Published private(set) var faceOrientationScore: Double?
    @Published private(set) var facePresent = false
    @Published private(set) var isAvailable = false
    @Published private(set) var statusMessage: String = "镜头朝向（估算）· 未启动"
    @Published private(set) var faceBoxNormalized: CGRect?

    private let videoOutput = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "com.mooncut.vision.face", qos: .userInitiated)
    private weak var session: AVCaptureSession?
    private var isAttached = false
    /// 上次真正执行检测的时间（在 queue 上读写）
    private nonisolated(unsafe) var lastDetectTime: CFTimeInterval = 0
    private let minInterval: CFTimeInterval = 0.20

    func attach(to session: AVCaptureSession) {
        guard !isAttached else { return }
        self.session = session
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.setSampleBufferDelegate(self, queue: queue)

        session.beginConfiguration()
        if session.canAddOutput(videoOutput) {
            session.addOutput(videoOutput)
            if let connection = videoOutput.connection(with: .video) {
                if connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90
                }
            }
            isAttached = true
            isAvailable = true
            statusMessage = "镜头朝向（估算）· 检测中"
        } else {
            isAvailable = false
            faceOrientationScore = nil
            facePresent = false
            statusMessage = "镜头朝向（估算）· 暂不可用（无法挂接视频输出）"
        }
        session.commitConfiguration()
    }

    func detach() {
        guard let session, isAttached else { return }
        session.beginConfiguration()
        session.removeOutput(videoOutput)
        session.commitConfiguration()
        isAttached = false
        faceOrientationScore = nil
        facePresent = false
        faceBoxNormalized = nil
        statusMessage = "镜头朝向（估算）· 已停止"
    }
}

extension VisionFaceMetrics: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        // 先节流，再跑昂贵的 landmarks
        let now = CACurrentMediaTime()
        if now - lastDetectTime < minInterval { return }
        lastDetectTime = now

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let request = VNDetectFaceLandmarksRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .leftMirrored, options: [:])
        do {
            try handler.perform([request])
            let faces = request.results ?? []
            Task { @MainActor in
                self.ingest(faces: faces)
            }
        } catch {
            Task { @MainActor in
                self.isAvailable = false
                self.faceOrientationScore = nil
                self.facePresent = false
                self.faceBoxNormalized = nil
                self.statusMessage = "镜头朝向（估算）· 暂不可用"
            }
        }
    }

    @MainActor
    private func ingest(faces: [VNFaceObservation]) {
        guard let face = faces.max(by: { $0.confidence < $1.confidence }) else {
            facePresent = false
            faceOrientationScore = 0
            faceBoxNormalized = nil
            isAvailable = true
            statusMessage = "镜头朝向（估算）· 未检测到面部"
            return
        }

        facePresent = true
        faceBoxNormalized = face.boundingBox
        isAvailable = true

        let yaw = abs(Double(truncating: face.yaw ?? 0))
        let roll = abs(Double(truncating: face.roll ?? 0))
        let yawScore = max(0, 1 - yaw / 0.75)
        let rollScore = max(0, 1 - roll / 0.75)
        let bbox = face.boundingBox
        let centerScore = 1 - min(1, hypot(bbox.midX - 0.5, bbox.midY - 0.5) * 2.1)
        let area = bbox.width * bbox.height
        let sizeScore = area < 0.04 ? area / 0.04 : (area > 0.45 ? max(0.4, 1 - (area - 0.45)) : 1)
        let score = (yawScore * 0.42 + rollScore * 0.20 + centerScore * 0.28 + sizeScore * 0.10)
        faceOrientationScore = min(1, max(0, score))

        let pct = Int(((faceOrientationScore ?? 0) * 100).rounded())
        if pct >= 70 {
            statusMessage = "镜头朝向（估算）· 正对较好 \(pct)%"
        } else if pct >= 45 {
            statusMessage = "镜头朝向（估算）· 略偏 \(pct)%"
        } else {
            statusMessage = "镜头朝向（估算）· 请看向镜头 \(pct)%"
        }
    }
}
