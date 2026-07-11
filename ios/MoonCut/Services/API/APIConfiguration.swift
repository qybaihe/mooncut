import Foundation

/// API 基址与安全相关配置。机密不得写入源码；仅注入 Base URL / 受信 host。
struct APIConfiguration: Sendable, Equatable {
    let baseURL: URL
    let trustedHost: String
    let requestTimeout: TimeInterval
    let resourceTimeout: TimeInterval
    let uploadTimeout: TimeInterval
    let pollInterval: TimeInterval

    static var current: APIConfiguration {
        let info = Bundle.main.infoDictionary
        let rawBase = (info?["MoonCutAPIBaseURL"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback: String
        #if DEBUG
        fallback = "http://127.0.0.1:4317"
        #else
        fallback = "https://42.194.219.172"
        #endif
        let baseString = (rawBase?.isEmpty == false ? rawBase! : fallback)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let host = (info?["MoonCutTrustedHost"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return APIConfiguration(
            baseURL: URL(string: baseString) ?? URL(string: fallback)!,
            trustedHost: (host?.isEmpty == false ? host! : "42.194.219.172"),
            requestTimeout: 30,
            resourceTimeout: 120,
            uploadTimeout: 600,
            pollInterval: 3
        )
    }

    var isLocalHTTP: Bool {
        baseURL.scheme?.lowercased() == "http"
            && (baseURL.host == "127.0.0.1" || baseURL.host == "localhost")
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
