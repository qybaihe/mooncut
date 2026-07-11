import Foundation

enum APIError: LocalizedError, Equatable {
    case notConfigured(String)
    case invalidURL
    case offline
    case cancelled
    case unauthorized
    case forbidden(String)
    case notFound(String)
    case payloadTooLarge
    case unsupportedMedia
    case rateLimited(String)
    case server(status: Int, message: String, code: String?, requestId: String?)
    case decoding(String)
    case transport(String)
    case certificateUntrusted(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .notConfigured(let detail):
            return detail
        case .invalidURL:
            return "服务地址无效"
        case .offline:
            return "网络不可用，请检查连接后重试"
        case .cancelled:
            return "请求已取消"
        case .unauthorized:
            return "登录已失效，请重新登录"
        case .forbidden(let message):
            return message
        case .notFound(let message):
            return message
        case .payloadTooLarge:
            return "视频超过服务端大小限制（413）"
        case .unsupportedMedia:
            return "不支持的视频格式（415）"
        case .rateLimited(let message):
            return message.isEmpty ? "请求过于频繁，请稍后再试（429）" : message
        case .server(_, let message, _, let requestId):
            if let requestId, !requestId.isEmpty {
                return "\(message) · 诊断号 \(requestId)"
            }
            return message
        case .decoding(let detail):
            return "响应解析失败：\(detail)"
        case .transport(let detail):
            return detail
        case .certificateUntrusted(let detail):
            return detail
        case .invalidResponse:
            return "服务返回了无法识别的响应"
        }
    }

    var isRetryable: Bool {
        switch self {
        case .offline, .rateLimited, .transport, .server:
            return true
        case .cancelled, .unauthorized, .forbidden, .notFound,
             .payloadTooLarge, .unsupportedMedia, .decoding,
             .certificateUntrusted, .invalidURL, .notConfigured, .invalidResponse:
            return false
        }
    }

    var diagnosticCode: String? {
        switch self {
        case .server(_, _, let code, _): return code
        case .unauthorized: return "AUTH_REQUIRED"
        case .payloadTooLarge: return "PAYLOAD_TOO_LARGE"
        case .unsupportedMedia: return "UNSUPPORTED_MEDIA"
        case .rateLimited: return "RATE_LIMITED"
        case .certificateUntrusted: return "TLS_UNTRUSTED"
        default: return nil
        }
    }
}
