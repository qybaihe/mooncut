import SwiftUI

struct RecordStudioView: View {
    @ObservedObject var model: RecordStudioViewModel
    let onSendToEdit: (VideoAsset) -> Void

    var body: some View {
        switch model.mode {
        case .compose:
            ComposeStudioView(model: model)
        case .teleprompter:
            TeleprompterView(model: model)
        case .review:
            RecordingReviewView(model: model, onSendToEdit: onSendToEdit)
        }
    }
}

private struct ComposeStudioView: View {
    @ObservedObject var model: RecordStudioViewModel
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    PageIntro(
                        eyebrow: "口播助手",
                        symbol: "bubble.left.and.bubble.right",
                        title: "先聊明白，\n再开口录。",
                        subtitle: "说说你想讲什么，助手会陪你把它变成一篇能直接念的口播稿。"
                    )

                    Picker("创作面板", selection: $model.panel) {
                        Label("和助手聊", systemImage: "bubble.left").tag(ComposePanel.chat)
                        Label("我的口播稿", systemImage: "wand.and.stars").tag(ComposePanel.draft)
                    }
                    .pickerStyle(.segmented)

                    if model.panel == .chat {
                        chatPanel
                    } else {
                        draftPanel
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 22)
                .padding(.bottom, 28)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.messages.count) { _, _ in
                withAnimation { proxy.scrollTo("chat-end", anchor: .bottom) }
            }
        }
    }

    private var chatPanel: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                Image(systemName: "sparkles")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(MoonColor.accent)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 12).fill(MoonColor.accent.opacity(0.11)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Moon 助手").font(.subheadline.weight(.bold))
                    Label("正在陪你构思", systemImage: "circle.fill")
                        .font(.caption2)
                        .foregroundStyle(MoonColor.success)
                }
                Spacer()
                StatusPill(text: "懂口播节奏", symbol: "waveform")
            }
            .padding(16)

            Divider()

            LazyVStack(spacing: 14) {
                ForEach(model.messages) { message in
                    messageBubble(message)
                }

                if model.messages.count == 1 {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("不知道怎么说？选一个开始")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        FlexibleChips(items: DemoContent.quickTopics) { model.sendMessage($0) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if model.isThinking {
                    HStack(spacing: 5) {
                        ProgressView().controlSize(.small)
                        Text("正在整理表达角度…")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 12))
                }

                if model.messages.count > 1 && !model.isThinking {
                    suggestionBlock
                }

                Color.clear.frame(height: 1).id("chat-end")
            }
            .padding(16)

            Divider()

            HStack(alignment: .bottom, spacing: 10) {
                TextField("比如：我想讲为什么开头 3 秒很重要…", text: $model.input, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($isComposerFocused)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 13)
                    .frame(minHeight: 46)
                    .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 13))
                    .submitLabel(.send)
                    .onSubmit { model.sendMessage() }

                Button { model.sendMessage() } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .background(Circle().fill(MoonColor.accent))
                }
                .buttonStyle(.plain)
                .disabled(model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isThinking)
                .opacity(model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
                .accessibilityLabel("发送消息")
            }
            .padding(14)
        }
        .moonCard()
    }

    private var suggestionBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("建议你从这 3 个角度讲")
                    .font(.subheadline.weight(.bold))
                Spacer()
                Text("可多选")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            ForEach(model.suggestions) { item in
                let isSelected = model.selectedSuggestions.contains(item.id)
                Button { model.toggleSuggestion(item.id) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: item.symbol)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(isSelected ? MoonColor.accent : .secondary)
                            .frame(width: 38, height: 38)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(isSelected ? MoonColor.accent.opacity(0.11) : MoonColor.inset)
                            )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.eyebrow)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(MoonColor.accent)
                            Text(item.title).font(.subheadline.weight(.semibold))
                            Text(item.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(isSelected ? MoonColor.accent : Color.secondary.opacity(0.42))
                    }
                    .multilineTextAlignment(.leading)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(isSelected ? MoonColor.accent.opacity(0.055) : MoonColor.card)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(isSelected ? MoonColor.accent.opacity(0.45) : MoonColor.hairline, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 10) {
                Button { model.applySuggestions() } label: {
                    Label("加入口播稿", systemImage: "wand.and.stars")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.selectedSuggestions.isEmpty)
                Button { model.showToast("已经换了一组更具体的表达角度") } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .frame(width: 48, height: 48)
                }
                .buttonStyle(SecondaryButtonStyle())
                .frame(width: 54)
                .accessibilityLabel("换一组建议")
            }
        }
    }

    private var draftPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("你的口播稿")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(MoonColor.accent)
                    Text("可以直接念，也可以继续改。")
                        .font(.title3.weight(.bold))
                }
                Spacer(minLength: 12)
                Text("约 \(model.estimatedSeconds) 秒\n\(model.characterCount) 字")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
            .padding(16)

            Divider()

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    polishButton("更口语", "bubble.left", .oral)
                    polishButton("再精简", "scissors", .short)
                    polishButton("更有感染力", "heart", .emotional)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }

            Divider()

            ZStack(alignment: .topLeading) {
                Text("“")
                    .font(.system(size: 56, weight: .bold, design: .serif))
                    .foregroundStyle(MoonColor.accent.opacity(0.16))
                    .offset(x: 13, y: 2)
                TextEditor(text: $model.draft)
                    .font(.system(.body, design: .serif))
                    .lineSpacing(8)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 12)
                    .padding(.top, 26)
                    .frame(minHeight: 390)
                    .accessibilityLabel("编辑口播稿")
            }

            Divider()

            VStack(spacing: 10) {
                Label("已自动保存到本机", systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 10) {
                    Button { model.copyDraft() } label: {
                        Label("复制稿件", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button { model.enterTeleprompter() } label: {
                        HStack {
                            Text("进入提词录制")
                            Image(systemName: "arrow.right")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(16)
        }
        .moonCard()
    }

    private func messageBubble(_ message: ChatMessage) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .assistant {
                Image(systemName: "sparkles")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(MoonColor.accent)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(MoonColor.accent.opacity(0.10)))
            } else {
                Spacer(minLength: 42)
            }
            Text(message.content)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 13)
                .padding(.vertical, 11)
                .foregroundStyle(message.role == .user ? .white : .primary)
                .background(
                    message.role == .user ? AnyShapeStyle(MoonColor.accent) : AnyShapeStyle(MoonColor.inset),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
            if message.role == .assistant { Spacer(minLength: 20) }
        }
        .frame(maxWidth: .infinity)
    }

    private func polishButton(_ title: String, _ symbol: String, _ style: RecordStudioViewModel.PolishStyle) -> some View {
        Button { model.polish(style) } label: {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
    }
}

private struct FlexibleChips: View {
    let items: [String]
    let action: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 132), spacing: 8)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                actionButton(item)
            }
        }
    }

    private func actionButton(_ item: String) -> some View {
        Button { action(item) } label: {
            HStack {
                Text(item)
                Spacer(minLength: 4)
                Image(systemName: "arrow.right")
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 11)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
    }
}

private struct RecordingReviewView: View {
    @ObservedObject var model: RecordStudioViewModel
    let onSendToEdit: (VideoAsset) -> Void

    private var asset: VideoAsset {
        VideoAsset(
            name: "刚刚录制的口播.mov",
            sizeLabel: model.reviewURL.map(VideoFileStore.sizeLabel(for:)) ?? "演示录制",
            url: model.reviewURL,
            source: .recording
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageIntro(
                    eyebrow: "录制完成",
                    symbol: "checkmark.circle.fill",
                    title: "这一遍，\n很自然。",
                    subtitle: "预览一下，满意就直接交给智能剪辑。"
                )

                VideoSurface(asset: asset)
                    .aspectRatio(9 / 14, contentMode: .fit)
                    .frame(maxHeight: 460)
                    .padding(12)
                    .moonCard()
                    .overlay(alignment: .bottomLeading) {
                        StatusPill(
                            text: "刚刚录制 · \(clock(max(model.recordedDuration, 12)))",
                            symbol: "video.fill",
                            color: .white
                        )
                        .background(Color.black.opacity(0.46), in: Capsule())
                        .padding(24)
                    }

                VStack(alignment: .leading, spacing: 16) {
                    StatusPill(
                        text: model.reviewURL == nil ? "演示录制已完成" : "已保存到本机",
                        symbol: "sparkles",
                        color: MoonColor.success
                    )
                    Text("接下来，交给剪辑台。")
                        .font(.title2.weight(.bold))
                    Text("系统会自动去掉停顿与重复表达，再加上适合口播的节奏字幕。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    FlowStepper(labels: ["想法", "口播稿", "录制", "剪辑"], current: 2)

                    Button { onSendToEdit(model.makeHandoffAsset()) } label: {
                        HStack {
                            Text("一键去剪辑")
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())

                    Button { model.rerecord() } label: {
                        Label("重新录制", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Button { model.copyDraft() } label: {
                        Label("保存口播稿", systemImage: "doc.on.doc")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
                .padding(20)
                .moonCard()
            }
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 28)
        }
    }

    private func clock(_ seconds: Int) -> String {
        String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

#Preview {
    RecordStudioView(model: RecordStudioViewModel(), onSendToEdit: { _ in })
        .background(MoonColor.canvas)
}
