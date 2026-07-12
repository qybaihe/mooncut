import SwiftUI

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    @AppStorage("mooncut:theme") private var themeRaw = AppThemeMode.light.rawValue

    var body: some View {
        List {
            Section("账号") {
                if let user = env.user {
                    LabeledContent("邮箱", value: user.email)
                    Button("退出登录", role: .destructive) {
                        Task { await env.signOut() }
                    }
                    .accessibilityIdentifier("logout-button")
                    NavigationLink {
                        BillingView(api: env.api)
                    } label: {
                        Label("套餐与额度", systemImage: "creditcard")
                    }
                    .accessibilityIdentifier("billing-settings-link")
                }
            }

            Section("外观") {
                Picker("主题", selection: $themeRaw) {
                    ForEach(AppThemeMode.allCases) { mode in
                        Text("\(mode.title) · \(mode.subtitle)").tag(mode.rawValue)
                    }
                }
                .accessibilityIdentifier("settings-theme")
            }

            Section("服务") {
                LabeledContent("Base URL", value: APIConfiguration.current.baseURL.absoluteString)
                LabeledContent("受信 Host", value: APIConfiguration.current.trustedHost)
                ServiceStatusBadge(kind: env.serviceBadge)
                if let health = env.serviceHealth {
                    LabeledContent("网关", value: health.gatewayReachable == true ? "可达" : "不可达")
                    LabeledContent("规划模型", value: health.plannerModel ?? "—")
                }
                if let err = env.serviceError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(theme.danger)
                }
                Button("重新检查") {
                    Task { await env.bootstrap() }
                }
            }

            Section("安全") {
                Text("认证使用邮箱验证码或密码登录后的 Cookie 会话，App 不嵌入 MOONCUT_API_KEY。Web Pages 入口使用系统 TLS；仅显式配置的私有服务才使用捆绑 CA 锚定。")
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
            }
        }
        .navigationTitle("设置")
    }
}
