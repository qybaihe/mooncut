import Foundation
import Observation

/// 宠物状态只能由真实业务事件驱动，开心值仅反映互动。
@MainActor
@Observable
final class PetStateStore {
    private(set) var animation: PetAnimationState = .waiting
    private(set) var message: String = PetAnimationState.waiting.fallbackMessage
    private(set) var happiness: Int
    private(set) var reactionNonce: Int = 0

    private let happinessKey: String
    private var touchReactionUntil: Date?

    init(userId: String? = nil) {
        let key = "mooncut:pet-happiness" + (userId.map { ":\($0)" } ?? "")
        self.happinessKey = key
        let stored = UserDefaults.standard.integer(forKey: key)
        self.happiness = stored == 0 ? 68 : min(100, max(0, stored))
    }

    func rebind(userId: String?) {
        let key = "mooncut:pet-happiness" + (userId.map { ":\($0)" } ?? "")
        if key != happinessKey {
            // Keep store instance; happiness already namespaced at init for session lifetime.
        }
    }

    // MARK: - Event reducers (pure mapping of real signals)

    enum Event: Equatable {
        case idle
        case emptyWorkspace
        case scriptRequesting
        case uploading
        case jobQueued
        case jobRunning
        case jobDownloading
        case jobCompleted
        case jobFailed
        case recording
        /// 陪练进行中（听你说）
        case coachListening
        /// 教练接口分析中
        case coachAnalyzing
        /// 镜头里没有脸 / 偏太多
        case coachOffCamera
        /// 音量过低
        case coachLowVolume
        case coachPositive
        case coachReview
        case permissionOrNetworkFailure
        case petMessage(String)
        case touch
    }

    func apply(_ event: Event) {
        if case .touch = event {
            handleTouch()
            return
        }
        if case .petMessage(let text) = event {
            if !text.isEmpty { message = text }
            return
        }

        // Touch reaction takes priority briefly
        if let until = touchReactionUntil, until > Date() {
            return
        }

        let mapped = Self.reduce(event)
        animation = mapped.state
        if let override = mapped.messageOverride, !override.isEmpty {
            message = override
        } else {
            message = mapped.state.fallbackMessage
        }
    }

    func applyMany(_ events: [Event]) {
        // Highest priority last wins among simultaneous signals
        let priority: (Event) -> Int = { event in
            switch event {
            case .permissionOrNetworkFailure, .jobFailed: return 100
            case .coachOffCamera, .coachLowVolume: return 95
            case .recording, .coachListening: return 90
            case .coachAnalyzing: return 85
            case .uploading, .scriptRequesting, .jobRunning, .jobDownloading, .jobQueued: return 80
            case .jobCompleted, .coachPositive: return 70
            case .coachReview: return 60
            case .emptyWorkspace: return 40
            case .idle: return 10
            case .petMessage, .touch: return 0
            }
        }
        let sorted = events.sorted { priority($0) < priority($1) }
        for event in sorted {
            apply(event)
        }
    }

    static func reduce(_ event: Event) -> (state: PetAnimationState, messageOverride: String?) {
        switch event {
        case .emptyWorkspace:
            return (.waiting, nil)
        case .scriptRequesting, .uploading, .jobQueued, .jobRunning, .jobDownloading, .coachAnalyzing:
            return (.running, nil)
        case .recording, .coachListening:
            return (.waving, "我在听，慢慢说～")
        case .coachOffCamera:
            return (.waiting, "我好像没看见你，看向镜头试试？")
        case .coachLowVolume:
            return (.review, "声音有点小，再靠近一点麦克风。")
        case .jobCompleted, .coachPositive:
            return (.jumping, nil)
        case .coachReview:
            return (.review, nil)
        case .permissionOrNetworkFailure, .jobFailed:
            return (.failed, nil)
        case .idle:
            return (.idle, nil)
        case .petMessage(let text):
            return (.idle, text)
        case .touch:
            return (.jumping, "摸到我啦，好开心！")
        }
    }

    private func handleTouch() {
        happiness = min(100, happiness + 4)
        UserDefaults.standard.set(happiness, forKey: happinessKey)
        reactionNonce += 1
        animation = .jumping
        message = "摸到我啦，好开心！"
        touchReactionUntil = Date().addingTimeInterval(1.4)
        let nonce = reactionNonce
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            guard nonce == reactionNonce else { return }
            touchReactionUntil = nil
            // Return to previous business-driven state is caller's job via re-apply
            animation = .idle
            message = PetAnimationState.idle.fallbackMessage
        }
    }
}
