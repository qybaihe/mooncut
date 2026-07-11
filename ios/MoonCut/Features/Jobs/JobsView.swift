import SwiftUI

@MainActor
@Observable
final class JobsViewModel {
    var snapshot: RenderQueueSnapshotDTO?
    var isLoading = false
    var errorMessage: String?
    var errorDiagnostic: String?
    private let api: MoonCutAPIClient
    private let env: AppEnvironment
    private var pollTask: Task<Void, Never>?

    init(api: MoonCutAPIClient, env: AppEnvironment) {
        self.api = api
        self.env = env
    }

    func start() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    func stop() {
        pollTask?.cancel()
    }

    func refresh() async {
        isLoading = snapshot == nil
        do {
            snapshot = try await api.renderQueue()
            errorMessage = nil
            if snapshot?.active.contains(where: { $0.mine && ($0.status == "running" || $0.status == "queued") }) == true {
                env.pet.apply(.jobRunning)
            }
        } catch let error as APIError {
            errorMessage = error.errorDescription
            errorDiagnostic = error.diagnosticCode
            if error == .unauthorized {
                env.handleAPIError(error)
            } else {
                env.pet.apply(.permissionOrNetworkFailure)
            }
        } catch {
            errorMessage = error.localizedDescription
            env.pet.apply(.permissionOrNetworkFailure)
        }
        isLoading = false
    }
}

struct JobsView: View {
    @State private var model: JobsViewModel
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    var onOpenJob: (String) -> Void

    init(api: MoonCutAPIClient, env: AppEnvironment, onOpenJob: @escaping (String) -> Void) {
        _model = State(initialValue: JobsViewModel(api: api, env: env))
        self.onOpenJob = onOpenJob
    }

    private var activeCount: Int {
        (model.snapshot?.summary?.running ?? 0) + (model.snapshot?.summary?.queued ?? 0)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if let error = model.errorMessage {
                    ErrorBanner(
                        message: error,
                        diagnostic: model.errorDiagnostic,
                        onRetry: { Task { await model.refresh() } }
                    )
                }
                if let summary = model.snapshot?.summary {
                    summaryGrid(summary)
                }
                liveStrip

                if let active = model.snapshot?.active, !active.isEmpty {
                    sectionTitle("进行中", symbol: "flame.fill")
                    ForEach(active) { item in
                        JobCardView(item: item, emphasized: true)
                    }
                }

                if let recent = model.snapshot?.recent, !recent.isEmpty {
                    sectionTitle("最近动态", symbol: "clock.arrow.circlepath")
                    ForEach(recent) { item in
                        JobCardView(item: item, emphasized: false)
                    }
                }

                if showEmpty {
                    StudioEmptyState(
                        title: "制作线空闲",
                        systemImage: "tray",
                        description: "上传剪辑后，这里会显示真实排队与阶段进度。匿名队列不暴露邮箱和文件名。",
                        actionTitle: "去剪辑",
                        action: { onOpenJob("") }
                    )
                    .accessibilityIdentifier("jobs-empty")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(theme.canvas.ignoresSafeArea())
        .navigationTitle("任务")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh() }
        .overlay {
            if model.isLoading {
                ProgressView("加载队列…")
                    .padding(16)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityIdentifier("jobs-screen")
    }

    private var showEmpty: Bool {
        model.errorMessage == nil
            && model.snapshot?.active.isEmpty != false
            && model.snapshot?.recent.isEmpty != false
            && !model.isLoading
    }

    private var header: some View {
        ZStack(alignment: .topTrailing) {
            StudioSectionHeader(
                eyebrow: "实时制作线",
                title: activeCount > 0 ? "MoonCut 正在开工。" : "制作线已就绪。",
                subtitle: "每条约 3 秒刷新。共享队列只显示友好匿名名，不公开用户与文件信息。",
                symbol: "list.bullet.rectangle"
            )
            if theme.usesMemphisChrome {
                MemphisAccentShape(style: .corner)
                    .padding(.trailing, 4)
            }
        }
    }

    private func summaryGrid(_ summary: RenderQueueSummaryDTO) -> some View {
        HStack(spacing: 10) {
            StudioStatTile(
                title: "运行中",
                value: "\(summary.running)",
                symbol: "bolt.fill",
                accent: theme.accent
            )
            StudioStatTile(
                title: "排队",
                value: "\(summary.queued)",
                symbol: "hourglass",
                accent: theme.warning
            )
            StudioStatTile(
                title: "今日完成",
                value: "\(summary.completedToday)",
                symbol: "checkmark.seal.fill",
                accent: theme.success
            )
        }
    }

    private var liveStrip: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(activeCount > 0 ? theme.success : theme.textTertiary)
                .frame(width: 8, height: 8)
                .overlay {
                    if activeCount > 0 {
                        Circle()
                            .stroke(theme.success.opacity(0.35), lineWidth: 6)
                    }
                }
            Text(activeCount > 0 ? "\(activeCount) 个任务正在流转" : "当前没有进行中的任务")
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.textPrimary)
            Spacer()
            if let updated = model.snapshot?.updatedAt {
                Text(shortTime(updated))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(theme.textTertiary)
            }
            Button {
                Task { await model.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .frame(width: 36, height: 36)
                    .background(theme.inset, in: Circle())
            }
            .accessibilityLabel("刷新队列")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .moonCard(radius: 14)
    }

    private func sectionTitle(_ title: String, symbol: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(theme.accent)
            Text(title)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.textPrimary)
            if theme.usesMemphisChrome {
                MemphisAccentShape(style: .strip)
            }
            Spacer()
        }
        .padding(.top, 4)
    }

    private func shortTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: iso)
            ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return "" }
        let out = DateFormatter()
        out.locale = Locale(identifier: "zh_CN")
        out.dateFormat = "HH:mm:ss"
        return out.string(from: date)
    }
}

// MARK: - Job card

private struct JobCardView: View {
    @Environment(\.theme) private var theme
    let item: RenderQueueItemDTO
    var emphasized: Bool

    private var status: JobStatusStyle {
        JobStatusStyle.resolve(status: item.status, stage: item.stage, theme: theme)
    }

    private var progressValue: Double {
        min(1, max(0, item.progress))
    }

    private var hasNumericProgress: Bool {
        item.progress > 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                statusGlyph
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(JobStageCopy.title(for: item.stage))")
                        .font(.caption)
                        .foregroundStyle(theme.textSecondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 6) {
                    StatusPill(text: status.label, symbol: status.symbol, tint: status.tint)
                    if item.mine {
                        StatusPill(text: "我的", symbol: "person.fill", tint: theme.accent)
                    }
                }
            }

            StudioProgressTrack(
                progress: progressValue,
                tint: status.tint,
                indeterminate: !hasNumericProgress && (item.status == "queued" || item.status == "running")
            )

            HStack {
                if hasNumericProgress {
                    Text("\(Int((progressValue * 100).rounded()))%")
                        .font(.caption.weight(.bold).monospacedDigit())
                        .foregroundStyle(status.tint)
                } else if item.status == "queued" || item.status == "running" {
                    Text("等待服务更新")
                        .font(.caption)
                        .foregroundStyle(theme.textTertiary)
                } else {
                    Text(item.status)
                        .font(.caption.monospaced())
                        .foregroundStyle(theme.textTertiary)
                }
                Spacer()
                if let position = item.queuePosition, item.status == "queued" {
                    Text(position == 1 ? "即将开始" : "前方 \(position - 1) 个")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.warning)
                }
                Text(timeLabel)
                    .font(.caption2)
                    .foregroundStyle(theme.textTertiary)
            }
        }
        .padding(16)
        .background(cardBackground)
        .overlay(cardBorder)
        .shadow(
            color: theme.usesMemphisChrome ? theme.ink.opacity(emphasized ? 0.14 : 0.08) : .black.opacity(0.04),
            radius: theme.usesMemphisChrome ? 0 : 10,
            x: theme.usesMemphisChrome ? (emphasized ? 4 : 3) : 0,
            y: theme.usesMemphisChrome ? (emphasized ? 4 : 3) : 3
        )
        .accessibilityElement(children: .combine)
    }

    private var statusGlyph: some View {
        Image(systemName: status.symbol)
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(status.tint)
            .frame(width: 36, height: 36)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(status.tint.opacity(0.12))
            )
            .overlay {
                if theme.usesMemphisChrome {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(theme.ink.opacity(0.5), lineWidth: 1.2)
                }
            }
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: theme.cardRadius, style: .continuous)
            .fill(theme.surface)
    }

    private var cardBorder: some View {
        RoundedRectangle(cornerRadius: theme.cardRadius, style: .continuous)
            .stroke(
                theme.usesMemphisChrome
                    ? theme.ink.opacity(emphasized ? 0.75 : 0.45)
                    : theme.hairline,
                lineWidth: theme.usesMemphisChrome ? (emphasized ? 1.8 : 1.3) : 1
            )
    }

    private var timeLabel: String {
        let raw = item.updatedAt
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        guard let date else { return String(raw.prefix(10)) }
        let out = DateFormatter()
        out.locale = Locale(identifier: "zh_CN")
        out.dateFormat = "HH:mm"
        return out.string(from: date)
    }
}
