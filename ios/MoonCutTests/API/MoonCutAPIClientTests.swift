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
