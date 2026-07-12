import Foundation

/// API 基址与安全相关配置。机密不得写入源码；仅注入 Base URL / 受信 host。
struct APIConfiguration: Sendable, Equatable {
    enum TLSMode: String, Sendable, Equatable {
        case system
        case pinnedPrivateCA = "pinned-private-ca"
    }

    let baseURL: URL
    let trustedHost: String
    let tlsMode: TLSMode
    let requestTimeout: TimeInterval
    let resourceTimeout: TimeInterval
    let uploadTimeout: TimeInterval
    let pollInterval: TimeInterval
    /// false：公开包或未注入地址，禁止假装已连上服务
    let isConfigured: Bool
    let distributionMode: String

    /// 公开分发包占位 host（DNS 不可达，且不会指向内网）
    static let unconfiguredPlaceholder = "https://mooncut.unconfigured.invalid"

    static var current: APIConfiguration {
        let info = Bundle.main.infoDictionary
        let rawBase = (info?["MoonCutAPIBaseURL"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let host = (info?["MoonCutTrustedHost"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let mode = (info?["MoonCutDistributionMode"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        let tlsRaw = (info?["MoonCutTLSMode"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        let tlsMode = TLSMode(rawValue: tlsRaw) ?? .system

        #if PUBLIC_DISTRIBUTION
        let forcePublic = true
        #else
        let forcePublic = mode == "public"
        #endif

        let unconfiguredTokens: Set<String> = ["", "UNCONFIGURED", "unconfigured", "NONE", "none"]
        if forcePublic || unconfiguredTokens.contains(rawBase) {
            return APIConfiguration(
                baseURL: URL(string: unconfiguredPlaceholder)!,
                trustedHost: "",
                tlsMode: .system,
                requestTimeout: 15,
                resourceTimeout: 30,
                uploadTimeout: 60,
                pollInterval: 3,
                isConfigured: false,
                distributionMode: forcePublic || mode == "public" ? "public" : "unconfigured"
            )
        }

        let fallback: String
        #if DEBUG
        fallback = "https://mooncut.me/api"
        // Debug uses the same edge contract with a shorter timeout so a local
        // network failure cannot hold the launch screen indefinitely.
        let reqTimeout: TimeInterval = 5
        let resTimeout: TimeInterval = 8
        #else
        // Only non-public Release can reach this fallback; public builds are
        // intercepted above and remain intentionally unconfigured.
        fallback = "https://mooncut.me/api"
        let reqTimeout: TimeInterval = 30
        let resTimeout: TimeInterval = 120
        #endif

        let baseString = (rawBase.isEmpty ? fallback : rawBase)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let resolvedHost = host.isEmpty ? (URL(string: baseString)?.host ?? "") : host

        return APIConfiguration(
            baseURL: URL(string: baseString) ?? URL(string: fallback)!,
            trustedHost: resolvedHost,
            tlsMode: tlsMode,
            requestTimeout: reqTimeout,
            resourceTimeout: resTimeout,
            uploadTimeout: 600,
            pollInterval: 3,
            isConfigured: true,
            distributionMode: mode.isEmpty ? "internal" : mode
        )
    }

    var isLocalHTTP: Bool {
        baseURL.scheme?.lowercased() == "http"
            && (baseURL.host == "127.0.0.1" || baseURL.host == "localhost")
    }

    var isPublicDistribution: Bool {
        distributionMode == "public" || !isConfigured
    }

    /// Normal Web/Pages traffic remains on system TLS. A private CA is only
    /// enabled deliberately for an operator-controlled host.
    var requiresPinnedPrivateCA: Bool {
        tlsMode == .pinnedPrivateCA
    }

    func url(path: String, query: [URLQueryItem] = []) -> URL {
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if basePath.isEmpty {
            components.path = normalized
        } else {
            components.path = "/" + basePath + normalized
        }
        if !query.isEmpty {
            components.queryItems = query
        }
        return components.url ?? baseURL.appendingPathComponent(normalized.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }
}
