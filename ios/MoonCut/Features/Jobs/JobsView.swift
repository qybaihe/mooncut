import Observation
import SwiftUI

/// Web no longer exposes a global render queue: Pages can only truthfully show
/// a creator's own job through the authenticated Agent tunnel. Keep the iOS
/// tab on that same contract instead of rendering an empty or invented queue.
@MainActor
@Observable
final class JobsViewModel {
    var job: EditJobDTO?
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
        guard let jobId = env.activeJobId else {
            job = nil
            errorMessage = nil
            isLoading = false
            return
        }
        isLoading = job == nil
        defer { isLoading = false }
        do {
            let latest = try await api.getEditJob(id: jobId)
            job = latest
            errorMessage = nil
            errorDiagnostic = nil
            switch latest.status {
            case .queued, .running:
                env.pet.apply(.jobRunning)
            case .completed:
                env.pet.apply(.jobCompleted)
            case .failed:
                env.pet.apply(.permissionOrNetworkFailure)
            case .unknown:
                break
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
    }
}

struct JobsView: View {
    @State private var model: JobsViewModel
    @Environment(\.theme) private var theme
    var onOpenJob: (String) -> Void

    init(api: MoonCutAPIClient, env: AppEnvironment, onOpenJob: @escaping (String) -> Void) {
        _model = State(initialValue: JobsViewModel(api: api, env: env))
        self.onOpenJob = onOpenJob
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

                if let job = model.job {
                    JobDetailCard(job: job) {
                        onOpenJob(job.id)
                    }
                } else if !model.isLoading && model.errorMessage == nil {
                    StudioEmptyState(
                        title: "暂无可恢复任务",
                        systemImage: "tray",
                        description: "开始剪辑后，这里会每 3 秒读取你自己的真实任务阶段与进度；不会显示或编造全局队列。",
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
                ProgressView("读取我的任务…")
                    .padding(16)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityIdentifier("jobs-screen")
    }

    private var header: some View {
        ZStack(alignment: .topTrailing) {
            StudioSectionHeader(
                eyebrow: "我的剪辑任务",
                title: title,
                subtitle: "状态由与 Web 相同的 /v1/edit-jobs/{id} 接口提供。任务未完成时会自动刷新，完成后可回到剪辑台复核。",
                symbol: "list.bullet.rectangle"
            )
            if theme.usesMemphisChrome {
                MemphisAccentShape(style: .corner)
                    .padding(.trailing, 4)
            }
        }
    }

    private var title: String {
        guard let status = model.job?.status else { return "从一条真实剪辑开始。" }
        switch status {
        case .queued: return "任务正在排队。"
        case .running: return "任务正在制作。"
        case .completed: return "成片已准备好复核。"
        case .failed: return "任务需要重新处理。"
        case .unknown: return "等待服务更新任务状态。"
        }
    }
}

private struct JobDetailCard: View {
    @Environment(\.theme) private var theme
    let job: EditJobDTO
    let onOpen: () -> Void

    private var tint: Color {
        switch job.status {
        case .completed: return theme.success
        case .failed: return theme.danger
        case .queued: return theme.warning
        case .running, .unknown: return theme.accent
        }
    }

    private var statusLabel: String {
        switch job.status {
        case .queued: return "排队中"
        case .running: return "处理中"
        case .completed: return "已完成"
        case .failed: return "失败"
        case .unknown: return "等待更新"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: job.status == .completed ? "checkmark.seal.fill" : job.status == .failed ? "exclamationmark.triangle.fill" : "film.stack")
                    .foregroundStyle(tint)
                    .frame(width: 36, height: 36)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(job.request?.title ?? job.originalName ?? "MoonCut 剪辑任务")
                        .font(.headline)
                        .foregroundStyle(theme.textPrimary)
                    Text(JobStageCopy.title(for: job.stage))
                        .font(.subheadline)
                        .foregroundStyle(theme.textSecondary)
                }
                Spacer(minLength: 8)
                StatusPill(text: statusLabel, symbol: "circle.fill", tint: tint)
            }

            if let progress = job.progress {
                ProgressView(value: min(1, max(0, progress)))
                    .tint(tint)
                Text("\(Int((min(1, max(0, progress)) * 100).rounded()))% · 服务端进度")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(theme.textTertiary)
            } else if job.status == .queued || job.status == .running {
                ProgressView().tint(tint)
                Text("暂未收到数值进度，仍在等待服务更新。")
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
            }

            if let error = job.error, !error.isEmpty {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: onOpen) {
                Label(job.status == .completed ? "查看成片与质检" : "打开剪辑任务", systemImage: "arrow.right.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("jobs-open-active")
        }
        .padding(16)
        .moonCard(radius: 18)
    }
}
