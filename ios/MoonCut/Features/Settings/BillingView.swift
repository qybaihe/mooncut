import Observation
import SwiftUI

@MainActor
@Observable
final class BillingViewModel {
    var summary: BillingSummaryDTO?
    var isLoading = false
    var isStartingCheckout = false
    var errorMessage: String?
    var errorDiagnostic: String?
    var checkoutNotice: String?
    var checkoutURL: URL?

    private let api: MoonCutAPIClient

    init(api: MoonCutAPIClient) {
        self.api = api
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            summary = try await api.billingSummary()
            errorMessage = nil
            errorDiagnostic = nil
        } catch let error as APIError {
            errorMessage = error.errorDescription
            errorDiagnostic = error.diagnosticCode
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func startCheckout(_ plan: BillingPlanID) async {
        guard !isStartingCheckout else { return }
        isStartingCheckout = true
        defer { isStartingCheckout = false }
        do {
            let result = try await api.createBillingCheckout(plan: plan)
            checkoutNotice = result.message
            checkoutURL = result.checkout.checkoutURL.flatMap(URL.init(string:))
            await load()
        } catch let error as APIError {
            errorMessage = error.errorDescription
            errorDiagnostic = error.diagnosticCode
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct BillingView: View {
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL
    @State private var model: BillingViewModel

    init(api: MoonCutAPIClient) {
        _model = State(initialValue: BillingViewModel(api: api))
    }

    var body: some View {
        List {
            if let summary = model.summary {
                accountSection(summary)
                usageSection(summary)
                plansSection(summary)
                historySection(summary)
            } else if !model.isLoading && model.errorMessage == nil {
                ContentUnavailableView("暂无套餐信息", systemImage: "creditcard", description: Text("下拉刷新后再试。"))
            }

            if let notice = model.checkoutNotice {
                Section("升级状态") {
                    Text(notice)
                        .font(.subheadline)
                        .foregroundStyle(theme.textSecondary)
                    if let url = model.checkoutURL {
                        Button("前往安全支付") { openURL(url) }
                            .buttonStyle(PrimaryButtonStyle())
                            .accessibilityIdentifier("billing-open-checkout")
                    }
                }
            }

            if let error = model.errorMessage {
                Section {
                    ErrorBanner(
                        message: error,
                        diagnostic: model.errorDiagnostic,
                        onRetry: { Task { await model.load() } }
                    )
                }
            }
        }
        .overlay {
            if model.isLoading && model.summary == nil {
                ProgressView("正在读取套餐与额度…")
                    .padding(16)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .navigationTitle("套餐与额度")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task { await model.load() }
        .accessibilityIdentifier("billing-screen")
    }

    @ViewBuilder
    private func accountSection(_ summary: BillingSummaryDTO) -> some View {
        Section("当前方案") {
            LabeledContent("套餐", value: summary.account.planLabel)
            LabeledContent("导出质量", value: summary.account.exportQuality)
            LabeledContent("并行任务", value: "最多 \(summary.account.maxParallelJobs) 个")
            if let endsAt = summary.account.periodEndsAt {
                LabeledContent("周期截至", value: dateLabel(endsAt))
            } else {
                Text("体验方案没有订阅周期，到达额度后可安全发起升级。")
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
            }
            if summary.account.cancelAtPeriodEnd {
                Label("当前方案将在本周期结束后取消", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(theme.warning)
            }
        }
    }

    @ViewBuilder
    private func usageSection(_ summary: BillingSummaryDTO) -> some View {
        Section("本期使用") {
            UsageMeterRow(title: "视频生成", meter: summary.usage.videoGenerations, unit: "次", symbol: "film")
            UsageMeterRow(title: "智能分钟", meter: summary.usage.smartMinutes, unit: "分钟", symbol: "clock")
            UsageMeterRow(title: "创作点", meter: summary.usage.creativePoints, unit: "点", symbol: "sparkles")
            if let seconds = summary.limits.maxSourceSeconds {
                LabeledContent("单条素材上限", value: MediaFormatters.duration(Double(seconds)))
            }
            if let prompt = summary.upgradePrompt {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(prompt.title).font(.subheadline.weight(.semibold))
                        Text(prompt.detail).font(.caption)
                    }
                } icon: {
                    Image(systemName: prompt.level == "critical" ? "exclamationmark.triangle.fill" : "info.circle.fill")
                }
                .foregroundStyle(prompt.level == "critical" ? theme.warning : theme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func plansSection(_ summary: BillingSummaryDTO) -> some View {
        Section("升级方案") {
            if !summary.limits.checkoutConfigured {
                Text("支付通道仍在配置中；你可以查看额度，发起升级不会扣费或提前开通权益。")
                    .font(.caption)
                    .foregroundStyle(theme.warning)
            }
            ForEach(summary.plans.filter { $0.id != .free }) { plan in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(plan.label).font(.headline)
                            Text("¥\(plan.priceCny) / 月 · \(plan.exportQuality) 导出 · 最多 \(plan.maxParallelJobs) 个并行任务")
                                .font(.caption)
                                .foregroundStyle(theme.textSecondary)
                        }
                        Spacer()
                        if plan.id == summary.account.plan {
                            Text("当前")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(theme.accent)
                        }
                    }
                    Button {
                        Task { await model.startCheckout(plan.id) }
                    } label: {
                        if model.isStartingCheckout {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text(plan.id == summary.account.plan ? "当前方案" : "发起安全升级")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.isStartingCheckout || plan.id == summary.account.plan)
                    .accessibilityIdentifier("billing-checkout-\(plan.id.rawValue)")
                }
                .padding(.vertical, 3)
            }
        }
    }

    @ViewBuilder
    private func historySection(_ summary: BillingSummaryDTO) -> some View {
        Section("账单与升级记录") {
            if summary.checkoutRequests.isEmpty {
                Text("还没有升级请求。")
                    .foregroundStyle(theme.textSecondary)
            } else {
                ForEach(summary.checkoutRequests) { request in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(request.requestedPlan == .pro ? "Pro · 专业版" : "Creator · 创作版")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(checkoutStatus(request.status))
                                .font(.caption)
                                .foregroundStyle(theme.textSecondary)
                        }
                        Text(dateLabel(request.createdAt))
                            .font(.caption2)
                            .foregroundStyle(theme.textTertiary)
                        if request.status == "ready_for_payment", let rawURL = request.checkoutURL, let url = URL(string: rawURL) {
                            Button("继续安全支付") { openURL(url) }
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
            }
        }
    }

    private func checkoutStatus(_ status: String) -> String {
        [
            "pending_setup": "等待支付通道配置",
            "ready_for_payment": "等待支付",
            "paid": "已支付",
            "expired": "已过期",
            "cancelled": "已取消"
        ][status] ?? status
    }

    private func dateLabel(_ raw: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: raw) else { return raw }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private struct UsageMeterRow: View {
    @Environment(\.theme) private var theme
    let title: String
    let meter: BillingMeterDTO
    let unit: String
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Label(title, systemImage: symbol)
                Spacer()
                Text(label)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(theme.textSecondary)
            }
            ProgressView(value: progress)
                .tint(theme.accent)
        }
        .padding(.vertical, 2)
    }

    private var label: String {
        meter.limit.map { "\(meter.used) / \($0) \(unit)" } ?? "\(meter.used) \(unit)"
    }

    private var progress: Double {
        guard let limit = meter.limit, limit > 0 else { return meter.used > 0 ? 0.22 : 0 }
        return min(1, Double(meter.used) / Double(limit))
    }
}
