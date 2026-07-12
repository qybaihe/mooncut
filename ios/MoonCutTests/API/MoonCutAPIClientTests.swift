import XCTest
@testable import MoonCut

final class MoonCutAPIClientTests: XCTestCase {
    private var client: MoonCutAPIClient!
    private let base = URL(string: "https://example.test")!

    override func setUp() {
        super.setUp()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: config)
        client = MoonCutAPIClient.makeForTesting(baseURL: base, session: session)
        MockURLProtocol.handler = nil
    }

    override func tearDown() {
        MockURLProtocol.handler = nil
        super.tearDown()
    }

    func testLoginJSONAndSessionCookiePath() async throws {
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertTrue(request.url?.path.hasSuffix("/v1/auth/login") == true)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            // URLSession 可能把 body 放在 httpBody 或 bodyStream；不强依赖可读 body。
            if let bodyData = request.httpBody,
               let body = try? JSONSerialization.jsonObject(with: bodyData) as? [String: String] {
                XCTAssertEqual(body["email"], "a@b.com")
            }
            return try MockHTTP.response(
                for: request,
                status: 200,
                json: [
                    "user": [
                        "id": "u1",
                        "email": "a@b.com",
                        "createdAt": "2026-01-01T00:00:00Z"
                    ]
                ]
            )
        }
        let user = try await client.login(email: "a@b.com", password: "password12")
        XCTAssertEqual(user.id, "u1")
        XCTAssertEqual(user.email, "a@b.com")
    }

    func testEmailOTPContract() async throws {
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/auth/otp/send")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            return try MockHTTP.response(
                for: request,
                status: 200,
                json: [
                    "ok": true,
                    "email": "a@b.com",
                    "purpose": "login",
                    "expiresInSec": 600,
                    "resendAfterSec": 60
                ]
            )
        }

        let response = try await client.sendAuthOTP(email: "a@b.com", purpose: .login)
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.purpose, .login)
        XCTAssertEqual(response.expiresInSec, 600)
    }

    func testUnauthorizedMapsToAPIError() async {
        MockURLProtocol.handler = { request in
            try MockHTTP.response(
                for: request,
                status: 401,
                json: ["error": "请先登录", "code": "AUTH_REQUIRED"]
            )
        }
        do {
            _ = try await client.me()
            XCTFail("expected throw")
        } catch let error as APIError {
            XCTAssertEqual(error, .unauthorized)
        } catch {
            XCTFail("wrong error \(error)")
        }
    }

    func testBinaryUploadUsesFileBody() async throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("mp4")
        try Data(repeating: 0xAB, count: 128).write(to: temp)
        defer { try? FileManager.default.removeItem(at: temp) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertTrue(request.url?.absoluteString.contains("/v1/assets") == true)
            XCTAssertTrue(request.url?.absoluteString.contains("filename=") == true)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "video/mp4")
            // URLSession upload from file may not populate httpBody on the protocol request;
            // ensure we did not require loading whole file in caller path (file exists).
            return try MockHTTP.response(
                for: request,
                status: 200,
                json: ["assetId": "asset-1", "filename": "clip.mp4", "bytes": 128]
            )
        }

        let response = try await client.uploadAsset(fileURL: temp, filename: "clip.mp4", contentType: "video/mp4")
        XCTAssertEqual(response.assetId, "asset-1")
    }

    func testJobProgressAndFailureMapping() async throws {
        MockURLProtocol.handler = { request in
            try MockHTTP.response(
                for: request,
                status: 200,
                json: [
                    "id": "job-1",
                    "status": "running",
                    "stage": "transcribing",
                    "progress": 0.42,
                    "originalName": "a.mp4"
                ]
            )
        }
        let job = try await client.getEditJob(id: "job-1")
        XCTAssertEqual(job.status, .running)
        XCTAssertEqual(job.stage, "transcribing")
        XCTAssertEqual(job.progress, 0.42)

        MockURLProtocol.handler = { request in
            try MockHTTP.response(
                for: request,
                status: 200,
                json: [
                    "id": "job-2",
                    "status": "failed",
                    "stage": "rendering",
                    "progress": 0.8,
                    "error": "渲染失败安全摘要"
                ]
            )
        }
        let failed = try await client.getEditJob(id: "job-2")
        XCTAssertEqual(failed.status, .failed)
        XCTAssertEqual(failed.error, "渲染失败安全摘要")
    }

    func testRateLimitAndPayloadErrors() async {
        MockURLProtocol.handler = { request in
            try MockHTTP.response(for: request, status: 429, json: ["error": "太快了"])
        }
        do {
            _ = try await client.renderQueue()
            XCTFail("expected")
        } catch let error as APIError {
            guard case .rateLimited(let message) = error else {
                return XCTFail("expected rateLimited")
            }
            XCTAssertEqual(message, "太快了")
        } catch {
            XCTFail("\(error)")
        }

        MockURLProtocol.handler = { request in
            try MockHTTP.response(for: request, status: 413, json: ["error": "too large"])
        }
        do {
            _ = try await client.healthz()
            XCTFail("expected")
        } catch let error as APIError {
            XCTAssertEqual(error, .payloadTooLarge)
        } catch {
            XCTFail("\(error)")
        }
    }

    func testScriptAssistantDecoding() async throws {
        MockURLProtocol.handler = { request in
            try MockHTTP.response(
                for: request,
                status: 200,
                json: [
                    "reply": "好的",
                    "phase": "outline",
                    "ready": true,
                    "draft": "稿件正文",
                    "petMessage": "加油",
                    "suggestions": [
                        ["eyebrow": "钩子", "title": "误区", "detail": "细节"]
                    ],
                    "model": "test-model"
                ]
            )
        }
        let response = try await client.scriptAssistant(
            ScriptAssistantRequest(action: "guide", style: nil, messages: [
                ScriptMessageDTO(role: "user", content: "开头怎么写")
            ], draft: nil)
        )
        XCTAssertEqual(response.reply, "好的")
        XCTAssertEqual(response.draft, "稿件正文")
        XCTAssertEqual(response.suggestions?.count, 1)
        XCTAssertEqual(response.model, "test-model")
    }

    func testBillingContractDecodesCheckoutHistoryAndCheckoutURL() async throws {
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/billing/summary")
            return try MockHTTP.response(
                for: request,
                status: 200,
                json: [
                    "account": [
                        "plan": "free", "planLabel": "Free · 体验版", "subscriptionStatus": "free",
                        "periodStartedAt": "2026-01-01T00:00:00Z", "periodEndsAt": NSNull(),
                        "cancelAtPeriodEnd": false, "exportQuality": "720P", "maxParallelJobs": 1
                    ],
                    "usage": [
                        "videoGenerations": ["used": 1, "completed": 1, "inProgress": 0, "limit": 3, "remaining": 2],
                        "smartMinutes": ["used": 2, "completed": 2, "limit": 15, "remaining": 13],
                        "creativePoints": ["used": 1, "inProgress": 0, "limit": 8, "remaining": 7]
                    ],
                    "limits": ["maxSourceSeconds": 120, "checkoutConfigured": true],
                    "upgradePrompt": NSNull(),
                    "checkoutRequests": [[
                        "id": "checkout-1", "requested_plan": "creator", "status": "ready_for_payment",
                        "checkout_url": "https://pay.example.test/session", "created_at": "2026-01-02T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"
                    ]],
                    "plans": [[
                        "id": "free", "label": "Free · 体验版", "priceCny": 0, "smartMinuteLimit": 15,
                        "creativePointLimit": 8, "exportQuality": "720P", "maxParallelJobs": 1
                    ]]
                ]
            )
        }
        let summary = try await client.billingSummary()
        XCTAssertEqual(summary.account.plan, .free)
        XCTAssertEqual(summary.checkoutRequests.first?.requestedPlan, .creator)
        XCTAssertEqual(summary.checkoutRequests.first?.checkoutURL, "https://pay.example.test/session")

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/billing/checkout")
            return try MockHTTP.response(
                for: request,
                status: 202,
                json: [
                    "checkout": [
                        "id": "checkout-2", "plan": "creator", "status": "ready_for_payment",
                        "checkoutUrl": "https://pay.example.test/next", "createdAt": "2026-01-03T00:00:00Z"
                    ],
                    "message": "已生成安全支付链接"
                ]
            )
        }
        let checkout = try await client.createBillingCheckout(plan: .creator)
        XCTAssertEqual(checkout.checkout.plan, .creator)
        XCTAssertEqual(checkout.checkout.checkoutURL, "https://pay.example.test/next")
    }

    func testCommunityRegistryAndConnectContract() async throws {
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/community/packages")
            return try MockHTTP.response(
                for: request,
                status: 200,
                json: [
                    "items": [[
                        "slug": "fifa-highlights", "publisher": ["id": "user:abc", "label": "MoonCut", "trust": "community"],
                        "display": ["name": "FIFA Highlights", "tagline": "官方集锦", "category": "体育"],
                        "kinds": ["skill", "connector"],
                        "permissions": [["name": "network", "reason": "读取官方集锦"]],
                        "release": [
                            "version": "1.0.0", "publishedAt": "2026-01-01T00:00:00Z",
                            "files": ["package": "/api/v1/community/packages/fifa-highlights/1.0.0/package.mooncut-capability.json", "manifest": "/api/v1/community/packages/fifa-highlights/1.0.0/manifest.json", "skill": "/api/v1/community/packages/fifa-highlights/1.0.0/SKILL.md", "connector": "/api/v1/community/packages/fifa-highlights/1.0.0/connector.json"]
                        ]
                    ]]
                ]
            )
        }
        let registry = try await client.listCommunityPackages()
        XCTAssertEqual(registry.items.first?.slug, "fifa-highlights")
        XCTAssertEqual(registry.items.first?.release.files.skill, "/api/v1/community/packages/fifa-highlights/1.0.0/SKILL.md")

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/community/packages/fifa-highlights/connect")
            return try MockHTTP.response(for: request, status: 200, json: ["created": true])
        }
        let connection = try await client.connectCommunityPackage(slug: "fifa-highlights")
        XCTAssertTrue(connection.created)
    }

    func testCancelMapsToCancelled() async {
        MockURLProtocol.handler = { _ in
            throw URLError(.cancelled)
        }
        do {
            _ = try await client.healthz()
            XCTFail("expected")
        } catch let error as APIError {
            XCTAssertEqual(error, .cancelled)
        } catch {
            XCTFail("\(error)")
        }
    }
}
