import SwiftUI

enum MoonColor {
    static let accent = Color(red: 0.04, green: 0.40, blue: 0.82)
    static let accentSoft = Color(red: 0.90, green: 0.95, blue: 1.00)
    static let success = Color(red: 0.10, green: 0.55, blue: 0.32)
    static let warning = Color(red: 0.78, green: 0.48, blue: 0.10)
    static let danger = Color(red: 0.82, green: 0.20, blue: 0.18)

    static let canvas = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.07, green: 0.08, blue: 0.10, alpha: 1)
            : UIColor(red: 0.965, green: 0.97, blue: 0.98, alpha: 1)
    })

    static let card = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.105, green: 0.115, blue: 0.135, alpha: 1)
            : UIColor.white
    })

    static let inset = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.15, green: 0.16, blue: 0.18, alpha: 1)
            : UIColor(red: 0.945, green: 0.95, blue: 0.96, alpha: 1)
    })

    static let hairline = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.10)
            : UIColor.black.withAlphaComponent(0.08)
    })
}

struct MoonCardModifier: ViewModifier {
    var radius: CGFloat = 18

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(MoonColor.card)
                    .shadow(color: .black.opacity(0.035), radius: 12, y: 4)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(MoonColor.hairline, lineWidth: 1)
            )
    }
}

extension View {
    func moonCard(radius: CGFloat = 18) -> some View {
        modifier(MoonCardModifier(radius: radius))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color = MoonColor.accent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 18)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(color.opacity(configuration.isPressed ? 0.78 : 1))
            )
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(MoonColor.inset.opacity(configuration.isPressed ? 0.72 : 1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(MoonColor.hairline, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct MoonLogo: View {
    var compact = false

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(MoonColor.inset)
                Circle()
                    .fill(MoonColor.accent)
                    .frame(width: 18, height: 18)
                    .overlay(alignment: .topTrailing) {
                        Circle()
                            .fill(MoonColor.inset)
                            .frame(width: 17, height: 17)
                            .offset(x: 5, y: -3)
                    }
                Image(systemName: "sparkle")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(MoonColor.accent)
                    .offset(x: 10, y: -10)
            }
            .frame(width: 36, height: 36)
            .accessibilityHidden(true)

            if !compact {
                VStack(alignment: .leading, spacing: 1) {
                    Text("MoonCut")
                        .font(.subheadline.weight(.bold))
                    Text("口播创作台")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("MoonCut 口播创作台")
    }
}

struct AppHeader: View {
    @AppStorage("mooncut:theme") private var theme = ThemeMode.system.rawValue

    var body: some View {
        HStack(spacing: 12) {
            MoonLogo()
            Spacer(minLength: 8)
            Label("本地演示", systemImage: "lock.fill")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(Capsule().fill(MoonColor.inset))
            Menu {
                Picker("外观", selection: $theme) {
                    ForEach(ThemeMode.allCases) { option in
                        Label(option.title, systemImage: option.symbol).tag(option.rawValue)
                    }
                }
            } label: {
                Image(systemName: ThemeMode(rawValue: theme)?.symbol ?? "circle.lefthalf.filled")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(MoonColor.inset))
            }
            .accessibilityLabel("切换外观")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) { Divider().opacity(0.45) }
    }
}

struct BottomWorkspaceBar: View {
    @Binding var selection: WorkspaceTab

    var body: some View {
        HStack(spacing: 8) {
            tabButton(.edit)
            Color.clear.frame(width: 64, height: 48)
            tabButton(.record)
        }
        .padding(6)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 19, style: .continuous)
                .stroke(MoonColor.hairline, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.10), radius: 18, y: 8)
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 4)
    }

    private func tabButton(_ tab: WorkspaceTab) -> some View {
        Button {
            withAnimation(.snappy(duration: 0.22)) { selection = tab }
        } label: {
            Label(tab.title, systemImage: tab.symbol)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(selection == tab ? .white : .secondary)
                .background(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(selection == tab ? MoonColor.accent : .clear)
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selection == tab ? .isSelected : [])
    }
}

struct PageIntro: View {
    let eyebrow: String
    let symbol: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(eyebrow, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(MoonColor.accent)
            Text(title)
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .tracking(-0.6)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StatusPill: View {
    let text: String
    var symbol: String? = nil
    var color = MoonColor.accent

    var body: some View {
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol) }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .frame(minHeight: 30)
        .background(Capsule().fill(color.opacity(0.10)))
    }
}

struct FlowStepper: View {
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
                .foregroundStyle(index <= current ? MoonColor.accent : Color.secondary.opacity(0.42))
                if index < labels.count - 1 {
                    Rectangle()
                        .fill(index < current ? MoonColor.accent.opacity(0.45) : MoonColor.hairline)
                        .frame(maxWidth: 22, maxHeight: 1)
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 38)
        .background(Capsule().fill(MoonColor.card))
        .overlay(Capsule().stroke(MoonColor.hairline, lineWidth: 1))
    }
}

struct ToastView: View {
    let message: String

    var body: some View {
        if !message.isEmpty {
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(minHeight: 48)
                .background(.black.opacity(0.86), in: Capsule())
                .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
                .padding(.horizontal, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .accessibilityAddTraits(.isStaticText)
        }
    }
}

struct EmptyPersonArtwork: View {
    var large = false

    var body: some View {
        ZStack {
            RadialGradient(colors: [MoonColor.accent.opacity(0.24), .clear], center: .center, startRadius: 5, endRadius: large ? 190 : 120)
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
                .foregroundStyle(MoonColor.accent)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(MoonColor.accent.opacity(0.10)))
            Text(title)
                .font(.subheadline.weight(.medium))
            Spacer(minLength: 10)
            content
        }
        .frame(minHeight: 48)
    }
}
