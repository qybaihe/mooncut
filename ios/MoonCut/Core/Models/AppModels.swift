import Foundation
import SwiftUI

// MARK: - Navigation

enum AppTab: String, CaseIterable, Identifiable, Hashable {
    case create
    case coach
    case jobs
    case community

    var id: String { rawValue }

    var title: String {
        switch self {
        case .create: "创作"
        case .coach: "陪练"
        case .jobs: "任务"
        case .community: "社区"
        }
    }

    var symbol: String {
        switch self {
        case .create: "wand.and.stars"
        case .coach: "mic.and.signal.meter"
        case .jobs: "list.bullet.rectangle"
        case .community: "person.3"
        }
    }
}

enum CreateDestination: Hashable {
    case edit
    case script
    case teleprompter
    case settings
}

// MARK: - Pet

enum PetAnimationState: Int, Hashable, Sendable {
    case idle
    case running
    case waving
    case jumping
    case failed
    case waiting
    case review

    var row: Int {
        switch self {
        case .idle: 0
        case .waving: 3
        case .jumping: 4
        case .failed: 5
        case .waiting: 6
        case .running: 7
        case .review: 8
        }
    }

    var frameCount: Int {
        switch self {
        case .waving: 4
        case .jumping: 5
        case .failed: 8
        default: 6
        }
    }

    var duration: TimeInterval {
        switch self {
        case .waving, .jumping: 1.4
        case .failed: 2.08
        default: 1.56
        }
    }

    var fallbackMessage: String {
        switch self {
        case .idle: "我在这儿，慢慢来。"
        case .running: "正在努力跑进度！"
        case .waving: "准备好啦，一起开口。"
        case .jumping: "完成了！你真棒 ✦"
        case .failed: "没关系，我们再来一次。"
        case .waiting: "我陪你等灵感。"
        case .review: "这句很有感觉，再读一遍？"
        }
    }
}

// MARK: - Media

enum VideoSource: String, Codable, Sendable {
    case upload
    case recording
}

struct VideoAsset: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
    let sizeLabel: String
    let url: URL?
    let durationLabel: String?
    let source: VideoSource

    init(
        id: UUID = UUID(),
        name: String,
        sizeLabel: String,
        url: URL?,
        durationLabel: String? = nil,
        source: VideoSource
    ) {
        self.id = id
        self.name = name
        self.sizeLabel = sizeLabel
        self.url = url
        self.durationLabel = durationLabel
        self.source = source
    }

    var isPlayable: Bool {
        guard let url else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }
}

// MARK: - Clip workflow

enum ClipStage: Equatable, Sendable {
    case empty
    case ready
    case uploading
    case queued
    case processing
    case downloading
    case done
    case failed
}

enum PreviewMode: String, CaseIterable, Identifiable {
    case before = "原片"
    case after = "成片"
    var id: String { rawValue }
}

// MARK: - Script / Record

enum StudioMode: Equatable {
    case compose
    case teleprompter
    case review
}

enum ComposePanel: String, CaseIterable, Identifiable {
    case chat = "和助手聊"
    case draft = "我的口播稿"
    var id: String { rawValue }
}

struct ChatMessage: Codable, Identifiable, Equatable, Sendable {
    enum Role: String, Codable, Sendable {
        case assistant
        case user
    }

    let id: UUID
    let role: Role
    let content: String

    init(id: UUID = UUID(), role: Role, content: String) {
        self.id = id
        self.role = role
        self.content = content
    }
}

struct ScriptSuggestion: Identifiable, Equatable, Sendable {
    let id: Int
    let eyebrow: String
    let title: String
    let detail: String
    let symbol: String

    init(id: Int, eyebrow: String, title: String, detail: String, symbol: String = "sparkle") {
        self.id = id
        self.eyebrow = eyebrow
        self.title = title
        self.detail = detail
        self.symbol = symbol
    }
}

// LiveCoachMetrics 定义见 CoachMetrics.swift

// MARK: - Helpers

enum MediaFormatters {
    static func byteCount(_ bytes: Int) -> String {
        if bytes < 1_048_576 {
            return "\(max(1, Int((Double(bytes) / 1024).rounded()))) KB"
        }
        return String(format: "%.1f MB", Double(bytes) / 1_048_576)
    }

    static func duration(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }

    static func progressPercent(_ value: Double?) -> String {
        guard let value else { return "等待服务更新" }
        return "\(Int((value * 100).rounded()))%"
    }
}

enum DraftText {
    static func splitSentences(_ text: String) -> [String] {
        var result: [String] = []
        var current = ""
        let endings: Set<Character> = ["。", "！", "？", "\n"]
        for character in text {
            current.append(character)
            if endings.contains(character) {
                let sentence = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !sentence.isEmpty { result.append(sentence) }
                current = ""
            }
        }
        let trailing = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trailing.isEmpty { result.append(trailing) }
        return result
    }
}
