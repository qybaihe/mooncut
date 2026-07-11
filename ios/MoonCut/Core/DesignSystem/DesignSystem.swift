import SwiftUI

// MARK: - Cards & Buttons

struct MoonCardModifier: ViewModifier {
    @Environment(\.theme) private var theme
    var radius: CGFloat?

    func body(content: Content) -> some View {
        let r = radius ?? theme.cardRadius
        content
            .background(
                RoundedRectangle(cornerRadius: r, style: .continuous)
                    .fill(theme.surface)
                    .shadow(
                        color: theme.usesMemphisChrome
                            ? theme.ink.opacity(0.12)
                            : .black.opacity(0.04),
                        radius: theme.usesMemphisChrome ? 0 : 12,
                        x: theme.usesMemphisChrome ? 3 : 0,
                        y: theme.usesMemphisChrome ? 3 : 4
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: r, style: .continuous)
                    .stroke(theme.hairline, lineWidth: theme.usesMemphisChrome ? 1.5 : 1)
            )
    }
}

extension View {
    func moonCard(radius: CGFloat? = nil) -> some View {
        modifier(MoonCardModifier(radius: radius))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 18)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(theme.accent.opacity(isEnabled ? (configuration.isPressed ? 0.78 : 1) : 0.4))
            )
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(theme.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(theme.inset.opacity(configuration.isPressed ? 0.72 : 1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(theme.hairline, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct DestructiveButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(theme.danger.opacity(configuration.isPressed ? 0.78 : 1))
            )
    }
}

// MARK: - Chrome

struct MoonLogo: View {
    @Environment(\.theme) private var theme
    var compact = false

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(theme.inset)
                Circle()
                    .fill(theme.accent)
                    .frame(width: 18, height: 18)
                    .overlay(alignment: .topTrailing) {
                        Circle()
                            .fill(theme.inset)
                            .frame(width: 17, height: 17)
                            .offset(x: 5, y: -3)
                    }
            }
            .frame(width: 36, height: 36)
            .accessibilityHidden(true)

            if !compact {
                VStack(alignment: .leading, spacing: 1) {
                    Text("MoonCut")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.textPrimary)
                    Text("口播创作")
                        .font(.caption2)
                        .foregroundStyle(theme.textSecondary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("MoonCut 口播创作")
    }
}

struct StatusPill: View {
    @Environment(\.theme) private var theme
    let text: String
    var symbol: String? = nil
    var tint: Color? = nil

    var body: some View {
        let color = tint ?? theme.accent
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol) }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .frame(minHeight: 30)
        .background(Capsule().fill(color.opacity(0.12)))
        .accessibilityElement(children: .combine)
    }
}

struct ToastView: View {
    let message: String
    var isError = false

    var body: some View {
        if !message.isEmpty {
            Label(message, systemImage: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(minHeight: 48)
                .background((isError ? Color.red.opacity(0.92) : Color.black.opacity(0.86)), in: Capsule())
                .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
                .padding(.horizontal, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .accessibilityAddTraits(.isStaticText)
                .accessibilityIdentifier("toast")
        }
    }
}

struct EmptyPersonArtwork: View {
    @Environment(\.theme) private var theme
    var large = false

    var body: some View {
        ZStack {
            RadialGradient(
                colors: [theme.accent.opacity(0.24), .clear],
                center: .center,
                startRadius: 5,
                endRadius: large ? 190 : 120
            )
            VStack(spacing: 14) {
                Circle()
                    .fill(.white.opacity(0.17))
                    .frame(width: large ? 100 : 72, height: large ? 100 : 72)
                RoundedRectangle(cornerRadius: large ? 60 : 42, style: .continuous)
                    .fill(.white.opacity(0.14))
                    .frame(width: large ? 220 : 155, height: large ? 170 : 120)
            }
            .offset(y: large ? 52 : 36)
        }
    }
}

struct SettingRow<Content: View>: View {
    @Environment(\.theme) private var theme
    let symbol: String
    let title: String
    let content: Content

    init(symbol: String, title: String, @ViewBuilder content: () -> Content) {
        self.symbol = symbol
        self.title = title
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(theme.accent.opacity(0.10)))
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.textPrimary)
            Spacer(minLength: 10)
            content
        }
        .frame(minHeight: 48)
    }
}

struct FlowStepper: View {
    @Environment(\.theme) private var theme
    let labels: [String]
    let current: Int

    var body: some View {
        HStack(spacing: 7) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                HStack(spacing: 4) {
                    Image(systemName: index < current ? "checkmark.circle.fill" : "\(index + 1).circle.fill")
                    Text(label)
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(index <= current ? theme.accent : theme.textTertiary)
                if index < labels.count - 1 {
                    Rectangle()
                        .fill(index < current ? theme.accent.opacity(0.45) : theme.hairline)
                        .frame(maxWidth: 22, maxHeight: 1)
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 38)
        .background(Capsule().fill(theme.surface))
        .overlay(Capsule().stroke(theme.hairline, lineWidth: 1))
    }
}

struct ErrorBanner: View {
    @Environment(\.theme) private var theme
    let message: String
    var diagnostic: String? = nil
    var retryTitle: String = "重试"
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let diagnostic, !diagnostic.isEmpty {
                Text("诊断：\(diagnostic)")
                    .font(.caption.monospaced())
                    .foregroundStyle(theme.textTertiary)
            }
            if let onRetry {
                Button(retryTitle, action: onRetry)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("error-retry")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(theme.danger.opacity(0.25), lineWidth: 1)
        )
        .accessibilityIdentifier("error-banner")
    }
}

struct ServiceStatusBadge: View {
    @Environment(\.theme) private var theme
    enum Kind {
        case connected, unavailable, unconfigured, loading
        var label: String {
            switch self {
            case .connected: "已真实连接"
            case .unavailable: "服务失败"
            case .unconfigured: "尚未配置"
            case .loading: "检查中"
            }
        }
        var symbol: String {
            switch self {
            case .connected: "checkmark.seal.fill"
            case .unavailable: "wifi.exclamationmark"
            case .unconfigured: "gear.badge.questionmark"
            case .loading: "ellipsis.circle"
            }
        }
    }
    let kind: Kind

    var body: some View {
        StatusPill(
            text: kind.label,
            symbol: kind.symbol,
            tint: kind == .connected ? theme.success : (kind == .loading ? theme.accent : theme.warning)
        )
        .accessibilityIdentifier("service-status")
    }
}

struct ThemePickerMenu: View {
    @AppStorage("mooncut:theme") private var themeRaw = AppThemeMode.light.rawValue
    @Environment(\.theme) private var theme

    var body: some View {
        Menu {
            ForEach(AppThemeMode.allCases) { option in
                Button {
                    themeRaw = option.rawValue
                } label: {
                    Label {
                        Text("\(option.title) · \(option.subtitle)")
                    } icon: {
                        Image(systemName: option.symbol)
                    }
                }
                .accessibilityIdentifier("theme-\(option.rawValue)")
            }
        } label: {
            Label(
                AppThemeMode(rawValue: themeRaw)?.title ?? "主题",
                systemImage: AppThemeMode(rawValue: themeRaw)?.symbol ?? "circle.lefthalf.filled"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(theme.textPrimary)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(Capsule().fill(theme.inset))
        }
        .accessibilityLabel("选择主题")
        .accessibilityValue(AppThemeMode(rawValue: themeRaw)?.title ?? "未选择")
        .accessibilityIdentifier("theme-picker")
    }
}

/// Memphis 点睛：每页最多一组几何装饰，不压内容。
struct MemphisAccentShape: View {
    @Environment(\.theme) private var theme
    var style: Style = .corner

    enum Style {
        case corner
        case strip
        case burst
    }

    var body: some View {
        if theme.usesMemphisChrome {
            Group {
                switch style {
                case .corner:
                    ZStack(alignment: .topTrailing) {
                        Circle()
                            .fill(theme.stickerYellow.opacity(0.55))
                            .frame(width: 48, height: 48)
                            .offset(x: 10, y: -8)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(theme.stickerCyan.opacity(0.5))
                            .frame(width: 28, height: 12)
                            .rotationEffect(.degrees(-18))
                            .offset(x: -28, y: 18)
                    }
                case .strip:
                    HStack(spacing: 8) {
                        Capsule().fill(theme.stickerYellow).frame(width: 36, height: 10)
                        Circle().fill(theme.stickerPink).frame(width: 12, height: 12)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(theme.stickerMint)
                            .frame(width: 22, height: 10)
                            .rotationEffect(.degrees(12))
                    }
                case .burst:
                    ZStack {
                        Circle().stroke(theme.ink.opacity(0.2), lineWidth: 2).frame(width: 56, height: 56)
                        Circle().fill(theme.stickerYellow.opacity(0.7)).frame(width: 18, height: 18)
                        Capsule().fill(theme.stickerCyan).frame(width: 8, height: 28)
                            .rotationEffect(.degrees(35))
                            .offset(x: 16, y: -10)
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Shared section chrome (Jobs / Community 等)

struct StudioSectionHeader: View {
    @Environment(\.theme) private var theme
    let eyebrow: String
    let title: String
    var subtitle: String? = nil
    var symbol: String = "sparkles"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(eyebrow, systemImage: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.accent)
                .labelStyle(.titleAndIcon)
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StudioStatTile: View {
    @Environment(\.theme) private var theme
    let title: String
    let value: String
    var symbol: String
    var accent: Color? = nil

    var body: some View {
        let tint = accent ?? theme.accent
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(tint)
                    .frame(width: 28, height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(tint.opacity(0.14))
                    )
                Spacer(minLength: 0)
            }
            Text(value)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(theme.textPrimary)
                .contentTransition(.numericText())
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 108, alignment: .topLeading)
        .moonCard(radius: theme.usesMemphisChrome ? 12 : 14)
    }
}

struct StudioProgressTrack: View {
    @Environment(\.theme) private var theme
    let progress: Double
    var tint: Color? = nil
    var indeterminate = false

    var body: some View {
        let color = tint ?? theme.accent
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(theme.inset)
                if indeterminate {
                    Capsule()
                        .fill(color.opacity(0.35))
                        .frame(width: max(36, geo.size.width * 0.28))
                } else {
                    Capsule()
                        .fill(
                            theme.usesMemphisChrome
                                ? AnyShapeStyle(LinearGradient(
                                    colors: [color, theme.stickerMint.opacity(0.9)],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                ))
                                : AnyShapeStyle(color)
                        )
                        .frame(width: max(6, geo.size.width * min(1, max(0, progress))))
                }
            }
        }
        .frame(height: theme.usesMemphisChrome ? 10 : 7)
        .overlay {
            if theme.usesMemphisChrome {
                Capsule().stroke(theme.ink.opacity(0.35), lineWidth: 1)
            }
        }
    }
}

struct StudioEmptyState: View {
    @Environment(\.theme) private var theme
    let title: String
    let systemImage: String
    let description: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 14) {
            if theme.usesMemphisChrome {
                MemphisAccentShape(style: .burst)
            }
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 72, height: 72)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(theme.accentSoft)
                )
                .overlay {
                    if theme.usesMemphisChrome {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(theme.ink.opacity(0.55), lineWidth: 1.5)
                            .offset(x: 3, y: 3)
                            .opacity(0.35)
                    }
                }
            Text(title)
                .font(.headline)
                .foregroundStyle(theme.textPrimary)
            Text(description)
                .font(.subheadline)
                .foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 4)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .moonCard()
    }
}

struct JobStatusStyle {
    let label: String
    let symbol: String
    let tint: Color

    static func resolve(status: String, stage: String? = nil, theme: ThemeTokens) -> JobStatusStyle {
        if stage == "interrupted" || status == "interrupted" {
            return JobStatusStyle(label: "中断", symbol: "pause.circle.fill", tint: theme.warning)
        }
        switch status {
        case "running":
            return JobStatusStyle(label: "制作中", symbol: "bolt.fill", tint: theme.accent)
        case "queued":
            return JobStatusStyle(label: "排队", symbol: "hourglass", tint: theme.warning)
        case "completed":
            return JobStatusStyle(label: "已完成", symbol: "checkmark.circle.fill", tint: theme.success)
        case "failed":
            return JobStatusStyle(label: "失败", symbol: "exclamationmark.triangle.fill", tint: theme.danger)
        default:
            return JobStatusStyle(label: status, symbol: "circle", tint: theme.textSecondary)
        }
    }
}
