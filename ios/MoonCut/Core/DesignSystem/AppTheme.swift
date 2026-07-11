import SwiftUI

/// 三主题：`light` | `dark` | `memphis`。持久化键 `mooncut:theme`。
enum AppThemeMode: String, CaseIterable, Identifiable, Sendable {
    case light
    case dark
    case memphis

    var id: String { rawValue }

    var title: String {
        switch self {
        case .light: "浅色"
        case .dark: "深色"
        case .memphis: "Memphis"
        }
    }

    var symbol: String {
        switch self {
        case .light: "sun.max"
        case .dark: "moon.stars"
        case .memphis: "paintpalette"
        }
    }

    var subtitle: String {
        switch self {
        case .light: "高级编辑台"
        case .dark: "影视工作间"
        case .memphis: "暖纸点睛"
        }
    }

    /// 系统 ColorScheme 偏好。Memphis 不强制浅色，跟随系统可读性。
    var preferredColorScheme: ColorScheme? {
        switch self {
        case .light: .light
        case .dark: .dark
        case .memphis: nil
        }
    }

    static func resolved(stored: String?, system: ColorScheme) -> AppThemeMode {
        if let stored, let mode = AppThemeMode(rawValue: stored) {
            return mode
        }
        return system == .dark ? .dark : .light
    }
}

/// 集中式 semantic tokens。View 层只读 ThemeTokens，不散落 RGB。
struct ThemeTokens {
    let mode: AppThemeMode
    let canvas: Color
    let surface: Color
    let inset: Color
    let elevated: Color
    let hairline: Color
    let textPrimary: Color
    let textSecondary: Color
    let textTertiary: Color
    let accent: Color
    let accentSoft: Color
    let success: Color
    let warning: Color
    let danger: Color
    let videoWell: Color
    let stickerYellow: Color
    let stickerPink: Color
    let stickerCyan: Color
    let stickerMint: Color
    let ink: Color
    let cardRadius: CGFloat
    let usesMemphisChrome: Bool

    static func tokens(for mode: AppThemeMode, colorScheme: ColorScheme) -> ThemeTokens {
        switch mode {
        case .light:
            return ThemeTokens(
                mode: .light,
                canvas: Color(red: 0.965, green: 0.962, blue: 0.955),
                surface: Color.white,
                inset: Color(red: 0.945, green: 0.942, blue: 0.935),
                elevated: Color.white,
                hairline: Color.black.opacity(0.08),
                textPrimary: Color(red: 0.12, green: 0.13, blue: 0.15),
                textSecondary: Color(red: 0.35, green: 0.37, blue: 0.40),
                textTertiary: Color(red: 0.55, green: 0.56, blue: 0.58),
                accent: Color(red: 0.12, green: 0.38, blue: 0.78),
                accentSoft: Color(red: 0.90, green: 0.94, blue: 0.99),
                success: Color(red: 0.12, green: 0.52, blue: 0.34),
                warning: Color(red: 0.76, green: 0.48, blue: 0.10),
                danger: Color(red: 0.78, green: 0.22, blue: 0.18),
                videoWell: Color(red: 0.08, green: 0.09, blue: 0.11),
                stickerYellow: .clear,
                stickerPink: .clear,
                stickerCyan: .clear,
                stickerMint: .clear,
                ink: Color(red: 0.12, green: 0.13, blue: 0.15),
                cardRadius: 16,
                usesMemphisChrome: false
            )
        case .dark:
            return ThemeTokens(
                mode: .dark,
                canvas: Color(red: 0.09, green: 0.095, blue: 0.11),
                surface: Color(red: 0.13, green: 0.14, blue: 0.16),
                inset: Color(red: 0.17, green: 0.18, blue: 0.20),
                elevated: Color(red: 0.16, green: 0.17, blue: 0.19),
                hairline: Color.white.opacity(0.10),
                textPrimary: Color(red: 0.93, green: 0.94, blue: 0.95),
                textSecondary: Color(red: 0.72, green: 0.74, blue: 0.76),
                textTertiary: Color(red: 0.55, green: 0.57, blue: 0.60),
                accent: Color(red: 0.45, green: 0.62, blue: 0.92),
                accentSoft: Color(red: 0.18, green: 0.24, blue: 0.34),
                success: Color(red: 0.35, green: 0.72, blue: 0.52),
                warning: Color(red: 0.90, green: 0.68, blue: 0.30),
                danger: Color(red: 0.92, green: 0.42, blue: 0.38),
                videoWell: Color.black,
                stickerYellow: .clear,
                stickerPink: .clear,
                stickerCyan: .clear,
                stickerMint: .clear,
                ink: Color(red: 0.93, green: 0.94, blue: 0.95),
                cardRadius: 16,
                usesMemphisChrome: false
            )
        case .memphis:
            // 暖纸张 + 墨色描边；Memphis 默认走暖纸气质（不绑死系统 ColorScheme）
            // 系统深色时略调暗纸张以保对比度
            let isDark = colorScheme == .dark
            return ThemeTokens(
                mode: .memphis,
                canvas: isDark
                    ? Color(red: 0.16, green: 0.13, blue: 0.11)
                    : Color(red: 0.985, green: 0.945, blue: 0.88),
                surface: isDark
                    ? Color(red: 0.22, green: 0.18, blue: 0.15)
                    : Color(red: 1.0, green: 0.988, blue: 0.955),
                inset: isDark
                    ? Color(red: 0.26, green: 0.22, blue: 0.18)
                    : Color(red: 0.96, green: 0.90, blue: 0.80),
                elevated: isDark
                    ? Color(red: 0.24, green: 0.20, blue: 0.16)
                    : Color(red: 1.0, green: 0.995, blue: 0.97),
                hairline: isDark
                    ? Color.white.opacity(0.16)
                    : Color(red: 0.10, green: 0.08, blue: 0.06).opacity(0.88),
                textPrimary: isDark
                    ? Color(red: 0.97, green: 0.94, blue: 0.90)
                    : Color(red: 0.10, green: 0.08, blue: 0.06),
                textSecondary: isDark
                    ? Color(red: 0.80, green: 0.74, blue: 0.68)
                    : Color(red: 0.30, green: 0.26, blue: 0.22),
                textTertiary: isDark
                    ? Color(red: 0.60, green: 0.55, blue: 0.48)
                    : Color(red: 0.48, green: 0.42, blue: 0.36),
                accent: isDark
                    ? Color(red: 0.30, green: 0.78, blue: 0.82)
                    : Color(red: 0.08, green: 0.42, blue: 0.52),
                accentSoft: isDark
                    ? Color(red: 0.22, green: 0.30, blue: 0.28)
                    : Color(red: 0.86, green: 0.95, blue: 0.92),
                success: Color(red: 0.18, green: 0.58, blue: 0.40),
                warning: Color(red: 0.94, green: 0.70, blue: 0.10),
                danger: Color(red: 0.88, green: 0.26, blue: 0.30),
                videoWell: Color(red: 0.08, green: 0.07, blue: 0.06),
                stickerYellow: Color(red: 1.0, green: 0.84, blue: 0.12),
                stickerPink: Color(red: 1.0, green: 0.48, blue: 0.66),
                stickerCyan: Color(red: 0.28, green: 0.80, blue: 0.90),
                stickerMint: Color(red: 0.40, green: 0.90, blue: 0.68),
                ink: isDark
                    ? Color(red: 0.97, green: 0.94, blue: 0.90)
                    : Color(red: 0.08, green: 0.06, blue: 0.05),
                cardRadius: 12,
                usesMemphisChrome: true
            )
        }
    }
}

private struct ThemeTokensKey: EnvironmentKey {
    static let defaultValue = ThemeTokens.tokens(for: .light, colorScheme: .light)
}

extension EnvironmentValues {
    var theme: ThemeTokens {
        get { self[ThemeTokensKey.self] }
        set { self[ThemeTokensKey.self] = newValue }
    }
}

struct ThemeProvider: ViewModifier {
    @AppStorage("mooncut:theme") private var themeRaw = ""
    @Environment(\.colorScheme) private var systemScheme

    func body(content: Content) -> some View {
        let mode = AppThemeMode.resolved(stored: themeRaw.isEmpty ? nil : themeRaw, system: systemScheme)
        let tokens = ThemeTokens.tokens(for: mode, colorScheme: systemScheme)
        content
            .environment(\.theme, tokens)
            .preferredColorScheme(mode.preferredColorScheme)
            .background(tokens.canvas.ignoresSafeArea())
    }
}

extension View {
    func moonTheme() -> some View {
        modifier(ThemeProvider())
    }
}
