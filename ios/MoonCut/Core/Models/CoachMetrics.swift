import Foundation

/// 仅由系统 Speech / 音频采样 / Vision 真实采集填充；nil 或 isAvailable=false 表示不可用，不填假数。
struct LiveCoachMetrics: Equatable, Sendable {
    var pace: Double = 0
    var wordCount: Int = 0
    var volume: Double = 0
    var pauseCount: Int = 0
    /// 镜头朝向估算 0...1；nil = Vision 未给出可靠值
    var faceOrientationScore: Double?
    var facePresent: Bool = false
    var elapsedSeconds: Double = 0
    var partialTranscript: String = ""
    var isSpeechAvailable: Bool = false
    var isVisionAvailable: Bool = false
    var isMicrophoneActive: Bool = false
    var speechStatus: String = "等待语音识别"
    var visionStatus: String = "等待视觉分析"
}

enum CoachMetricKind: String, CaseIterable, Identifiable {
    case pace
    case words
    case volume
    case pause
    case face

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pace: "语速"
        case .words: "词量"
        case .volume: "音量"
        case .pause: "停顿"
        case .face: "镜头朝向"
        }
    }

    var unit: String {
        switch self {
        case .pace: "字/分"
        case .words: "字"
        case .volume: "%"
        case .pause: "次"
        case .face: "估算"
        }
    }

    var symbol: String {
        switch self {
        case .pace: "gauge.with.dots.needle.67percent"
        case .words: "textformat.abc"
        case .volume: "speaker.wave.2.fill"
        case .pause: "pause.circle"
        case .face: "face.smiling"
        }
    }
}

struct CoachMetricDisplay: Equatable {
    let kind: CoachMetricKind
    let valueText: String
    let detail: String
    let isWarning: Bool
    let isUnavailable: Bool
    let volumeLevel: Double?

    static func build(from metrics: LiveCoachMetrics, faceScore: Double?, faceAvailable: Bool) -> [CoachMetricDisplay] {
        let paceWarn = metrics.isSpeechAvailable && metrics.pace > 295
        let faceVal = faceScore
        let faceWarn = faceAvailable && (faceVal ?? 0) > 0 && (faceVal ?? 0) < 0.55

        return [
            CoachMetricDisplay(
                kind: .pace,
                valueText: metrics.isSpeechAvailable && metrics.isMicrophoneActive
                    ? "\(Int(metrics.pace.rounded()))"
                    : "—",
                detail: metrics.speechStatus,
                isWarning: paceWarn,
                isUnavailable: !metrics.isSpeechAvailable,
                volumeLevel: nil
            ),
            CoachMetricDisplay(
                kind: .words,
                valueText: metrics.isSpeechAvailable ? "\(metrics.wordCount)" : "—",
                detail: metrics.isSpeechAvailable ? "已识别字量" : "语音识别不可用",
                isWarning: false,
                isUnavailable: !metrics.isSpeechAvailable,
                volumeLevel: nil
            ),
            CoachMetricDisplay(
                kind: .volume,
                valueText: metrics.isMicrophoneActive
                    ? "\(Int((metrics.volume * 100).rounded()))"
                    : "—",
                detail: metrics.isMicrophoneActive ? "实时电平" : "麦克风未开启",
                isWarning: metrics.isMicrophoneActive && metrics.volume < 0.12 && metrics.wordCount > 0,
                isUnavailable: !metrics.isMicrophoneActive,
                volumeLevel: metrics.isMicrophoneActive ? metrics.volume : nil
            ),
            CoachMetricDisplay(
                kind: .pause,
                valueText: metrics.isSpeechAvailable ? "\(metrics.pauseCount)" : "—",
                detail: "有效停顿次数",
                isWarning: metrics.pauseCount >= 6,
                isUnavailable: !metrics.isSpeechAvailable,
                volumeLevel: nil
            ),
            CoachMetricDisplay(
                kind: .face,
                valueText: faceAvailable
                    ? (faceVal.map { "\(Int(($0 * 100).rounded()))" } ?? "—")
                    : "—",
                detail: faceAvailable ? "Vision 估算，非精确眼神率" : "视觉暂不可用",
                isWarning: faceWarn,
                isUnavailable: !faceAvailable,
                volumeLevel: nil
            )
        ]
    }
}
