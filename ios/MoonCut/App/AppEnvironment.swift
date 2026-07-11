import Foundation
import Observation
import SwiftUI

@MainActor
@Observable
final class AppEnvironment {
    let api: MoonCutAPIClient
    let pet: PetStateStore
    var user: AuthUserDTO?
    var isRestoringSession = true
    var serviceHealth: HealthzDTO?
    var serviceError: String?
    var selectedTab: AppTab = .create
    var isImmersiveTeleprompter = false
    var toast: String = ""
    var toastIsError = false
    var keyboardVisible = false

    private var toastTask: Task<Void, Never>?
    private var bootstrapGeneration = 0
    private let activeJobKey = "mooncut:active-job-id"
    private let activeAssetKey = "mooncut:active-asset-id"

    var isAuthenticated: Bool { user != nil }

    var activeJobId: String? {
        didSet {
            if let activeJobId {
                UserDefaults.standard.set(activeJobId, forKey: namespaced(activeJobKey))
            } else {
                UserDefaults.standard.removeObject(forKey: namespaced(activeJobKey))
            }
        }
    }

    var lastDraftPreview: String {
        UserDefaults.standard.string(forKey: namespaced("mooncut:draft")) ?? ""
    }

    init(api: MoonCutAPIClient = MoonCutAPIClient()) {
        self.api = api
        self.pet = PetStateStore()
        self.activeJobId = UserDefaults.standard.string(forKey: "mooncut:active-job-id")
    }

    /// 冷启动：检查服务 + 恢复会话。必须有总超时，避免服务不可达时一直停在「恢复会话…」。
    func bootstrap() async {
        bootstrapGeneration += 1
        let generation = bootstrapGeneration
        isRestoringSession = true
        defer {
            if generation == bootstrapGeneration {
                isRestoringSession = false
            }
        }

        // 公开包 / 未配置：立刻进入登录壳，不发网络
        if !APIConfiguration.current.isConfigured {
            user = nil
            serviceHealth = nil
            serviceError = "公开预览包未配置服务地址，仅可浏览本地界面。"
            return
        }

        do {
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { @MainActor in
                    await self.restoreSessionOnce(generation: generation)
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: 6_000_000_000)
                    throw APIError.transport("连接服务超时（6s）。请确认 agent 已启动，或稍后在登录页重试。")
                }
                // 先完成者胜出；超时会取消另一路，避免永久卡在启动页
                try await group.next()
                group.cancelAll()
            }
        } catch is CancellationError {
            // 被更新一轮 bootstrap 取消
        } catch {
            guard generation == bootstrapGeneration else { return }
            user = nil
            serviceHealth = nil
            if serviceError == nil {
                serviceError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    /// 单次健康检查 + 会话恢复（失败应快速落到登录页，不阻塞 UI）。
    private func restoreSessionOnce(generation: Int) async {
        do {
            try Task.checkCancellation()
            let health = try await api.healthz()
            guard generation == bootstrapGeneration else { return }
            serviceHealth = health
            serviceError = nil
        } catch is CancellationError {
            return
        } catch {
            guard generation == bootstrapGeneration else { return }
            serviceHealth = nil
            serviceError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            // 健康检查失败时仍尝试 session（可能是 health 路径问题），但不要再拖很久
        }

        do {
            try Task.checkCancellation()
            let sessionUser = try await api.session()
            guard generation == bootstrapGeneration else { return }
            if let sessionUser {
                user = sessionUser
                activeJobId = UserDefaults.standard.string(forKey: namespaced(activeJobKey))
            } else {
                user = nil
            }
        } catch is CancellationError {
            return
        } catch let error as APIError where error == .unauthorized {
            guard generation == bootstrapGeneration else { return }
            user = nil
        } catch {
            guard generation == bootstrapGeneration else { return }
            user = nil
            if serviceError == nil {
                serviceError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    /// 登录页「重新检查」：不进入全屏恢复态。
    func recheckService() async {
        guard APIConfiguration.current.isConfigured else {
            serviceError = "服务地址未配置（公开预览包）。"
            serviceHealth = nil
            return
        }
        do {
            serviceHealth = try await api.healthz()
            serviceError = nil
        } catch {
            serviceHealth = nil
            serviceError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// 会话身份变更代数：登出/换账号时递增，Root 用它丢弃旧 ViewModel。
    private(set) var sessionEpoch: Int = 0

    func signOut() async {
        do {
            try await api.logout()
        } catch {
            await api.clearCookies()
        }
        // 清掉当前用户内存态；私有草稿仍按 userId 存在 UserDefaults，下次同账号登录再读
        user = nil
        activeJobId = nil
        selectedTab = .create
        isImmersiveTeleprompter = false
        sessionEpoch += 1
        pet.apply(.idle)
        showToast("已退出登录", isError: false)
    }

    func applyAuthenticated(_ user: AuthUserDTO) {
        let previousId = self.user?.id
        self.user = user
        activeJobId = UserDefaults.standard.string(forKey: namespaced(activeJobKey))
        // 换账号时必须换 epoch，强制重建剪辑/脚本模型，避免 A→B 串稿
        if previousId != user.id {
            sessionEpoch += 1
        }
        // 登录后立刻确认会话可读，避免 Cookie 未落盘却显示已登录
        Task {
            do {
                if let sessionUser = try await api.session() {
                    self.user = sessionUser
                } else if !(await api.hasSessionCookie()) {
                    serviceError = "登录响应已收到，但会话 Cookie 尚未建立。请重试登录。"
                }
            } catch {
                // 不立即踢出；由后续真实请求决定
            }
        }
    }

    func showToast(_ message: String, isError: Bool = false) {
        toastTask?.cancel()
        toast = message
        toastIsError = isError
        toastTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_800_000_000)
            guard !Task.isCancelled else { return }
            toast = ""
        }
    }

    func handleAPIError(_ error: Error) {
        if let apiError = error as? APIError, apiError == .unauthorized {
            user = nil
            activeJobId = nil
            isImmersiveTeleprompter = false
            sessionEpoch += 1
            showToast("登录已失效，请重新登录", isError: true)
            pet.apply(.permissionOrNetworkFailure)
            return
        }
        let message = (error as? APIError)?.errorDescription ?? error.localizedDescription
        showToast(message, isError: true)
        pet.apply(.permissionOrNetworkFailure)
    }

    private func namespaced(_ key: String) -> String {
        if let id = user?.id {
            return "\(key):\(id)"
        }
        return key
    }

    var serviceBadge: ServiceStatusBadge.Kind {
        if isRestoringSession { return .loading }
        if !APIConfiguration.current.isConfigured { return .unconfigured }
        if let serviceHealth, serviceHealth.ok { return .connected }
        if serviceError != nil { return .unavailable }
        return .unconfigured
    }

    var isPublicPreviewBuild: Bool {
        APIConfiguration.current.isPublicDistribution
    }
}
