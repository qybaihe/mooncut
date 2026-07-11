import SwiftUI

struct AuthView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL

    @State private var email = ""
    @State private var password = ""
    @State private var isRegister = false
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var errorDiagnostic: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    serviceCard
                    formCard
                    if let errorMessage {
                        ErrorBanner(
                            message: errorMessage,
                            diagnostic: errorDiagnostic,
                            retryTitle: "重试",
                            onRetry: submit
                        )
                    }
                    privacyNote
                }
                .padding(20)
            }
            .background(theme.canvas.ignoresSafeArea())
            .navigationTitle("MoonCut")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    ThemePickerMenu()
                }
            }
        }
        .accessibilityIdentifier("auth-screen")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            MoonLogo()
            Text(isRegister ? "创建账号" : "登录")
                .font(.title2.weight(.bold))
                .foregroundStyle(theme.textPrimary)
            Text("从想法到能发布的口播成片。登录后可上传剪辑、脚本助手与真实陪练。")
                .font(.subheadline)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var serviceCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("服务状态")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                ServiceStatusBadge(kind: env.serviceBadge)
            }
            if env.isPublicPreviewBuild || !APIConfiguration.current.isConfigured {
                Text("这是公开预览包：未绑定可用服务地址，也不能连接内部端口。安装后仅可浏览本地 UI；完整能力需自建 agent 并使用受控私有构建。")
                    .font(.caption)
                    .foregroundStyle(theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let health = env.serviceHealth, health.ok {
                Text("规划模型：\(health.plannerModel ?? "—") · 网关\(health.gatewayReachable == true ? "可达" : "不可达")")
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
            } else if let serviceError = env.serviceError {
                Text(serviceError)
                    .font(.caption)
                    .foregroundStyle(theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("正在检查服务…")
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
            }
            Text("认证方式：邮箱会话 Cookie（不使用 API Key）· 分发：\(APIConfiguration.current.distributionMode)")
                .font(.caption2)
                .foregroundStyle(theme.textTertiary)

            Button {
                Task { await env.recheckService() }
            } label: {
                Label("重新检查服务", systemImage: "arrow.clockwise")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("auth-recheck-service")
        }
        .padding(16)
        .moonCard()
    }

    private var formCard: some View {
        VStack(spacing: 14) {
            Picker("模式", selection: $isRegister) {
                Text("登录").tag(false)
                Text("注册").tag(true)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("auth-mode")

            TextField("邮箱", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("auth-email")

            SecureField("密码（至少 8 位）", text: $password)
                .textContentType(isRegister ? .newPassword : .password)
                .padding(12)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("auth-password")

            Button(action: submit) {
                if isWorking {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 52)
                } else {
                    Text(isRegister ? "注册并开始" : "登录")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isWorking || email.isEmpty || password.count < 8)
            .accessibilityIdentifier("auth-submit")
        }
        .padding(16)
        .moonCard()
    }

    private var privacyNote: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("隐私与安全", systemImage: "lock.shield")
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.textSecondary)
            Text("会话由服务端 HttpOnly Cookie 维持，App 不会读取或保存 Cookie 明文，也不会嵌入服务 API Key。生产环境需信任 mooncut-ca 证书。")
                .font(.caption2)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private func submit() {
        errorMessage = nil
        errorDiagnostic = nil
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                let user: AuthUserDTO
                if isRegister {
                    user = try await env.api.register(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                } else {
                    user = try await env.api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                }
                env.applyAuthenticated(user)
                env.showToast(isRegister ? "注册成功" : "已登录")
            } catch let error as APIError {
                errorMessage = error.errorDescription
                errorDiagnostic = error.diagnosticCode
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
