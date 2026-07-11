import Foundation

/// MoonCut 服务客户端。使用 Cookie 会话，绝不嵌入 API Key。
actor MoonCutAPIClient {
    let configuration: APIConfiguration
    private let session: URLSession
    private let cookieStorage: HTTPCookieStorage
    private let trustDelegate: MoonCutCertificateTrust
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(configuration: APIConfiguration = .current, session: URLSession? = nil) {
        self.configuration = configuration
        // 使用 shared cookie jar：系统会正确接收 HttpOnly Set-Cookie 并在同 host 请求中回传。
        // 不把 Cookie 值写入 UserDefaults；注销时只清除本服务 host 的 cookie。
        let cookies = HTTPCookieStorage.shared
        self.cookieStorage = cookies

        let caData = MoonCutCertificateTrust.loadBundledCA()
        let trust = MoonCutCertificateTrust(
            trustedHost: configuration.trustedHost,
            caCertificateData: caData
        )
        self.trustDelegate = trust

        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.httpCookieStorage = cookies
            config.httpCookieAcceptPolicy = .always
            config.httpShouldSetCookies = true
            config.timeoutIntervalForRequest = configuration.requestTimeout
            config.timeoutIntervalForResource = configuration.resourceTimeout
            // 切勿 waitsForConnectivity：本机 agent 未启动时会长时间挂起「恢复会话」
            config.waitsForConnectivity = false
            config.urlCache = nil
            self.session = URLSession(configuration: config, delegate: trust, delegateQueue: nil)
        }

        let decoder = JSONDecoder()
        self.decoder = decoder
        self.encoder = JSONEncoder()
    }

    // MARK: - Health

    func healthz() async throws -> HealthzDTO {
        guard configuration.isConfigured else {
            throw APIError.notConfigured(
                "当前安装包未配置可用服务地址（公开预览包）。请自建 mooncut-pi-agent 并使用受控 Release/Debug 配置，勿把内网端口打进公开 IPA。"
            )
        }
        return try await get("/healthz")
    }

    // MARK: - Auth (Cookie session)

    func register(email: String, password: String) async throws -> AuthUserDTO {
        let envelope: AuthLoginEnvelope = try await postJSON(
            "/v1/auth/register",
            body: ["email": email, "password": password]
        )
        return envelope.user
    }

    func login(email: String, password: String) async throws -> AuthUserDTO {
        let envelope: AuthLoginEnvelope = try await postJSON(
            "/v1/auth/login",
            body: ["email": email, "password": password]
        )
        return envelope.user
    }

    func session() async throws -> AuthUserDTO? {
        let envelope: AuthUserEnvelope = try await get("/v1/auth/session")
        return envelope.user
    }

    func me() async throws -> AuthUserDTO {
        let envelope: AuthLoginEnvelope = try await get("/v1/auth/me")
        return envelope.user
    }

    func logout() async throws {
        struct Ok: Codable { let ok: Bool? }
        let _: Ok = try await postJSON("/v1/auth/logout", body: [:] as [String: String])
        clearCookies()
    }

    func clearCookies() {
        let host = configuration.baseURL.host
        let matching = cookieStorage.cookies?.filter { cookie in
            if let host {
                return cookie.domain.contains(host) || host.contains(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")))
            }
            return cookie.name == "mooncut_session"
        } ?? []
        if matching.isEmpty {
            // 兜底：按 baseURL 清理
            cookieStorage.cookies(for: configuration.baseURL)?.forEach { cookieStorage.deleteCookie($0) }
        } else {
            matching.forEach { cookieStorage.deleteCookie($0) }
        }
    }

    /// 诊断用：是否已持有会话 Cookie（不读取/不外泄 Cookie 值）。
    func hasSessionCookie() -> Bool {
        guard let cookies = cookieStorage.cookies(for: configuration.baseURL) else { return false }
        return cookies.contains { $0.name == "mooncut_session" && !($0.value.isEmpty) }
    }

    /// 为 AVPlayer 等需要手动附加 Cookie 的场景提供 Cookie 头（不持久化到 UserDefaults）。
    func cookieHeader(for url: URL) -> String? {
        guard let cookies = cookieStorage.cookies(for: url), !cookies.isEmpty else { return nil }
        return HTTPCookie.requestHeaderFields(with: cookies)["Cookie"]
    }

    // MARK: - Assets / Jobs

    func uploadAsset(fileURL: URL, filename: String, contentType: String = "video/mp4") async throws -> AssetUploadResponse {
        let url = configuration.url(
            path: "/v1/assets",
            query: [URLQueryItem(name: "filename", value: filename)]
        )
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = configuration.uploadTimeout
        return try await performUpload(request, fromFile: fileURL)
    }

    /// - `capabilityInstallIds`：启用中的安装快照
    /// - `capabilityRequests`：要真正调用的工具（服务端仅在有此字段时执行工具）
    func createEditJob(
        assetId: String,
        title: String?,
        prompt: String?,
        imageGeneration: String = "auto",
        capabilityInstallIds: [String] = [],
        capabilityRequests: [[String: Any]] = []
    ) async throws -> EditJobCreateResponse {
        var body: [String: Any] = [
            "assetId": assetId,
            "imageGeneration": imageGeneration
        ]
        if let title, !title.isEmpty { body["title"] = title }
        if let prompt, !prompt.isEmpty { body["prompt"] = prompt }
        if !capabilityInstallIds.isEmpty {
            body["capabilityInstallIds"] = capabilityInstallIds
        }
        if !capabilityRequests.isEmpty {
            body["capabilityRequests"] = capabilityRequests
        }
        return try await postJSON("/v1/edit-jobs", body: body)
    }

    func getEditJob(id: String) async throws -> EditJobDTO {
        try await get("/v1/edit-jobs/\(id)")
    }

    func downloadArtifact(jobId: String, name: String = "video", to destination: URL) async throws -> URL {
        try ensureConfigured()
        let url = configuration.url(path: "/v1/edit-jobs/\(jobId)/artifacts/\(name)")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = configuration.uploadTimeout
        let (tempURL, response) = try await session.download(for: request)
        try validate(response: response, data: nil)
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.moveItem(at: tempURL, to: destination)
        return destination
    }

    func renderQueue() async throws -> RenderQueueSnapshotDTO {
        try await get("/v1/render-queue")
    }

    // MARK: - Assistant

    func scriptAssistant(_ payload: ScriptAssistantRequest) async throws -> ScriptAssistantResponseDTO {
        try await postCodable("/v1/assistant/script", body: payload)
    }

    func coachAdvice(_ payload: CoachAdviceRequest) async throws -> CoachAdviceResponseDTO {
        try await postCodable("/v1/assistant/coach", body: payload)
    }

    // MARK: - Community

    func listCommunityPosts(cursor: String? = nil, limit: Int = 12) async throws -> CommunityListResponse {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor, !cursor.isEmpty {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await get("/v1/community/posts", query: query)
    }

    func publishCommunityPost(_ payload: CommunityPublishRequest) async throws -> CommunityPublishResponse {
        try await postCodable("/v1/community/posts", body: payload)
    }

    // MARK: - Core HTTP

    private func ensureConfigured() throws {
        guard configuration.isConfigured else {
            throw APIError.notConfigured(
                "服务地址未配置。公开 IPA 不能直接连接内部环境；请部署自有 agent 后使用私有构建。"
            )
        }
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try ensureConfigured()
        var request = URLRequest(url: configuration.url(path: path, query: query))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await perform(request)
    }

    private func postJSON<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        try ensureConfigured()
        var request = URLRequest(url: configuration.url(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        return try await perform(request)
    }

    private func postCodable<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        try ensureConfigured()
        var request = URLRequest(url: configuration.url(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try encoder.encode(body)
        return try await perform(request)
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decoding(error.localizedDescription)
            }
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw mapURLError(error)
        } catch is CancellationError {
            throw APIError.cancelled
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
    }

    private func performUpload<T: Decodable>(_ request: URLRequest, fromFile fileURL: URL) async throws -> T {
        try ensureConfigured()
        do {
            let (data, response) = try await session.upload(for: request, fromFile: fileURL)
            try validate(response: response, data: data)
            return try decoder.decode(T.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            throw mapURLError(error)
        } catch is CancellationError {
            throw APIError.cancelled
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
    }

    private func validate(response: URLResponse, data: Data?) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        switch http.statusCode {
        case 200...299:
            return
        case 401:
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden(parseErrorMessage(data) ?? "无权限访问该资源")
        case 404:
            throw APIError.notFound(parseErrorMessage(data) ?? "资源不存在")
        case 413:
            throw APIError.payloadTooLarge
        case 415:
            throw APIError.unsupportedMedia
        case 429:
            throw APIError.rateLimited(parseErrorMessage(data) ?? "请求过于频繁")
        default:
            let body = parseErrorBody(data)
            throw APIError.server(
                status: http.statusCode,
                message: body?.error ?? body?.message ?? "服务错误（\(http.statusCode)）",
                code: body?.code,
                requestId: body?.requestId
            )
        }
    }

    private func parseErrorBody(_ data: Data?) -> APIErrorBody? {
        guard let data, !data.isEmpty else { return nil }
        return try? decoder.decode(APIErrorBody.self, from: data)
    }

    private func parseErrorMessage(_ data: Data?) -> String? {
        parseErrorBody(data)?.error ?? parseErrorBody(data)?.message
    }

    private func mapURLError(_ error: URLError) -> APIError {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
            return .offline
        case .cancelled:
            return .cancelled
        case .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot,
             .clientCertificateRejected, .secureConnectionFailed:
            return .certificateUntrusted(
                "无法验证服务器身份。请确认已配置 mooncut-ca 证书，且访问的是受信主机。"
            )
        case .timedOut:
            return .transport("请求超时，请稍后重试")
        default:
            return .transport(error.localizedDescription)
        }
    }
}

// MARK: - Test support

extension MoonCutAPIClient {
    /// 测试注入：使用自定义 URLSession（如 URLProtocol stub）。
    static func makeForTesting(
        baseURL: URL,
        session: URLSession
    ) -> MoonCutAPIClient {
        MoonCutAPIClient(
            configuration: APIConfiguration(
                baseURL: baseURL,
                trustedHost: baseURL.host ?? "localhost",
                requestTimeout: 5,
                resourceTimeout: 10,
                uploadTimeout: 10,
                pollInterval: 0.1,
                isConfigured: true,
                distributionMode: "test"
            ),
            session: session
        )
    }
}
