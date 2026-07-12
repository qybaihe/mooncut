import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class RecordStudioViewModel {
    var mode: StudioMode = .compose
    var panel: ComposePanel = .chat
    var messages: [ChatMessage] = []
    var input = ""
    var isThinking = false
    var suggestions: [ScriptSuggestion] = []
    var selectedSuggestionIDs: Set<Int> = []
    var draft: String = ""
    var toast = ""
    var errorMessage: String?
    var errorDiagnostic: String?
    var reviewURL: URL?
    var recordedDuration = 0
    var phase: String?
    var lastPetMessage: String?
    var lastModel: String?
    var isReadyToDraft = false

    private let api: MoonCutAPIClient
    private let env: AppEnvironment
    private var assistantTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?
    private var pendingRetry: (() async -> Void)?

    private var draftKey: String { namespaced("mooncut:draft") }
    private var messagesKey: String { namespaced("mooncut:messages") }

    init(api: MoonCutAPIClient, env: AppEnvironment) {
        self.api = api
        self.env = env
        // 必须在已登录用户上下文中创建；匿名 key 仅作兜底，不跨账号复用内存态
        resetInMemoryState()
        loadLocal()
    }

    /// 换账号重建时清空内存，再按当前 userId 读私有草稿。
    func resetInMemoryState() {
        assistantTask?.cancel()
        toastTask?.cancel()
        mode = .compose
        panel = .chat
        messages = []
        input = ""
        isThinking = false
        suggestions = []
        selectedSuggestionIDs = []
        draft = ""
        toast = ""
        errorMessage = nil
        errorDiagnostic = nil
        reviewURL = nil
        recordedDuration = 0
        phase = nil
        lastPetMessage = nil
        lastModel = nil
        isReadyToDraft = false
        pendingRetry = nil
    }

    var characterCount: Int {
        draft.filter { !$0.isWhitespace }.count
    }

    var estimatedSeconds: Int {
        max(20, Int((Double(characterCount) / 4.1).rounded()))
    }

    var sentences: [String] {
        DraftText.splitSentences(draft)
    }

    var canHandOffToEdit: Bool {
        guard let reviewURL else { return false }
        return FileManager.default.fileExists(atPath: reviewURL.path)
    }

    func loadLocal() {
        draft = UserDefaults.standard.string(forKey: draftKey) ?? ""
        if let data = UserDefaults.standard.data(forKey: messagesKey),
           let decoded = try? JSONDecoder().decode([ChatMessage].self, from: data),
           !decoded.isEmpty {
            messages = decoded
        } else if messages.isEmpty {
            messages = [
                ChatMessage(
                    role: .assistant,
                    content: "先告诉我：这条口播，你最想让观众记住什么？我会通过真实脚本助手陪你成稿。"
                )
            ]
        }
    }

    func sendMessage(_ preset: String? = nil) {
        let content = (preset ?? input).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isThinking else { return }
        messages.append(ChatMessage(role: .user, content: content))
        input = ""
        saveLocal()
        requestScript(action: "guide")
    }

    func generateDraft() {
        requestScript(action: "generate")
    }

    func polish(style: String) {
        requestScript(action: "polish", style: style)
    }

    func retryLast() {
        guard let pendingRetry else {
            requestScript(action: "guide")
            return
        }
        Task { await pendingRetry() }
    }

    private func requestScript(action: String, style: String? = nil) {
        isThinking = true
        errorMessage = nil
        errorDiagnostic = nil
        env.pet.apply(.scriptRequesting)
        assistantTask?.cancel()
        assistantTask = Task { [weak self] in
            guard let self else { return }
            let payload = ScriptAssistantRequest(
                action: action,
                style: style,
                messages: messages.suffix(12).map {
                    ScriptMessageDTO(role: $0.role.rawValue, content: $0.content)
                },
                draft: draft.isEmpty ? nil : draft
            )
            pendingRetry = { [weak self] in
                self?.requestScript(action: action, style: style)
            }
            do {
                let response = try await api.scriptAssistant(payload)
                guard !Task.isCancelled else { return }
                apply(response: response, action: action)
                pendingRetry = nil
            } catch is CancellationError {
                return
            } catch {
                isThinking = false
                if let apiError = error as? APIError {
                    errorMessage = apiError.errorDescription
                    errorDiagnostic = apiError.diagnosticCode
                    if apiError == .unauthorized {
                        env.handleAPIError(apiError)
                    }
                } else {
                    errorMessage = error.localizedDescription
                }
                // 不回退假 AI 回答
                env.pet.apply(.permissionOrNetworkFailure)
            }
        }
    }

    private func apply(response: ScriptAssistantResponseDTO, action: String) {
        isThinking = false
        phase = response.phase
        isReadyToDraft = response.ready ?? false
        lastModel = response.model
        if let pet = response.petMessage, !pet.isEmpty {
            lastPetMessage = pet
            env.pet.apply(.petMessage(pet))
        }

        if action != "polish" {
            messages.append(ChatMessage(role: .assistant, content: response.reply))
        } else {
            showToast(response.reply)
        }

        if let draft = response.draft, !draft.isEmpty {
            self.draft = draft
            if action == "generate" || action == "polish" {
                panel = .draft
            }
        }

        if let remote = response.suggestions, !remote.isEmpty {
            suggestions = remote.enumerated().map { index, item in
                ScriptSuggestion(
                    id: index,
                    eyebrow: item.eyebrow,
                    title: item.title,
                    detail: item.detail,
                    symbol: ["bolt.fill", "lightbulb.fill", "arrow.right"][index % 3]
                )
            }
            selectedSuggestionIDs = Set(suggestions.map(\.id))
        }

        if response.ready == true {
            env.pet.apply(.coachReview)
        } else {
            env.pet.apply(.idle)
        }
        saveLocal()
    }

    func toggleSuggestion(_ id: Int) {
        if selectedSuggestionIDs.contains(id) {
            selectedSuggestionIDs.remove(id)
        } else {
            selectedSuggestionIDs.insert(id)
        }
    }

    func applySelectedSuggestionsIntoPrompt() {
        let selected = suggestions.filter { selectedSuggestionIDs.contains($0.id) }
        guard !selected.isEmpty else { return }
        let text = selected.map { "\($0.title)：\($0.detail)" }.joined(separator: "；")
        sendMessage("请把这些角度写进稿件：\(text)")
    }

    func enterTeleprompter() {
        recordedDuration = 0
        mode = .teleprompter
        env.isImmersiveTeleprompter = true
        env.pet.apply(.recording)
    }

    func leaveTeleprompter() {
        mode = .compose
        env.isImmersiveTeleprompter = false
        env.pet.apply(.idle)
    }

    func beginReview(url: URL?, duration: Int) {
        guard let url, FileManager.default.fileExists(atPath: url.path) else {
            errorMessage = "没有真实录制文件，无法进入复核。请检查相机与麦克风权限后重试。"
            env.pet.apply(.permissionOrNetworkFailure)
            mode = .compose
            env.isImmersiveTeleprompter = false
            return
        }
        reviewURL = url
        recordedDuration = duration
        mode = .review
        env.isImmersiveTeleprompter = false
        env.pet.apply(.jobCompleted)
    }

    func rerecord() {
        reviewURL = nil
        recordedDuration = 0
        mode = .teleprompter
        env.isImmersiveTeleprompter = true
        env.pet.apply(.recording)
    }

    func returnToCompose() {
        mode = .compose
        env.isImmersiveTeleprompter = false
    }

    func makeHandoffAsset() -> VideoAsset? {
        guard let reviewURL, FileManager.default.fileExists(atPath: reviewURL.path) else {
            return nil
        }
        let ext = reviewURL.pathExtension.isEmpty ? "mov" : reviewURL.pathExtension
        return VideoAsset(
            name: "刚刚录制的口播.\(ext)",
            sizeLabel: VideoFileStore.sizeLabel(for: reviewURL),
            url: reviewURL,
            durationLabel: MediaFormatters.duration(Double(recordedDuration)),
            durationSeconds: Double(recordedDuration),
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
        toastTask = Task {
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            guard !Task.isCancelled else { return }
            toast = ""
        }
    }

    private func saveLocal() {
        UserDefaults.standard.set(draft, forKey: draftKey)
        if let data = try? JSONEncoder().encode(messages) {
            UserDefaults.standard.set(data, forKey: messagesKey)
        }
    }

    private func namespaced(_ key: String) -> String {
        if let id = env.user?.id { return "\(key):\(id)" }
        return key
    }

    func cancelTasks() {
        assistantTask?.cancel()
        toastTask?.cancel()
    }
}
