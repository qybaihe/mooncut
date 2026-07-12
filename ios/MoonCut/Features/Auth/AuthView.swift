import SwiftUI

struct AuthView: View {
    private enum LoginMethod: String, CaseIterable, Identifiable {
        case otp
        case password

        var id: String { rawValue }
        var title: String { self == .otp ? "验证码登录" : "密码登录" }
    }

    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme

    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var isRegister = false
    @State private var loginMethod: LoginMethod = .otp
    @State private var isWorking = false
    @State private var isSendingOTP = false
    @State private var otpStatus: String?
    @State private var errorMessage: String?
    @State private var errorDiagnostic: String?
    @State private var lastAction: LastAction = .submit

    private enum LastAction {
        case sendOTP
        case submit
    }

    private var otpPurpose: AuthOTPPurpose { isRegister ? .register : .login }
    private var needsOTP: Bool { isRegister || loginMethod == .otp }
    private var normalizedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var emailIsValid: Bool {
        normalizedEmail.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil
    }
    private var codeIsValid: Bool {
        code.range(of: "^\\d{6}$", options: .regularExpression) != nil
    }
    private var canSubmit: Bool {
        guard emailIsValid, !isWorking else { return false }
        if needsOTP { return codeIsValid && (!isRegister || password.count >= 8) }
        return password.count >= 8
    }

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
                            retryTitle: lastAction == .sendOTP ? "重新发送" : "重试",
                            onRetry: retryLastAction
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
        .onChange(of: isRegister) { _, _ in resetMethodState() }
        .onChange(of: loginMethod) { _, _ in resetMethodState() }
        .accessibilityIdentifier("auth-screen")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            MoonLogo()
            Text(isRegister ? "创建账号" : "登录")
                .font(.title2.weight(.bold))
                .foregroundStyle(theme.textPrimary)
            Text("从想法到能发布的口播成片。登录后可上传剪辑、使用脚本助手与真实陪练。")
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
                Text("这是公开预览包：未绑定可用服务地址，也不能连接内部端口。完整能力需使用受控构建。")
                    .font(.caption)
                    .foregroundStyle(theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let health = env.serviceHealth, health.ok {
                Text("已连接 Web 同源 API · 规划模型：\(health.plannerModel ?? "—") · 网关\(health.gatewayReachable == true ? "可达" : "不可达")")
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
            Text("认证方式：邮箱验证码或密码 · 服务端 HttpOnly Cookie 会话 · 不使用 API Key")
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

            if !isRegister {
                Picker("登录方式", selection: $loginMethod) {
                    ForEach(LoginMethod.allCases) { method in
                        Text(method.title).tag(method)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("auth-login-method")
            }

            TextField("邮箱", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("auth-email")

            if isRegister || loginMethod == .password {
                SecureField(isRegister ? "设置密码（至少 8 位）" : "密码", text: $password)
                    .textContentType(isRegister ? .newPassword : .password)
                    .padding(12)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("auth-password")
            }

            if needsOTP {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        TextField("6 位邮箱验证码", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .padding(12)
                            .background(theme.inset, in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityIdentifier("auth-otp-code")
                        Button(action: sendOTP) {
                            if isSendingOTP {
                                ProgressView()
                                    .frame(minWidth: 76, minHeight: 44)
                            } else {
                                Text("获取验证码")
                                    .font(.caption.weight(.semibold))
                                    .frame(minWidth: 76, minHeight: 44)
                            }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(isSendingOTP || isWorking || !emailIsValid)
                        .accessibilityIdentifier("auth-send-otp")
                    }
                    if let otpStatus {
                        Text(otpStatus)
                            .font(.caption)
                            .foregroundStyle(theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            Button(action: submit) {
                if isWorking {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 52)
                } else {
                    Text(submitTitle)
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!canSubmit)
            .accessibilityIdentifier("auth-submit")
        }
        .padding(16)
        .moonCard()
    }

    private var submitTitle: String {
        if isRegister { return "验证并注册" }
        return loginMethod == .otp ? "验证并登录" : "登录"
    }

    private var privacyNote: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("隐私与安全", systemImage: "lock.shield")
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.textSecondary)
            Text("会话由服务端 HttpOnly Cookie 维持，App 不会读取或保存 Cookie 明文，也不会嵌入服务 API Key。生产 Web API 使用系统证书校验。")
                .font(.caption2)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private func resetMethodState() {
        code = ""
        otpStatus = nil
        errorMessage = nil
        errorDiagnostic = nil
    }

    private func retryLastAction() {
        lastAction == .sendOTP ? sendOTP() : submit()
    }

    private func sendOTP() {
        guard emailIsValid, !isSendingOTP else { return }
        lastAction = .sendOTP
        errorMessage = nil
        errorDiagnostic = nil
        isSendingOTP = true
        Task {
            defer { isSendingOTP = false }
            do {
                let response = try await env.api.sendAuthOTP(email: normalizedEmail, purpose: otpPurpose)
                otpStatus = "验证码已发送到 \(response.email)，约 \(max(1, response.expiresInSec / 60)) 分钟内有效。"
            } catch let error as APIError {
                errorMessage = error.errorDescription
                errorDiagnostic = error.diagnosticCode
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func submit() {
        guard canSubmit else { return }
        lastAction = .submit
        errorMessage = nil
        errorDiagnostic = nil
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                let user: AuthUserDTO
                if isRegister {
                    user = try await env.api.register(email: normalizedEmail, password: password, code: code)
                } else if loginMethod == .otp {
                    user = try await env.api.login(email: normalizedEmail, code: code)
                } else {
                    user = try await env.api.login(email: normalizedEmail, password: password)
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
