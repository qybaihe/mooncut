import Foundation

final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

enum MockHTTP {
    static func response(
        for request: URLRequest,
        status: Int,
        json: Any,
        headers: [String: String] = ["Content-Type": "application/json"]
    ) throws -> (HTTPURLResponse, Data) {
        let data = try JSONSerialization.data(withJSONObject: json)
        var all = headers
        if status == 200 || status == 201 {
            // Simulate Set-Cookie for login/register
            if request.url?.path.contains("/auth/login") == true
                || request.url?.path.contains("/auth/register") == true {
                all["Set-Cookie"] = "mooncut_session=test-session-token; Path=/; HttpOnly"
            }
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: nil,
            headerFields: all
        )!
        return (response, data)
    }
}
