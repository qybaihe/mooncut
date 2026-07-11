import SwiftUI

struct RecordStudioView: View {
    @Bindable var model: RecordStudioViewModel
    @Environment(\.theme) private var theme
    let onSendToEdit: (VideoAsset) -> Void

    var body: some View {
        Group {
            switch model.mode {
            case .compose:
                ComposeStudioView(model: model)
            case .teleprompter:
                TeleprompterView(model: model)
            case .review:
                RecordingReviewView(model: model, onSendToEdit: onSendToEdit)
            }
        }
        .background(theme.canvas.ignoresSafeArea())
    }
}

private struct ComposeStudioView: View {
    @Bindable var model: RecordStudioViewModel
    @Environment(\.theme) private var theme
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    Picker("创作面板", selection: $model.panel) {
                        Label("和助手聊", systemImage: "bubble.left").tag(ComposePanel.chat)
                        Label("我的口播稿", systemImage: "doc.plaintext").tag(ComposePanel.draft)
                    }
                    .pickerStyle(.segmented)

                    if model.panel == .chat {
                        chatPanel
                    } else {
                        draftPanel
                    }

                    if let error = model.errorMessage {
                        ErrorBanner(
                            message: error,
                            diagnostic: model.errorDiagnostic,
                            retryTitle: "重试真实请求",
                            onRetry: model.retryLast
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("脚本助手")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: model.messages.count) { _, _ in
                withAnimation { proxy.scrollTo("chat-end", anchor: .bottom) }
            }
        }
        .overlay(alignment: .bottom) {
            ToastView(message: model.toast)
                .padding(.bottom, 12)
        }
        .accessibilityIdentifier("script-screen")
    }

    private var chatPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Moon 助手")
                    .font(.subheadline.weight(.bold))
                Spacer()
                if let modelName = model.lastModel {
                    StatusPill(text: modelName, symbol: "cpu")
                } else {
                    StatusPill(text: "真实 API", symbol: "link")
                }
            }

            ForEach(model.messages) { message in
                messageBubble(message)
            }

            if model.isThinking {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("正在请求脚本助手…")
                        .font(.caption)
                        .foregroundStyle(theme.textSecondary)
                }
            }

            if !model.suggestions.isEmpty {
                Text("建议角度")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.textSecondary)
                ForEach(model.suggestions) { item in
                    Button {
                        model.toggleSuggestion(item.id)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: model.selectedSuggestionIDs.contains(item.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.eyebrow)
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(theme.accent)
                                Text(item.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(theme.textPrimary)
                                Text(item.detail)
                                    .font(.caption)
                                    .foregroundStyle(theme.textSecondary)
                            }
                        }
                        .padding(12)
                        .moonCard(radius: 12)
                    }
                    .buttonStyle(.plain)
                }
                Button("按所选建议生成稿件") {
                    model.applySelectedSuggestionsIntoPrompt()
                }
                .buttonStyle(SecondaryButtonStyle())

                Button("直接生成完整口播稿") {
                    model.generateDraft()
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isThinking)
            }

            HStack(spacing: 8) {
                TextField("说说你想讲什么…", text: $model.input, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($isComposerFocused)
                    .padding(10)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("script-input")
                Button {
                    model.sendMessage()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(theme.accent)
                        .frame(width: 44, height: 44)
                }
                .disabled(model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isThinking)
                .accessibilityLabel("发送")
            }
            .id("chat-end")
        }
        .padding(14)
        .moonCard()
    }

    private var draftPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("\(model.characterCount) 字 · 约 \(model.estimatedSeconds) 秒")
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
                Spacer()
                Button("复制") { model.copyDraft() }
                    .font(.caption.weight(.semibold))
            }
            TextEditor(text: $model.draft)
                .frame(minHeight: 220)
                .padding(8)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("script-draft")

            HStack(spacing: 8) {
                Button("口语化") { model.polish(style: "oral") }
                    .buttonStyle(SecondaryButtonStyle())
                Button("精简") { model.polish(style: "short") }
                    .buttonStyle(SecondaryButtonStyle())
                Button("增强情绪") { model.polish(style: "emotional") }
                    .buttonStyle(SecondaryButtonStyle())
            }
            .disabled(model.isThinking || model.draft.isEmpty)

            Button {
                model.enterTeleprompter()
            } label: {
                Label("进入提词录制", systemImage: "text.viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("enter-teleprompter")
        }
        .padding(14)
        .moonCard()
    }

    private func messageBubble(_ message: ChatMessage) -> some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            Text(message.content)
                .font(.subheadline)
                .foregroundStyle(message.role == .user ? .white : theme.textPrimary)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(message.role == .user ? theme.accent : theme.inset)
                )
            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }
}

private struct RecordingReviewView: View {
    @Bindable var model: RecordStudioViewModel
    @Environment(\.theme) private var theme
    let onSendToEdit: (VideoAsset) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("录制复核")
                    .font(.title3.weight(.bold))
                if model.canHandOffToEdit {
                    VideoSurface(url: model.reviewURL, label: "真实录制", isProcessed: false)
                    LabeledContent("时长", value: MediaFormatters.duration(Double(model.recordedDuration)))
                    Button {
                        if let asset = model.makeHandoffAsset() {
                            onSendToEdit(asset)
                        }
                    } label: {
                        Label("交给剪辑", systemImage: "scissors")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("handoff-to-edit")
                } else {
                    ContentUnavailableView(
                        "没有可交接的录制文件",
                        systemImage: "video.slash",
                        description: Text("无真实 outputURL 时不能交给剪辑。")
                    )
                    .accessibilityIdentifier("review-no-file")
                }
                Button("重新录制") { model.rerecord() }
                    .buttonStyle(SecondaryButtonStyle())
                Button("返回稿件") { model.returnToCompose() }
                    .buttonStyle(SecondaryButtonStyle())
            }
            .padding(16)
        }
        .navigationTitle("复核")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("review-screen")
    }
}
