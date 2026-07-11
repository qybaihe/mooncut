import SwiftUI

/// 陪练 Tab：稿件入口 + 能力说明 + 一键进入「中间视频 / 指标 HUD」沉浸台。
struct CoachView: View {
    @Bindable var recordModel: RecordStudioViewModel
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    var onOpenTeleprompter: () -> Void
    var onOpenScript: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                capabilityStrip
                scriptCard
                pipelineCard
                petCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(theme.canvas.ignoresSafeArea())
        .navigationTitle("陪练")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("coach-screen")
        .onAppear {
            if recordModel.draft.isEmpty {
                env.pet.apply(.emptyWorkspace)
                env.pet.apply(.petMessage("先写好稿子，我们再一起练开口。"))
            } else {
                env.pet.apply(.idle)
                env.pet.apply(.petMessage("稿子在，随时可以进镜头练。"))
            }
        }
    }

    private var header: some View {
        ZStack(alignment: .topTrailing) {
            StudioSectionHeader(
                eyebrow: "实时口播陪练",
                title: "中间是你，周围是指标。",
                subtitle: "进入沉浸台后：前摄画面居中，语速 / 词量 / 音量 / 停顿 / 镜头朝向围绕显示；建议来自真实教练接口。",
                symbol: "mic.and.signal.meter"
            )
            if theme.usesMemphisChrome {
                MemphisAccentShape(style: .corner)
            }
        }
    }

    private var capabilityStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("系统原生能力")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.textPrimary)
            HStack(spacing: 8) {
                capabilityChip("Speech", "语音转写", "waveform")
                capabilityChip("Vision", "面部朝向", "face.smiling")
                capabilityChip("AVF", "前摄录制", "camera")
            }
            Text("镜头朝向为 Vision 估算（yaw/roll/框位置），不是精确「眼神接触率」。权限或硬件不可用时会明确标「不可用」。")
                .font(.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .moonCard()
    }

    private func capabilityChip(_ title: String, _ detail: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(theme.accent)
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.textPrimary)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(theme.textSecondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            if theme.usesMemphisChrome {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(theme.ink.opacity(0.35), lineWidth: 1)
            }
        }
    }

    @ViewBuilder
    private var scriptCard: some View {
        if recordModel.draft.isEmpty {
            StudioEmptyState(
                title: "还没有口播稿",
                systemImage: "doc.plaintext",
                description: "先在脚本助手生成稿件，再进入提词与实时陪练。",
                actionTitle: "去写稿",
                action: onOpenScript
            )
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("当前稿件")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.textPrimary)
                Text(recordModel.draft)
                    .font(.body)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(7)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack {
                    Text("\(recordModel.characterCount) 字 · 约 \(recordModel.estimatedSeconds) 秒")
                        .font(.caption)
                        .foregroundStyle(theme.textSecondary)
                    Spacer()
                    StatusPill(text: "\(recordModel.sentences.count) 句", symbol: "text.alignleft")
                }

                Button {
                    recordModel.enterTeleprompter()
                    onOpenTeleprompter()
                    env.pet.apply(.coachListening)
                } label: {
                    Label("进入镜头陪练台", systemImage: "video.badge.waveform")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("coach-start")

                Button("编辑稿件", action: onOpenScript)
                    .buttonStyle(SecondaryButtonStyle())
            }
            .padding(16)
            .moonCard()
        }
    }

    private var pipelineCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("沉浸台里你会看到")
                .font(.subheadline.weight(.bold))
            pipelineRow(1, "中间：真实前摄画面", "AVCapture 预览，可镜像")
            pipelineRow(2, "上方：五项实时指标", "语速 · 词量 · 音量 · 停顿 · 镜头朝向")
            pipelineRow(3, "中部：对稿 + ASR 字幕", "当前句高亮，识别原文滚动")
            pipelineRow(4, "下方：教练建议 + 小月", "真实 /v1/assistant/coach + 宠物状态")
        }
        .padding(16)
        .moonCard()
    }

    private func pipelineRow(_ index: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(index)")
                .font(.caption.weight(.black))
                .foregroundStyle(theme.usesMemphisChrome ? theme.ink : .white)
                .frame(width: 24, height: 24)
                .background(
                    Circle().fill(theme.usesMemphisChrome ? theme.stickerYellow : theme.accent)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.textPrimary)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
            }
        }
    }

    private var petCard: some View {
        HStack(spacing: 12) {
            PetCompanionView(store: env.pet, compact: true, showsBubble: false)
            VStack(alignment: .leading, spacing: 4) {
                Text("小月会跟着陪练状态变")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.textPrimary)
                Text(env.pet.message)
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("听你说 · 分析中 · 偏镜头 · 声音小 · 正向反馈")
                    .font(.caption2)
                    .foregroundStyle(theme.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .moonCard()
        .accessibilityIdentifier("coach-pet-card")
    }
}
