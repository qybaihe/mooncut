import Foundation
import SwiftUI

enum ThemeMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }

    var symbol: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

enum WorkspaceTab: String, CaseIterable, Identifiable {
    case edit
    case record

    var id: String { rawValue }
    var title: String { self == .edit ? "剪辑台" : "录制间" }
    var symbol: String { self == .edit ? "scissors" : "mic" }
}

enum PetAnimationState: Int, Hashable {
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

    var message: String {
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

enum ClipStage: Equatable {
    case empty
    case ready
    case processing
    case done
}

enum PreviewMode: String, CaseIterable, Identifiable {
    case before = "原片"
    case after = "成片"
    var id: String { rawValue }
}

enum SubtitleStyle: String, CaseIterable, Identifiable {
    case emphasis = "重点词强调"
    case minimal = "极简白字"
    case outlined = "综艺描边"
    var id: String { rawValue }
}

enum RhythmIntensity: String, CaseIterable, Identifiable {
    case light = "轻"
    case natural = "自然"
    case tight = "紧凑"
    var id: String { rawValue }
}

enum VideoSource: String, Codable {
    case upload
    case recording
}

struct VideoAsset: Identifiable, Equatable {
    let id: UUID
    let name: String
    let sizeLabel: String
    let url: URL?
    let source: VideoSource

    init(id: UUID = UUID(), name: String, sizeLabel: String, url: URL?, source: VideoSource) {
        self.id = id
        self.name = name
        self.sizeLabel = sizeLabel
        self.url = url
        self.source = source
    }
}

struct ProcessingStep: Identifiable, Equatable {
    let id = UUID()
    let label: String
    let detail: String
}

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

struct ChatMessage: Codable, Identifiable, Equatable {
    enum Role: String, Codable {
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

struct ScriptSuggestion: Identifiable, Equatable {
    let id: Int
    let eyebrow: String
    let title: String
    let detail: String
    let symbol: String
}
