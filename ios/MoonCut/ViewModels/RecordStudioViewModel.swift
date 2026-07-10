import Foundation
import UIKit

@MainActor
final class RecordStudioViewModel: ObservableObject {
    @Published var mode: StudioMode = .compose
    @Published var panel: ComposePanel = .chat
    @Published var messages: [ChatMessage] {
        didSet { saveMessages() }
    }
    @Published var input = ""
    @Published var topic = "为什么口播开头 3 秒很重要"
    @Published var isThinking = false
    @Published var selectedSuggestions: Set<Int> = [0, 1, 2]
    @Published var draft: String {
        didSet { UserDefaults.standard.set(draft, forKey: Keys.draft) }
    }
    @Published var toast = ""
    @Published var reviewURL: URL?
    @Published var recordedDuration = 0

    let suggestions = DemoContent.suggestions
    private var assistantTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    private enum Keys {
        static let draft = "mooncut:draft"
        static let messages = "mooncut:messages"
    }

    init(defaults: UserDefaults = .standard) {
        draft = defaults.string(forKey: Keys.draft) ?? DemoContent.defaultDraft
        if let data = defaults.data(forKey: Keys.messages),
           let decoded = try? JSONDecoder().decode([ChatMessage].self, from: data),
           !decoded.isEmpty {
            messages = decoded
        } else {
            messages = [DemoContent.initialMessage]
        }
    }

    var characterCount: Int {
        draft.filter { !$0.isWhitespace }.count
    }

    var estimatedSeconds: Int {
        max(20, Int((Double(characterCount) / 4.1).rounded()))
    }

    var sentences: [String] {
        DraftProcessor.splitSentences(draft)
    }

    func sendMessage(_ preset: String? = nil) {
        let content = (preset ?? input).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isThinking else { return }

        messages.append(ChatMessage(role: .user, content: content))
        input = ""
        topic = content
        isThinking = true
        assistantTask?.cancel()
        assistantTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 720_000_000)
            guard let self, !Task.isCancelled else { return }
            self.messages.append(
                ChatMessage(
                    role: .assistant,
                    content: "这个主题可以讲得很具体。我建议用“一个误区 + 一个场景 + 一个动作”来组织，观众会更容易听进去。下面三个角度都可以直接加进稿子。"
                )
            )
            self.isThinking = false
        }
    }

    func toggleSuggestion(_ id: Int) {
        if selectedSuggestions.contains(id) {
            selectedSuggestions.remove(id)
        } else {
            selectedSuggestions.insert(id)
        }
    }

    func applySuggestions() {
        let subject = topic.count > 42 ? String(topic.prefix(42)) + "…" : topic
        let hook = selectedSuggestions.contains(0)
            ? "很多人聊到“\(subject)”，第一反应是把背景讲清楚。但真正让观众留下来的，往往不是背景，而是你能不能在前三秒说到他心里。"
            : "今天想和你聊聊“\(subject)”。"
        let scene = selectedSuggestions.contains(1)
            ? "\n\n想象一下：你认真录了十分钟，信息都很有用，可观众刚听到“大家好，今天想跟大家分享一下”，就已经划走了。不是内容不好，而是重点出现得太晚。"
            : ""
        let action = selectedSuggestions.contains(2)
            ? "\n\n下一条视频，先把开场白删掉，把最想让观众记住的那句话放到第一句。先说结果，再解释原因。你会发现，表达不需要更用力，只需要更快地抵达重点。"
            : ""

        draft = "\(hook)\(scene)\n\n所以，一个好口播不一定要讲得更多，而是要更早让观众知道：这件事为什么和他有关。\(action)"
        panel = .draft
        showToast("建议已整理进完整口播稿")
    }

    enum PolishStyle {
        case oral
        case short
        case emotional
    }

    func polish(_ style: PolishStyle) {
        switch style {
        case .oral:
            draft = DraftProcessor.makeOral(draft)
            showToast("已调得更像你在自然说话")
        case .short:
            draft = DraftProcessor.shorten(draft)
            showToast("已删掉重复信息，保留核心表达")
        case .emotional:
            draft = DraftProcessor.addEmotion(draft)
            showToast("开头的情绪张力已加强")
        }
    }

    func enterTeleprompter() {
        recordedDuration = 0
        mode = .teleprompter
    }

    func leaveTeleprompter() {
        mode = .compose
    }

    func beginReview(url: URL?, duration: Int) {
        reviewURL = url
        recordedDuration = duration
        mode = .review
    }

    func rerecord() {
        reviewURL = nil
        recordedDuration = 0
        mode = .teleprompter
    }

    func returnToCompose() {
        mode = .compose
    }

    func makeHandoffAsset() -> VideoAsset {
        let ext = reviewURL?.pathExtension.isEmpty == false ? reviewURL!.pathExtension : "mov"
        return VideoAsset(
            name: "刚刚录制的口播.\(ext)",
            sizeLabel: reviewURL.map(VideoFileStore.sizeLabel(for:)) ?? "演示录制 · 已就绪",
            url: reviewURL,
            source: .recording
        )
    }

    func copyDraft() {
        UIPasteboard.general.string = draft
        showToast("口播稿已复制到剪贴板")
    }

    func showToast(_ message: String) {
        toastTask?.cancel()
        toast = message
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = ""
        }
    }

    private func saveMessages() {
        if let data = try? JSONEncoder().encode(messages) {
            UserDefaults.standard.set(data, forKey: Keys.messages)
        }
    }

    deinit {
        assistantTask?.cancel()
        toastTask?.cancel()
    }
}

