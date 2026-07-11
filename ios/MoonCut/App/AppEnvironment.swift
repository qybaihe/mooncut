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

    func bootstrap() async {
        isRestoringSession = true
        defer { isRestoringSession = false }

        do {
            serviceHealth = try await api.healthz()
            serviceError = nil
        } catch {
            serviceHealth = nil
            serviceError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }

        do {
            if let sessionUser = try await api.session() {
                user = sessionUser
                activeJobId = UserDefaults.standard.string(forKey: namespaced(activeJobKey))
            } else {
                user = nil
            }
        } catch let error as APIError where error == .unauthorized {
            user = nil
        } catch {
            // Session restore failure is not fatal for login screen
            user = nil
            if serviceError == nil {
                serviceError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func applyAuthenticated(_ user: AuthUserDTO) {
        self.user = user
        activeJobId = UserDefaults.standard.string(forKey: namespaced(activeJobKey))
        // 登录后立刻确认会话可读，避免 Cookie 未落盘却显示已登录
        Task {
            do {
                if let sessionUser = try await api.session() {
                    self.user = sessionUser
                } else if !(await api.hasSessionCookie()) {
                    // Cookie 未建立：保持 user 但标记服务问题，后续请求失败会回登录
                    serviceError = "登录响应已收到，但会话 Cookie 尚未建立。请重试登录。"
                }
            } catch {
                // 不立即踢出；由后续真实请求决定
            }
        }
    }

    func signOut() async {
        do {
            try await api.logout()
        } catch {
            await api.clearCookies()
        }
        user = nil
        showToast("已退出登录", isError: false)
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
        if let serviceHealth, serviceHealth.ok { return .connected }
        if serviceError != nil { return .unavailable }
        return .unconfigured
    }
}
