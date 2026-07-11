import SwiftUI

struct HomeView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    @Bindable var clipModel: ClipStudioViewModel
    @Bindable var recordModel: RecordStudioViewModel
    var onOpenEdit: () -> Void
    var onOpenScript: () -> Void
    var onOpenCoach: () -> Void
    var onOpenJobs: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                overview
                quickActions
                continueCards
                petStrip
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .background(theme.canvas.ignoresSafeArea())
        .navigationTitle("创作")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                ServiceStatusBadge(kind: env.serviceBadge)
            }
        }
        .accessibilityIdentifier("home-screen")
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(greeting)
                .font(.title3.weight(.bold))
                .foregroundStyle(theme.textPrimary)
            Text("把想法变成能发布的口播成片。剪辑与助手均连接真实服务，失败会明确提示。")
                .font(.subheadline)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let err = env.serviceError {
                ErrorBanner(message: "服务暂不可用：\(err)", diagnostic: nil, onRetry: {
                    Task { await env.bootstrap() }
                })
            }
        }
    }

    private var greeting: String {
        if let email = env.user?.email {
            let name = email.split(separator: "@").first.map(String.init) ?? email
            return "你好，\(name)"
        }
        return "开始创作"
    }

    private var quickActions: some View {
        VStack(spacing: 12) {
            Button(action: onOpenEdit) {
                Label("开始剪辑", systemImage: "scissors")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("home-start-edit")

            HStack(spacing: 10) {
                Button(action: onOpenScript) {
                    Label("脚本助手", systemImage: "text.bubble")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("home-start-script")

                Button(action: onOpenCoach) {
                    Label("口播陪练", systemImage: "mic")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("home-start-coach")
            }
        }
    }

    private var continueCards: some View {
        VStack(spacing: 12) {
            if let jobId = env.activeJobId {
                continueCard(
                    title: "继续任务",
                    detail: "活跃剪辑任务 \(jobId.prefix(8))…",
                    symbol: "arrow.triangle.2.circlepath",
                    action: onOpenJobs
                )
                .accessibilityIdentifier("home-active-job")
            }
            if !recordModel.draft.isEmpty {
                continueCard(
                    title: "继续稿件",
                    detail: String(recordModel.draft.prefix(48)) + (recordModel.draft.count > 48 ? "…" : ""),
                    symbol: "doc.text",
                    action: onOpenScript
                )
            }
            if clipModel.stage == .empty && env.activeJobId == nil && recordModel.draft.isEmpty {
                ContentUnavailableView(
                    "还没有进行中的创作",
                    systemImage: "moon.stars",
                    description: Text("从剪辑一段口播或写一份稿件开始。")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .accessibilityIdentifier("home-empty")
            }
        }
    }

    private func continueCard(title: String, detail: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.accent)
                    .frame(width: 40, height: 40)
                    .background(theme.accentSoft, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.textPrimary)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(14)
            .moonCard()
        }
        .buttonStyle(.plain)
    }

    private var petStrip: some View {
        HStack(alignment: .center, spacing: 12) {
            PetCompanionView(store: env.pet, compact: true, showsBubble: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("小月")
                    .font(.subheadline.weight(.bold))
                Text(env.pet.message)
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .moonCard()
        .accessibilityIdentifier("pet-entry")
    }
}
