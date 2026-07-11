import Foundation
import Security

/// 仅对配置中的生产 host 做私有 CA 锚定。不关闭 ATS，不信任任意证书。
final class MoonCutCertificateTrust: NSObject, URLSessionDelegate, @unchecked Sendable {
    private let trustedHost: String
    private let anchoredCertificates: [SecCertificate]

    init(trustedHost: String, caCertificateData: Data?) {
        self.trustedHost = trustedHost
        if let data = caCertificateData,
           let cert = SecCertificateCreateWithData(nil, data as CFData) {
            self.anchoredCertificates = [cert]
        } else {
            self.anchoredCertificates = []
        }
        super.init()
    }

    static func loadBundledCA() -> Data? {
        if let url = Bundle.main.url(forResource: "mooncut-ca", withExtension: "crt")
            ?? Bundle.main.url(forResource: "mooncut-ca", withExtension: "pem") {
            return try? Data(contentsOf: url)
        }
        // Optional Application Support drop-in for operators
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("MoonCut/mooncut-ca.crt")
        if let support, FileManager.default.fileExists(atPath: support.path) {
            return try? Data(contentsOf: support)
        }
        return nil
    }

    var hasAnchoredCA: Bool { !anchoredCertificates.isEmpty }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let host = challenge.protectionSpace.host
        // Only customize for the known production host; everything else uses system trust.
        guard host == trustedHost else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        guard !anchoredCertificates.isEmpty else {
            // No CA available: refuse rather than insecurely continue.
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        if evaluate(serverTrust: serverTrust, host: host) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    private func evaluate(serverTrust: SecTrust, host: String) -> Bool {
        SecTrustSetAnchorCertificates(serverTrust, anchoredCertificates as CFArray)
        SecTrustSetAnchorCertificatesOnly(serverTrust, true)

        let policy = SecPolicyCreateSSL(true, host as CFString)
        SecTrustSetPolicies(serverTrust, policy)

        var error: CFError?
        return SecTrustEvaluateWithError(serverTrust, &error)
    }
}
