import SwiftUI

/// Web 端 coach-metrics-hud 的原生对应：玻璃指标卡 + 音量条 + 可用/不可用诚实标注。
struct CoachMetricsHUD: View {
    let items: [CoachMetricDisplay]
    var compact = false

    var body: some View {
        let columns = [
            GridItem(.flexible(), spacing: 8),
            GridItem(.flexible(), spacing: 8),
            GridItem(.flexible(), spacing: 8)
        ]
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(items, id: \.kind) { item in
                metricCard(item)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("coach-metrics-hud")
    }

    private func metricCard(_ item: CoachMetricDisplay) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(item.kind.title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.55))
                Spacer(minLength: 0)
                Circle()
                    .fill(item.isUnavailable ? Color.white.opacity(0.25) : (item.isWarning ? Color.orange : Color.green.opacity(0.85)))
                    .frame(width: 6, height: 6)
                    .shadow(color: (item.isWarning ? Color.orange : Color.green).opacity(0.35), radius: 3)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(item.valueText)
                    .font(.system(size: compact ? 16 : 18, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .monospacedDigit()
                if !item.isUnavailable {
                    Text(item.kind.unit)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.white.opacity(0.45))
                }
            }
            if let level = item.volumeLevel {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.12))
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(red: 0.43, green: 0.86, blue: 0.56),
                                        Color(red: 1.0, green: 0.89, blue: 0.55),
                                        Color(red: 1.0, green: 0.60, blue: 0.45)
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: max(4, geo.size.width * level))
                    }
                }
                .frame(height: 3)
            } else if item.isUnavailable {
                Text("不可用")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.white.opacity(0.4))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, minHeight: compact ? 64 : 72, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(.white.opacity(0.10), lineWidth: 1)
        )
        .accessibilityLabel("\(item.kind.title) \(item.isUnavailable ? "不可用" : item.valueText + item.kind.unit)")
    }
}

struct CoachAdviceBanner: View {
    let advice: String
    var category: String?
    var positive: Bool
    var model: String?
    var analyzing: Bool
    var disconnected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: positive ? "sparkles" : "lightbulb.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(positive ? Color(red: 0.62, green: 0.95, blue: 0.74) : Color(red: 1.0, green: 0.84, blue: 0.65))
                .frame(width: 28, height: 28)
                .background(Circle().fill(.white.opacity(0.10)))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(analyzing ? "小月分析中" : (disconnected ? "教练未连接" : (categoryLabel ?? "实时建议")))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white.opacity(0.5))
                    if let model, !model.isEmpty, !disconnected {
                        Text(model)
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.35))
                    }
                }
                Text(advice)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(positive ? Color(red: 0.04, green: 0.11, blue: 0.08).opacity(0.78) : Color.black.opacity(0.55))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    positive ? Color.green.opacity(0.35) : Color.white.opacity(0.12),
                    lineWidth: 1
                )
        )
        .accessibilityIdentifier("coach-advice")
    }

    private var categoryLabel: String? {
        switch category {
        case "pace": return "语速"
        case "volume": return "音量"
        case "pause": return "停顿"
        case "script": return "稿件"
        case "camera": return "镜头"
        case "steady": return "稳住"
        default: return category
        }
    }
}

struct CoachScriptRibbon: View {
    let previous: String?
    let current: String
    let next: String?
    let speechStatus: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("实时对稿", systemImage: "text.quote")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.75))
                Spacer()
                Text(speechStatus)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.45))
            }
            if let previous, !previous.isEmpty {
                Text(previous)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.35))
                    .lineLimit(2)
            }
            Text(current)
                .font(.title3.weight(.bold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            if let next, !next.isEmpty {
                Text(next)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.45))
                    .lineLimit(2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.black.opacity(0.42))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
        .accessibilityIdentifier("coach-script-ribbon")
    }
}

struct CoachASRCaption: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(Color.red)
                .frame(width: 7, height: 7)
                .padding(.top, 5)
                .shadow(color: .red.opacity(0.5), radius: 4)
            Text(text.isEmpty ? "正在等你开口，实时识别结果会显示在这里。" : text)
                .font(.caption)
                .foregroundStyle(.white.opacity(text.isEmpty ? 0.45 : 0.88))
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.black.opacity(0.4))
        )
        .accessibilityIdentifier("coach-asr-caption")
    }
}
